import { describe, expect, test } from "bun:test";

import { claimVideoLogRecovery } from "./video-log-recovery.ts";

describe("video workbench log recovery", () => {
    test("claims each stored log task only once per page session", () => {
        const attempted = new Set();
        expect(claimVideoLogRecovery(attempted, "log-1", "task-1")).toBe(true);
        expect(claimVideoLogRecovery(attempted, "log-1", "task-1")).toBe(false);
        expect(claimVideoLogRecovery(attempted, "log-1", "task-2")).toBe(true);
        expect(claimVideoLogRecovery(attempted, "log-2", "task-1")).toBe(true);
    });
});
