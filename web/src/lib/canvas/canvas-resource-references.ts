import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    displayLabel: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], fallbackVideoReferenceMode?: CanvasNodeMetadata["videoReferenceMode"]) {
    const videoMode = node.type === CanvasNodeType.Video || node.metadata?.generationMode === "video";
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections), true, videoMode, node.metadata?.videoReferenceMode || fallbackVideoReferenceMode);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isResourceNode(node)));
}

function getConnectedConfigResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextResourceNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean, videoMode: boolean, videoReferenceMode?: CanvasNodeMetadata["videoReferenceMode"]) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    const totals = nodes.reduce(
        (result, node) => {
            const kind = resourceKind(node);
            if (kind) result[kind] += 1;
            return result;
        },
        { image: 0, video: 0, audio: 0, text: 0 } as Record<CanvasResourceKind, number>,
    );
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const index = counts[kind]++;
        const label = labelForKind(kind, index, totals, videoMode);
        const displayLabel = videoMode && videoReferenceMode === "first_last_frames" && kind === "image" && index < 2 ? `${index === 0 ? "首帧" : "尾帧"} · ${label}` : label;
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                displayLabel,
                title: node.title || label,
                previewUrl: node.metadata?.content,
                text: resourceText(node),
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number, totals: Record<CanvasResourceKind, number>, videoMode: boolean) {
    if (!videoMode) {
        if (kind === "image") return imageReferenceLabel(index);
        if (kind === "video") return `视频${index + 1}`;
        if (kind === "audio") return `音频${index + 1}`;
    }
    if (kind === "image" || kind === "video" || kind === "audio") return seedanceReferenceLabel(kind, index, { images: totals.image, videos: totals.video });
    return `文本${index + 1}`;
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // 插件节点通过 definition.resource 声明可作为输入
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
