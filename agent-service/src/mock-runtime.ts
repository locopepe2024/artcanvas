import { randomUUID } from "node:crypto";

import type { AgentEventEnvelope, AgentRuntimeAdapter, RuntimeApprovalDecision, RuntimeCapabilities, RuntimeRunInput, RuntimeRunRef, RuntimeSessionInput, RuntimeSessionRef } from "./contracts.js";

type Decision = "approved" | "rejected";
type RunControl = { cancelled: boolean; cancelSignal: Deferred<void>; approval?: Deferred<Decision>; approvalId?: string };
type MockMetadata = {
    chunks?: string[];
    requireApproval?: boolean;
    fail?: boolean;
    artifact?: boolean;
    pauseMs?: number;
};

export class MockRuntimeAdapter implements AgentRuntimeAdapter {
    readonly key = "mock";
    readonly #runs = new Map<string, RunControl>();

    async capabilities(): Promise<RuntimeCapabilities> {
        return { declared: ["streaming", "approval", "cancel", "artifact"], probed: ["streaming", "approval", "cancel", "artifact"], lastVerifiedAt: new Date().toISOString() };
    }

    async createSession(input: RuntimeSessionInput): Promise<RuntimeSessionRef> {
        return { adapter: this.key, sessionId: `mock-session-${input.productSessionId}` };
    }

    async resumeSession(_ref: RuntimeSessionRef) {}

    async *run(input: RuntimeRunInput): AsyncIterable<AgentEventEnvelope> {
        const metadata = (input.metadata || {}) as MockMetadata;
        const control: RunControl = { cancelled: false, cancelSignal: deferred<void>() };
        this.#runs.set(input.productRunId, control);
        const runtimeRunId = `mock-run-${input.productRunId}`;
        const runtimeRef = { adapter: this.key, sessionId: input.runtimeSession.sessionId, runId: runtimeRunId };
        let sequence = 0;
        const event = (type: string, payload: unknown): AgentEventEnvelope => ({
            eventId: `${input.productRunId}:${++sequence}`,
            sessionId: input.productSessionId,
            runId: input.productRunId,
            sequence,
            type,
            timestamp: new Date().toISOString(),
            payload,
            runtimeRef,
        });

        try {
            yield event("run.started", { runtimeRunId });
            yield event("message.started", { role: "assistant" });
            for (const chunk of metadata.chunks || ["Mock ", "response"]) {
                if (await waitForCancel(control, metadata.pauseMs || 0)) {
                    yield event("run.cancelled", {});
                    return;
                }
                yield event("message.delta", { delta: chunk });
            }

            if (metadata.requireApproval) {
                const approvalId = `approval-${randomUUID()}`;
                control.approvalId = approvalId;
                control.approval = deferred<Decision>();
                yield event("tool.requested", { toolName: "mock.render", arguments: { quality: "draft" }, permissions: ["write"] });
                yield event("approval.requested", { approvalId, toolName: "mock.render", arguments: { quality: "draft" }, permissions: ["write"] });
                const decision = await Promise.race([control.approval.promise, control.cancelSignal.promise.then(() => "cancelled" as const)]);
                if (decision === "cancelled") {
                    yield event("run.cancelled", {});
                    return;
                }
                yield event("approval.resolved", { approvalId, decision });
                if (decision === "approved") {
                    yield event("tool.started", { toolName: "mock.render" });
                    if (metadata.artifact) yield event("artifact.created", { artifact: { id: `artifact-${randomUUID()}`, kind: "report", mimeType: "application/json", uri: `memory://${input.productRunId}/report.json` } });
                    yield event("tool.completed", { toolName: "mock.render", result: { ok: true } });
                }
            }

            if (metadata.fail) {
                yield event("run.failed", { error: "mock runtime failure" });
                return;
            }
            if (control.cancelled) {
                yield event("run.cancelled", {});
                return;
            }
            yield event("message.completed", { role: "assistant" });
            yield event("run.completed", { status: "succeeded" });
        } finally {
            this.#runs.delete(input.productRunId);
        }
    }

    async cancel(runRef: RuntimeRunRef) {
        const control = findRun(this.#runs, runRef.runId);
        if (control && !control.cancelled) {
            control.cancelled = true;
            control.cancelSignal.resolve();
        }
    }

    async resolveApproval(input: RuntimeApprovalDecision) {
        const control = findRun(this.#runs, input.runRef.runId);
        if (!control?.approval || control.approvalId !== input.approvalId) throw new Error("approval not pending");
        control.approval.resolve(input.decision);
    }
}

function findRun(runs: Map<string, RunControl>, runtimeRunId: string) {
    const productRunId = runtimeRunId.replace(/^mock-run-/, "");
    return runs.get(productRunId);
}

async function waitForCancel(control: RunControl, delayMs: number) {
    if (!delayMs) return control.cancelled;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return control.cancelled;
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => (resolve = next));
    return { promise, resolve };
}
