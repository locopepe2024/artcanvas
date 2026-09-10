import type { VideoReferenceMode } from "@/stores/use-config-store";
import type { VideoAdapterRequestInput, VideoProviderAdapter } from "./types";

export type MiniMaxH3ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string }; role: "first_frame" | "last_frame" | "reference_image" }
    | { type: "video_url"; video_url: { url: string }; role: "reference_video" }
    | { type: "audio_url"; audio_url: { url: string }; role: "reference_audio" };

export const minimaxH3Adapter: VideoProviderAdapter = {
    buildRequest(input: VideoAdapterRequestInput) {
        return {
            model: input.model,
            content: buildMiniMaxH3Content(input.prompt, input.mode || "omni_reference", input.imageURLs, input.videoURLs, input.audioURLs),
            metadata: { mode: input.mode || "text_to_video" },
            duration: input.duration,
            ...(input.resolution ? { resolution: input.resolution } : {}),
            ratio: input.ratio,
            ...(typeof input.generateAudio === "boolean" ? { generate_audio: input.generateAudio } : {}),
            return_last_frame: false,
            ...(input.faceMode ? { face_mode: true } : {}),
            ...(input.upscaleStyle === "anime" ? { upscale_style: "anime" } : {}),
        };
    },
};

export function buildMiniMaxH3Content(prompt: string, mode: VideoReferenceMode, imageURLs: string[], videoURLs: string[], audioURLs: string[]): MiniMaxH3ContentPart[] {
    const content: MiniMaxH3ContentPart[] = [];
    if (prompt.trim()) content.push({ type: "text", text: prompt.trim() });
    if (mode === "first_last_frames") {
        if (imageURLs[0]) content.push({ type: "image_url", image_url: { url: imageURLs[0] }, role: "first_frame" });
        if (imageURLs[1]) content.push({ type: "image_url", image_url: { url: imageURLs[1] }, role: "last_frame" });
        return content;
    }
    if (mode === "image_to_video") {
        if (imageURLs[0]) content.push({ type: "image_url", image_url: { url: imageURLs[0] }, role: "first_frame" });
        return content;
    }
    imageURLs.forEach((url) => content.push({ type: "image_url", image_url: { url }, role: "reference_image" }));
    videoURLs.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
    audioURLs.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
    return content;
}
