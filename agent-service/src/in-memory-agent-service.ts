import { randomUUID } from "node:crypto";

import type { AgentApproval, AgentArtifact, AgentEventEnvelope, AgentRun, AgentRuntimeAdapter, AgentSession, RuntimeMessage, RuntimeRunRef } from "./contracts.js";

export class InMemoryAgentService {
    readonly #adapters = new Map<string, AgentRuntimeAdapter>();
    readonly #sessions = new Map<string, AgentSession>();
    readonly #runs = new Map<string, AgentRun>();
    readonly #events = new Map<string, AgentEventEnvelope[]>();
    readonly #approvals = new Map<string, AgentApproval>();
    readonly #artifacts = new Map<string, AgentArtifact>();
    readonly #collectors = new Map<string, Promise<void>>();

    constructor(adapters: AgentRuntimeAdapter[]) {
        adapters.forEach((adapter) => this.#adapters.set(adapter.key, adapter));
    }

    async createSession(input: { workspaceId: string; runtimeKey: string; title: string }) {
        const adapter = this.#adapter(input.runtimeKey);
        const id = `session-${randomUUID()}`;
        const now = new Date().toISOString();
        const runtimeSession = await adapter.createSession({ productSessionId: id, workspaceId: input.workspaceId });
        const session: AgentSession = { id, workspaceId: input.workspaceId, runtimeKey: input.runtimeKey, title: input.title, status: "idle", runtimeRef: runtimeSession, createdAt: now, updatedAt: now };
        this.#sessions.set(id, session);
        return session;
    }

    startRun(input: { sessionId: string; messages: RuntimeMessage[]; metadata?: Record<string, unknown> }) {
        const session = this.getSession(input.sessionId);
        if (session.status === "archived") throw new Error("session archived");
        if ([...this.#runs.values()].some((run) => run.sessionId === session.id && ["queued", "running", "waiting_approval"].includes(run.status))) throw new Error("session already running");
        const id = `run-${randomUUID()}`;
        const run: AgentRun = { id, sessionId: session.id, status: "queued", runtimeRef: { adapter: session.runtimeKey, sessionId: session.runtimeRef.sessionId } };
        this.#runs.set(id, run);
        this.#events.set(id, []);
        this.#updateSession(session.id, "running");
        const adapter = this.#adapter(session.runtimeKey);
        const collector = this.#collect(adapter, run, input.messages, input.metadata);
        this.#collectors.set(id, collector);
        void collector.finally(() => this.#collectors.delete(id));
        return run;
    }

    getSession(id: string) {
        const session = this.#sessions.get(id);
        if (!session) throw new Error("session not found");
        return session;
    }

    getRun(id: string) {
        const run = this.#runs.get(id);
        if (!run) throw new Error("run not found");
        return run;
    }

    listEvents(runId: string, afterEventId?: string) {
        const events = this.#events.get(runId);
        if (!events) throw new Error("run not found");
        if (!afterEventId) return [...events];
        const index = events.findIndex((event) => event.eventId === afterEventId);
        if (index < 0) throw new Error("event cursor not found");
        return events.slice(index + 1);
    }

    listApprovals(runId: string) {
        return [...this.#approvals.values()].filter((approval) => approval.runId === runId);
    }

    listArtifacts(runId: string) {
        return [...this.#artifacts.values()].filter((artifact) => artifact.runId === runId);
    }

    async resolveApproval(approvalId: string, decision: "approved" | "rejected") {
        const approval = this.#approvals.get(approvalId);
        if (!approval || approval.status !== "pending") throw new Error("approval not pending");
        const run = this.getRun(approval.runId);
        await this.#adapter(run.runtimeRef.adapter).resolveApproval({ approvalId, runRef: requiredRunRef(run), decision });
        approval.status = decision;
        approval.resolvedAt = new Date().toISOString();
    }

    async cancelRun(runId: string) {
        const run = this.getRun(runId);
        if (!["queued", "running", "waiting_approval"].includes(run.status)) return run;
        await this.#adapter(run.runtimeRef.adapter).cancel(requiredRunRef(run));
        return run;
    }

    async waitForRun(runId: string) {
        await this.#collectors.get(runId);
        return this.getRun(runId);
    }

    async #collect(adapter: AgentRuntimeAdapter, run: AgentRun, messages: RuntimeMessage[], metadata?: Record<string, unknown>) {
        const session = this.getSession(run.sessionId);
        try {
            for await (const event of adapter.run({ productSessionId: session.id, productRunId: run.id, runtimeSession: { adapter: session.runtimeRef.adapter, sessionId: session.runtimeRef.sessionId || "" }, messages, metadata })) {
                this.#events.get(run.id)?.push(event);
                this.#applyEvent(run, event);
            }
            if (!["succeeded", "failed", "cancelled"].includes(run.status)) this.#finishRun(run, "failed", "runtime ended without terminal event");
        } catch (error) {
            this.#finishRun(run, "failed", error instanceof Error ? error.message : String(error));
        }
    }

    #applyEvent(run: AgentRun, event: AgentEventEnvelope) {
        if (event.runtimeRef?.runId) run.runtimeRef.runId = event.runtimeRef.runId;
        if (event.type === "run.started") {
            run.status = "running";
            run.startedAt = event.timestamp;
        }
        if (event.type === "approval.requested") {
            const payload = event.payload as { approvalId: string; toolName: string; arguments?: Record<string, unknown>; permissions?: string[] };
            this.#approvals.set(payload.approvalId, { id: payload.approvalId, sessionId: run.sessionId, runId: run.id, toolName: payload.toolName, arguments: payload.arguments || {}, permissions: payload.permissions || [], status: "pending", createdAt: event.timestamp });
            run.status = "waiting_approval";
            this.#updateSession(run.sessionId, "waiting_approval");
        }
        if (event.type === "approval.resolved") {
            run.status = "running";
            this.#updateSession(run.sessionId, "running");
        }
        if (event.type === "artifact.created") {
            const payload = event.payload as { artifact: Omit<AgentArtifact, "sessionId" | "runId" | "createdAt"> };
            this.#artifacts.set(payload.artifact.id, { ...payload.artifact, sessionId: run.sessionId, runId: run.id, createdAt: event.timestamp });
        }
        if (event.type === "run.completed") this.#finishRun(run, "succeeded");
        if (event.type === "run.failed") this.#finishRun(run, "failed", String((event.payload as { error?: string }).error || "runtime failed"));
        if (event.type === "run.cancelled") this.#finishRun(run, "cancelled");
    }

    #finishRun(run: AgentRun, status: "succeeded" | "failed" | "cancelled", error?: string) {
        run.status = status;
        run.finishedAt = new Date().toISOString();
        run.error = error;
        if (status !== "succeeded") {
            this.listApprovals(run.id).forEach((approval) => {
                if (approval.status !== "pending") return;
                approval.status = "cancelled";
                approval.resolvedAt = run.finishedAt;
            });
        }
        this.#updateSession(run.sessionId, status === "failed" ? "failed" : "idle");
    }

    #updateSession(id: string, status: AgentSession["status"]) {
        const session = this.getSession(id);
        session.status = status;
        session.updatedAt = new Date().toISOString();
    }

    #adapter(key: string) {
        const adapter = this.#adapters.get(key);
        if (!adapter) throw new Error(`runtime adapter not found: ${key}`);
        return adapter;
    }
}

function requiredRunRef(run: AgentRun): RuntimeRunRef {
    if (!run.runtimeRef.sessionId || !run.runtimeRef.runId) throw new Error("runtime run reference missing");
    return { adapter: run.runtimeRef.adapter, sessionId: run.runtimeRef.sessionId, runId: run.runtimeRef.runId };
}
