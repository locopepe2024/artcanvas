export type CanvasVideoTask = {
    id: string;
    provider: "openai" | "seedance";
    model: string;
    channelId?: string;
};

export type CanvasVideoResult = {
    url: string;
    model?: string;
    channelId?: string;
    requiresAuth?: boolean;
    mimeType?: string;
};

export function persistedCanvasVideoTask(task: { id?: unknown; provider?: unknown; model?: unknown; channelId?: unknown } | null | undefined): CanvasVideoTask | undefined {
    if (!task || typeof task.id !== "string" || !task.id.trim() || typeof task.model !== "string" || !task.model.trim()) return undefined;
    if (task.provider !== "openai" && task.provider !== "seedance") return undefined;
    return { id: task.id, provider: task.provider, model: task.model, ...(typeof task.channelId === "string" && task.channelId.trim() ? { channelId: task.channelId } : {}) };
}

export function recoverableCanvasVideoTask(value: unknown): CanvasVideoTask | undefined {
    return value && typeof value === "object" ? persistedCanvasVideoTask(value as { id?: unknown; provider?: unknown; model?: unknown; channelId?: unknown }) : undefined;
}

export function persistedCanvasVideoResult(result: { url?: unknown; model?: unknown; channelId?: unknown; requiresAuth?: unknown; mimeType?: unknown } | null | undefined): CanvasVideoResult | undefined {
    if (!result || typeof result.url !== "string" || !result.url.trim()) return undefined;
    return {
        url: result.url,
        ...(typeof result.model === "string" && result.model.trim() ? { model: result.model } : {}),
        ...(typeof result.channelId === "string" && result.channelId.trim() ? { channelId: result.channelId } : {}),
        ...(typeof result.requiresAuth === "boolean" ? { requiresAuth: result.requiresAuth } : {}),
        ...(typeof result.mimeType === "string" && result.mimeType.trim() ? { mimeType: result.mimeType } : {}),
    };
}

export function recoverableCanvasVideoResult(value: unknown): CanvasVideoResult | undefined {
    return value && typeof value === "object" ? persistedCanvasVideoResult(value as { url?: unknown; model?: unknown; channelId?: unknown; requiresAuth?: unknown; mimeType?: unknown }) : undefined;
}

export function canvasVideoRecoveryKind(task: CanvasVideoTask | undefined, result: CanvasVideoResult | undefined): "task" | "result" | undefined {
    if (task) return "task";
    if (result) return "result";
    return undefined;
}
