export function isQuotaExceededStorageError(error: unknown): boolean {
    let current: unknown = error;
    const visited = new Set<unknown>();
    while (current && !visited.has(current)) {
        visited.add(current);
        if (current instanceof DOMException && current.name === "QuotaExceededError") return true;
        if (current instanceof Error) {
            if (current.name === "QuotaExceededError" || /QuotaExceededError/i.test(current.message)) return true;
            current = current.cause;
            continue;
        }
        if (typeof current === "object" && "name" in current && String(current.name) === "QuotaExceededError") return true;
        break;
    }
    return false;
}

export type QuotaCleanupDecision = { approved: boolean; logs: number };

export type QuotaProtectedWriteResult =
    | { status: "stored" }
    | { status: "recovered"; logs: number }
    | { status: "declined" | "nothing-to-clean"; error: unknown }
    | { status: "retry-failed"; error: unknown };

export async function writeWithConfirmedQuotaCleanup(write: () => Promise<unknown>, requestCleanup: () => Promise<QuotaCleanupDecision>): Promise<QuotaProtectedWriteResult> {
    try {
        await write();
        return { status: "stored" };
    } catch (error) {
        if (!isQuotaExceededStorageError(error)) throw error;
        const cleanup = await requestCleanup();
        if (!cleanup.approved) return { status: "declined", error };
        if (!cleanup.logs) return { status: "nothing-to-clean", error };
        try {
            await write();
            return { status: "recovered", logs: cleanup.logs };
        } catch (retryError) {
            return { status: "retry-failed", error: retryError };
        }
    }
}
