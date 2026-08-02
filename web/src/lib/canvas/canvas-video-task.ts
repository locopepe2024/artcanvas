export type CanvasVideoTask = {
    id: string;
    provider: "openai" | "seedance";
    model: string;
};

export function persistedCanvasVideoTask(task: { id?: unknown; provider?: unknown; model?: unknown } | null | undefined): CanvasVideoTask | undefined {
    if (!task || typeof task.id !== "string" || !task.id.trim() || typeof task.model !== "string" || !task.model.trim()) return undefined;
    if (task.provider !== "openai" && task.provider !== "seedance") return undefined;
    return { id: task.id, provider: task.provider, model: task.model };
}

export function recoverableCanvasVideoTask(value: unknown): CanvasVideoTask | undefined {
    return value && typeof value === "object" ? persistedCanvasVideoTask(value as { id?: unknown; provider?: unknown; model?: unknown }) : undefined;
}
