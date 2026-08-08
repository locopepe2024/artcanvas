import assert from "node:assert/strict";
import test from "node:test";

import { persistedCanvasVideoResult, persistedCanvasVideoTask, recoverableCanvasVideoResult, recoverableCanvasVideoTask } from "./canvas-video-task.ts";

test("persists only recoverable remote video tasks", () => {
    assert.deepEqual(persistedCanvasVideoTask({ id: "task_123", provider: "openai", model: "seedance-2.0-fast-vip", channelId: "uniart" }), {
        id: "task_123",
        provider: "openai",
        model: "seedance-2.0-fast-vip",
        channelId: "uniart",
    });
    assert.equal(persistedCanvasVideoTask({ id: "local", provider: "plugin", model: "custom" }), undefined);
});

test("rejects incomplete persisted task records", () => {
    assert.equal(recoverableCanvasVideoTask(null), undefined);
    assert.equal(recoverableCanvasVideoTask({ id: "", provider: "openai", model: "seedance" }), undefined);
    assert.equal(recoverableCanvasVideoTask({ id: "task_123", provider: "openai" }), undefined);
});

test("persists a terminal video result separately from its task", () => {
    assert.deepEqual(persistedCanvasVideoResult({ url: "/v1/videos/task_123/content", model: "seedance-2.0", channelId: "uniart", requiresAuth: true, mimeType: "video/mp4" }), {
        url: "/v1/videos/task_123/content",
        model: "seedance-2.0",
        channelId: "uniart",
        requiresAuth: true,
        mimeType: "video/mp4",
    });
});

test("rejects incomplete terminal video results", () => {
    assert.equal(recoverableCanvasVideoResult(null), undefined);
    assert.equal(recoverableCanvasVideoResult({ url: "" }), undefined);
    assert.deepEqual(recoverableCanvasVideoResult({ url: "https://cdn.example.com/video.mp4" }), { url: "https://cdn.example.com/video.mp4" });
});
