import { describe, expect, test } from "bun:test";

import { isQuotaExceededStorageError, writeWithConfirmedQuotaCleanup } from "./browser-storage-errors.ts";

describe("browser storage errors", () => {
    test("recognizes direct, wrapped, and serialized quota errors", () => {
        const quota = new DOMException("", "QuotaExceededError");
        expect(isQuotaExceededStorageError(quota)).toBe(true);
        expect(isQuotaExceededStorageError(new Error("storage failed", { cause: quota }))).toBe(true);
        expect(isQuotaExceededStorageError(new Error("IndexedDB failed: QuotaExceededError:"))).toBe(true);
        expect(isQuotaExceededStorageError(new Error("Network Error"))).toBe(false);
    });

    test("asks for cleanup only after a quota error and retries after approval", async () => {
        const calls = [];
        let writes = 0;
        const result = await writeWithConfirmedQuotaCleanup(
            async () => {
                calls.push("write");
                if (!writes++) throw new DOMException("", "QuotaExceededError");
            },
            async () => {
                calls.push("cleanup");
                return { approved: true, logs: 2 };
            },
        );
        expect(result).toEqual({ status: "recovered", logs: 2 });
        expect(calls).toEqual(["write", "cleanup", "write"]);
    });

    test("does not clean or retry after cancellation", async () => {
        let writes = 0;
        const result = await writeWithConfirmedQuotaCleanup(
            async () => {
                writes += 1;
                throw new DOMException("", "QuotaExceededError");
            },
            async () => ({ approved: false, logs: 0 }),
        );
        expect(result.status).toBe("declined");
        expect(writes).toBe(1);
    });

    test("does not prompt for non-quota storage errors", async () => {
        let prompted = false;
        await expect(
            writeWithConfirmedQuotaCleanup(
                async () => {
                    throw new Error("IndexedDB unavailable");
                },
                async () => {
                    prompted = true;
                    return { approved: true, logs: 1 };
                },
            ),
        ).rejects.toThrow("IndexedDB unavailable");
        expect(prompted).toBe(false);
    });
});
