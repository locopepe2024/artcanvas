import { describe, expect, test } from "bun:test";

import { shouldReconcileStoredVideoTaskQuery } from "./video.ts";

describe("video task query reconciliation", () => {
    test("reconciles queued-task 400s and transient provider query failures", () => {
        expect(shouldReconcileStoredVideoTaskQuery(400)).toBe(true);
        expect(shouldReconcileStoredVideoTaskQuery(404)).toBe(true);
        expect(shouldReconcileStoredVideoTaskQuery(500)).toBe(true);
        expect(shouldReconcileStoredVideoTaskQuery()).toBe(true);
    });

    test("does not hide authentication failures or cancellation", () => {
        expect(shouldReconcileStoredVideoTaskQuery(401)).toBe(false);
        expect(shouldReconcileStoredVideoTaskQuery(403)).toBe(false);
        expect(shouldReconcileStoredVideoTaskQuery(400, true)).toBe(false);
        expect(shouldReconcileStoredVideoTaskQuery(400, false, true)).toBe(false);
    });
});
