export function claimVideoLogRecovery(attempted: Set<string>, logId: string, taskId: string) {
    const key = `${logId}:${taskId}`;
    if (attempted.has(key)) return false;
    attempted.add(key);
    return true;
}
