export type CanvasImageTask = {
    id: string;
    model: string;
};

export function persistedCanvasImageTask(task: { id?: unknown; model?: unknown } | null | undefined): CanvasImageTask | undefined {
    if (!task || typeof task.id !== "string" || !task.id.trim() || typeof task.model !== "string" || !task.model.trim()) return undefined;
    return { id: task.id.trim(), model: task.model.trim() };
}

export function recoverableCanvasImageTask(value: unknown): CanvasImageTask | undefined {
    return value && typeof value === "object" ? persistedCanvasImageTask(value as { id?: unknown; model?: unknown }) : undefined;
}
