export type VideoHistoryCleanupLog = {
    id?: string;
    status?: string;
    task?: { id?: string };
};

export function removableTerminalVideoLogs<T extends VideoHistoryCleanupLog>(logs: T[], protectedLogIds: Iterable<string> = []) {
    const protectedIds = new Set(protectedLogIds);
    return logs.filter((log) => Boolean(log.id) && !protectedIds.has(log.id!) && (log.status === "成功" || log.status === "失败"));
}

export function storageKeysOwnedOnlyByRemovedHistory(removed: unknown, retained: unknown, collectKeys: (value: unknown) => Set<string>) {
    const retainedKeys = collectKeys(retained);
    return [...collectKeys(removed)].filter((key) => !retainedKeys.has(key));
}
