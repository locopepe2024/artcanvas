export type AgentSessionStatus = "idle" | "running" | "waiting_approval" | "failed" | "archived";
export type AgentRunStatus = "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
export type AgentApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type RuntimeRef = { adapter: string; sessionId?: string; runId?: string };

export type AgentSession = {
    id: string;
    workspaceId: string;
    runtimeKey: string;
    title: string;
    status: AgentSessionStatus;
    runtimeRef: RuntimeRef;
    createdAt: string;
    updatedAt: string;
};

export type AgentRun = {
    id: string;
    sessionId: string;
    status: AgentRunStatus;
    runtimeRef: RuntimeRef;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
};

export type AgentEventEnvelope = {
    eventId: string;
    sessionId: string;
    runId: string;
    sequence: number;
    type: string;
    timestamp: string;
    payload: unknown;
    runtimeRef?: Record<string, string>;
};

export type AgentApproval = {
    id: string;
    sessionId: string;
    runId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    permissions: string[];
    status: AgentApprovalStatus;
    createdAt: string;
    resolvedAt?: string;
};

export type AgentArtifact = {
    id: string;
    sessionId: string;
    runId: string;
    kind: "file" | "canvas_operation_set" | "report" | "media";
    mimeType?: string;
    uri?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
};

export type RuntimeCapabilities = {
    declared: string[];
    probed: string[];
    lastVerifiedAt: string;
    failureReason?: string;
};

export type RuntimeSessionInput = { productSessionId: string; workspaceId: string };
export type RuntimeSessionRef = { adapter: string; sessionId: string };
export type RuntimeRunRef = { adapter: string; sessionId: string; runId: string };
export type RuntimeMessage = { role: "user" | "assistant" | "system"; text: string };
export type RuntimeRunInput = {
    productSessionId: string;
    productRunId: string;
    runtimeSession: RuntimeSessionRef;
    messages: RuntimeMessage[];
    metadata?: Record<string, unknown>;
};
export type RuntimeApprovalDecision = { approvalId: string; runRef: RuntimeRunRef; decision: "approved" | "rejected" };

export interface AgentRuntimeAdapter {
    readonly key: string;
    capabilities(): Promise<RuntimeCapabilities>;
    createSession(input: RuntimeSessionInput): Promise<RuntimeSessionRef>;
    resumeSession(ref: RuntimeSessionRef): Promise<void>;
    run(input: RuntimeRunInput): AsyncIterable<AgentEventEnvelope>;
    cancel(runRef: RuntimeRunRef): Promise<void>;
    resolveApproval(input: RuntimeApprovalDecision): Promise<void>;
}
