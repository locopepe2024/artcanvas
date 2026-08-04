import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasConnection, getCanvasConnectionValidationError, normalizeCanvasConnections } from "./canvas-connection-contract.ts";

const nodes = [
    { id: "text", type: "text" },
    { id: "image", type: "image" },
    { id: "video", type: "video" },
    { id: "audio", type: "audio" },
    { id: "config", type: "config" },
    { id: "config-2", type: "config" },
    { id: "group", type: "group" },
    { id: "plugin", type: "example:tool" },
];

test("normalizes legacy connections with explicit default ports", () => {
    assert.deepEqual(normalizeCanvasConnections([{ id: "edge-1", fromNodeId: "text", toNodeId: "config" }]), [
        { id: "edge-1", fromNodeId: "text", toNodeId: "config", sourcePort: "output", targetPort: "input" },
    ]);
    assert.deepEqual(createCanvasConnection("edge-2", "config", "image"), {
        id: "edge-2",
        fromNodeId: "config",
        toNodeId: "image",
        sourcePort: "output",
        targetPort: "input",
    });
});

test("rejects self connections and directed cycles", () => {
    const connections = [createCanvasConnection("a-b", "text", "image"), createCanvasConnection("b-c", "image", "video")];
    assert.equal(getCanvasConnectionValidationError({ nodes, connections, connection: createCanvasConnection("self", "text", "text") }), "节点不能连接自身。");
    assert.equal(getCanvasConnectionValidationError({ nodes, connections, connection: createCanvasConnection("cycle", "video", "text") }), "连接会形成循环。");
});

test("applies the builtin node connection matrix", () => {
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("text-image", "text", "image") }), null);
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("image-video", "image", "video") }), null);
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("video-audio", "video", "audio") }), null);
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("config-image", "config", "image") }), null);
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("audio-image", "audio", "image") }), "当前节点类型不支持这样连接。");
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("video-image", "video", "image") }), "当前节点类型不支持这样连接。");
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("config-config", "config", "config-2") }), "当前节点类型不支持这样连接。");
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("group-text", "group", "text") }), "组节点不能参与业务连线。");
});

test("keeps registered plugin node types extensible while enforcing graph safety", () => {
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("plugin-video", "plugin", "video") }), null);
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [], connection: createCanvasConnection("text-plugin", "text", "plugin") }), null);
});

test("treats a port-level duplicate as an existing connection", () => {
    const connection = createCanvasConnection("edge-1", "text", "config");
    assert.equal(getCanvasConnectionValidationError({ nodes, connections: [connection], connection: createCanvasConnection("edge-2", "text", "config") }), "节点端口已经连接。");
});
