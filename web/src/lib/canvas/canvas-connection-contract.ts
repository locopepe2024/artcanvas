export const DEFAULT_CANVAS_SOURCE_PORT = "output";
export const DEFAULT_CANVAS_TARGET_PORT = "input";

export type CanvasConnectionContractNode = { id: string; type: string };
export type CanvasConnectionContractEdge = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    sourcePort?: string;
    targetPort?: string;
};

const builtinTypes = new Set(["text", "image", "video", "audio", "config", "group"]);
const allowedBuiltinTargets: Record<string, Set<string>> = {
    text: new Set(["text", "image", "video", "audio", "config"]),
    image: new Set(["text", "image", "video", "config"]),
    video: new Set(["text", "video", "audio", "config"]),
    audio: new Set(["text", "video", "audio", "config"]),
    config: new Set(["text", "image", "video", "audio"]),
    group: new Set(),
};

export function createCanvasConnection(id: string, fromNodeId: string, toNodeId: string, sourcePort = DEFAULT_CANVAS_SOURCE_PORT, targetPort = DEFAULT_CANVAS_TARGET_PORT) {
    return { id, fromNodeId, toNodeId, sourcePort, targetPort };
}

export function normalizeCanvasConnections<T extends CanvasConnectionContractEdge>(connections: T[]) {
    return connections.map((connection) => createCanvasConnection(connection.id, connection.fromNodeId, connection.toNodeId, connection.sourcePort || DEFAULT_CANVAS_SOURCE_PORT, connection.targetPort || DEFAULT_CANVAS_TARGET_PORT));
}

export function wouldCreateCanvasCycle(connections: CanvasConnectionContractEdge[], fromNodeId: string, toNodeId: string, ignoreConnectionId?: string) {
    if (fromNodeId === toNodeId) return true;
    const visited = new Set<string>();
    const stack = [toNodeId];
    while (stack.length) {
        const nodeId = stack.pop();
        if (!nodeId || visited.has(nodeId)) continue;
        if (nodeId === fromNodeId) return true;
        visited.add(nodeId);
        connections
            .filter((connection) => connection.id !== ignoreConnectionId && connection.fromNodeId === nodeId)
            .forEach((connection) => {
                if (!visited.has(connection.toNodeId)) stack.push(connection.toNodeId);
            });
    }
    return false;
}

export function isCanvasNodeTypeConnectionAllowed(fromType: string, toType: string) {
    if (fromType === "group" || toType === "group") return false;
    if (!builtinTypes.has(fromType) || !builtinTypes.has(toType)) return true;
    return allowedBuiltinTargets[fromType]?.has(toType) || false;
}

export function getCanvasConnectionValidationError({
    nodes,
    connections,
    connection,
    ignoreConnectionId,
}: {
    nodes: CanvasConnectionContractNode[];
    connections: CanvasConnectionContractEdge[];
    connection: CanvasConnectionContractEdge;
    ignoreConnectionId?: string;
}) {
    if (!connection.fromNodeId || !connection.toNodeId || !connection.sourcePort || !connection.targetPort) return "连线端口无效。";
    if (connection.fromNodeId === connection.toNodeId) return "节点不能连接自身。";
    const fromNode = nodes.find((node) => node.id === connection.fromNodeId);
    const toNode = nodes.find((node) => node.id === connection.toNodeId);
    if (!fromNode || !toNode) return "连接节点不存在。";
    if (fromNode.type === "group" || toNode.type === "group") return "组节点不能参与业务连线。";
    const duplicate = connections.some(
        (item) =>
            item.id !== ignoreConnectionId &&
            item.fromNodeId === connection.fromNodeId &&
            item.toNodeId === connection.toNodeId &&
            (item.sourcePort || DEFAULT_CANVAS_SOURCE_PORT) === connection.sourcePort &&
            (item.targetPort || DEFAULT_CANVAS_TARGET_PORT) === connection.targetPort,
    );
    if (duplicate) return "节点端口已经连接。";
    if (!isCanvasNodeTypeConnectionAllowed(fromNode.type, toNode.type)) return "当前节点类型不支持这样连接。";
    if (wouldCreateCanvasCycle(connections, connection.fromNodeId, connection.toNodeId, ignoreConnectionId)) return "连接会形成循环。";
    return null;
}
