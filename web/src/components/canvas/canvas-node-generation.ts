import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { getGenerationResourceNodes, getVideoGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, videoMode = false, videoReferenceMode?: CanvasNodeMetadata["videoReferenceMode"]): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections, videoMode ? videoReferenceMode : undefined);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt, videoMode);
    }

    const upstreamText = inputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string, videoMode: boolean): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedByNodeId = new Map<string, NodeGenerationInput>();
    const labelByNodeId = new Map<string, string>();
    let hasToken = false;

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        hasToken = true;
        const input = inputByNodeId.get(match[1]);
        if (input && !selectedByNodeId.has(input.nodeId)) selectedByNodeId.set(input.nodeId, input);
    }

    if (!hasToken) {
        const upstreamText = inputs
            .map((input) => input.text)
            .filter(Boolean)
            .join("\n\n");
        const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
        const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
        const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));
        return {
            prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
            referenceImages,
            referenceVideos,
            referenceAudios,
            textCount: inputs.filter((input) => input.type === "text").length,
            imageCount: referenceImages.length,
            videoCount: referenceVideos.length,
            audioCount: referenceAudios.length,
        };
    }

    const selected = Array.from(selectedByNodeId.values());
    const selectedInputs = selected.filter((input) => input.type !== "text");
    if (videoMode) {
        const images = selectedInputs.filter((input) => input.type === "image");
        const videos = selectedInputs.filter((input) => input.type === "video");
        const audios = selectedInputs.filter((input) => input.type === "audio");
        const referenceCounts = { images: images.length, videos: videos.length };
        images.forEach((input, index) => labelByNodeId.set(input.nodeId, seedanceReferenceLabel("image", index, referenceCounts)));
        videos.forEach((input, index) => labelByNodeId.set(input.nodeId, seedanceReferenceLabel("video", index, referenceCounts)));
        audios.forEach((input, index) => labelByNodeId.set(input.nodeId, seedanceReferenceLabel("audio", index, referenceCounts)));
    } else {
        const counts = { image: 0, video: 0, audio: 0 };
        selectedInputs.forEach((input) => {
            if (input.type === "text") return;
            labelByNodeId.set(input.nodeId, generationLabel(input.type, counts[input.type]++));
        });
    }
    const textInputs = selected.filter((input) => input.type === "text");
    textInputs.forEach((input, index) => labelByNodeId.set(input.nodeId, generationLabel("text", index)));

    let lastIndex = 0;
    let nextPrompt = "";
    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        const label = input ? labelByNodeId.get(input.nodeId) : undefined;
        if (input && label) nextPrompt += input.type === "text" ? `【${label}】` : label;
        lastIndex = match.index + match[0].length;
    }
    nextPrompt += prompt.slice(lastIndex);
    const textBlocks = textInputs.map((input) => `【${labelByNodeId.get(input.nodeId)}】\n${input.text || ""}`);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: textInputs.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], videoReferenceMode?: CanvasNodeMetadata["videoReferenceMode"]): NodeGenerationInput[] {
    const resourceNodes = videoReferenceMode ? getVideoGenerationResourceNodes(nodeId, nodes, connections, videoReferenceMode) : getGenerationResourceNodes(nodeId, nodes, connections);
    return resourceNodes.flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return `视频${index + 1}`;
    if (type === "audio") return `音频${index + 1}`;
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
