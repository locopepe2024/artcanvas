import type { VideoReferenceMode } from "@/stores/use-config-store";
import type { VideoAdapterRequestInput, VideoProviderAdapter } from "./types";

type SeedanceContentPart = Record<string, unknown>;

export const seedanceAdapter: VideoProviderAdapter = {
    buildRequest(input: VideoAdapterRequestInput) {
        return {
            model: input.model,
            content: buildSeedanceContent(input.prompt, input.mode, input.imageURLs, input.videoURLs, input.audioURLs),
            metadata: { mode: input.mode || "text_to_video" },
            ratio: input.ratio,
            resolution: input.resolution,
            duration: input.duration,
            ...(typeof input.generateAudio === "boolean" ? { generate_audio: input.generateAudio } : {}),
            watermark: input.watermark,
        };
    },
};

export function seedanceFrameRole(mode: VideoReferenceMode | undefined, index: number): "first_frame" | "last_frame" | "reference_image" {
    if (mode === "first_last_frames") return index === 0 ? "first_frame" : "last_frame";
    if (mode === "image_to_video") return "first_frame";
    return "reference_image";
}

export function buildSeedanceContent(
    prompt: string,
    mode: VideoReferenceMode | undefined,
    imageURLs: string[],
    videoURLs: string[],
    audioURLs: string[],
): SeedanceContentPart[] {
    const content: SeedanceContentPart[] = [];
    if (prompt.trim()) content.push({ type: "text", text: prompt.trim() });
    if (mode === "first_last_frames") {
        if (imageURLs[0]) content.push({ type: "image_url", image_url: { url: imageURLs[0] }, role: seedanceFrameRole(mode, 0) });
        if (imageURLs[1]) content.push({ type: "image_url", image_url: { url: imageURLs[1] }, role: seedanceFrameRole(mode, 1) });
        return content;
    }
    if (mode === "image_to_video") {
        if (imageURLs[0]) content.push({ type: "image_url", image_url: { url: imageURLs[0] }, role: seedanceFrameRole(mode, 0) });
        return content;
    }
    imageURLs.forEach((url) => content.push({ type: "image_url", image_url: { url }, role: "reference_image" }));
    videoURLs.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
    audioURLs.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
    return content;
}
