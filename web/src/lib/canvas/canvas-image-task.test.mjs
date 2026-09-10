import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { persistedCanvasImageTask, recoverableCanvasImageTask } from "./canvas-image-task.ts";

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
    const source = readFileSync(new URL("./canvas-generation-helpers.ts", import.meta.url), "utf8");
    assert.match(source, /CanvasNodeType\.Image && recoverableCanvasImageTask\(node\.metadata\.imageTask\)/);
    assert.match(source, /CanvasNodeType\.Config.*status: "idle"/);
});
