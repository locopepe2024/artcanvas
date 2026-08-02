import assert from "node:assert/strict";
import test from "node:test";

import { persistedCanvasVideoTask, recoverableCanvasVideoTask } from "./canvas-video-task.ts";

test("persists only recoverable remote video tasks", () => {
    assert.deepEqual(persistedCanvasVideoTask({ id: "task_123", provider: "openai", model: "seedance-2.0-fast-vip" }), {
        id: "task_123",
        provider: "openai",
        model: "seedance-2.0-fast-vip",
    });
    assert.equal(persistedCanvasVideoTask({ id: "local", provider: "plugin", model: "custom" }), undefined);
});

test("rejects incomplete persisted task records", () => {
    assert.equal(recoverableCanvasVideoTask(null), undefined);
    assert.equal(recoverableCanvasVideoTask({ id: "", provider: "openai", model: "seedance" }), undefined);
    assert.equal(recoverableCanvasVideoTask({ id: "task_123", provider: "openai" }), undefined);
});
