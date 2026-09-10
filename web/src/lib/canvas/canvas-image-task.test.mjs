import assert from "node:assert/strict";
import test from "node:test";

import { persistedCanvasImageTask, recoverableCanvasImageTask } from "./canvas-image-task.ts";
import { resetInterruptedGeneration } from "./canvas-generation-helpers.ts";
import { CanvasNodeType } from "../../types/canvas.ts";

test("persists a recoverable remote image task", () => {
    assert.deepEqual(persistedCanvasImageTask({ id: " task_image_123 ", model: " gpt-image-2-special " }), {
        id: "task_image_123",
        model: "gpt-image-2-special",
    });
});

test("rejects incomplete image task records", () => {
    assert.equal(recoverableCanvasImageTask(null), undefined);
    assert.equal(recoverableCanvasImageTask({ id: "", model: "gpt-image-2-special" }), undefined);
    assert.equal(recoverableCanvasImageTask({ id: "task_image_123" }), undefined);
});

test("keeps async image tasks recoverable across refresh", () => {
    const image = { id: "image", type: CanvasNodeType.Image, title: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { status: "loading", imageTask: { id: "task_image_123", model: "gpt-image-2-special" } } };
    const config = { ...image, id: "config", type: CanvasNodeType.Config, metadata: { status: "loading" } };
    const interrupted = { ...image, id: "missing-task", metadata: { status: "loading" } };
    const [restoredImage, restoredConfig, restoredInterrupted] = resetInterruptedGeneration([image, config, interrupted]);
    assert.equal(restoredImage.metadata.status, "loading");
    assert.equal(restoredConfig.metadata.status, "idle");
    assert.equal(restoredInterrupted.metadata.status, "error");
});
