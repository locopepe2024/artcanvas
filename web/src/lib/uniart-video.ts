import type { VideoCapability, VideoReferenceMode } from "@/stores/use-config-store";

export type UniArtVideoCapability = VideoCapability;
export type UniArtVideoReferenceMode = VideoReferenceMode;

export type UniArtVideoReferenceLimits = {
    mode: UniArtVideoReferenceMode;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
};

// These are browser upload safety ceilings, not provider or model capability
// limits. UniArt remains authoritative for numeric admission.
const CLIENT_IMAGE_UPLOAD_CEILING = 20;
const IMAGE_REFERENCE_UPLOAD_LIMIT = 9;
const CLIENT_MEDIA_UPLOAD_CEILING = 10;

export function resolveUniArtVideoParams(capability: UniArtVideoCapability, values: { seconds?: string; ratio?: string; resolution?: string }) {
    const requestedDuration = Math.floor(Number(values.seconds));
    const fallbackSeconds = Math.max(4, Math.min(15, Number.isFinite(requestedDuration) ? requestedDuration : 6));
    const seconds = capability.durations?.includes(requestedDuration) ? requestedDuration : capability.defaultDuration || capability.durations?.[0] || fallbackSeconds;
    const requestedRatio = normalizeRatio(values.ratio || "") || "16:9";
    const ratio = capability.ratios?.find((item) => item.toLowerCase() === requestedRatio.toLowerCase()) || capability.defaultRatio || capability.ratios?.[0] || requestedRatio;
    const requestedResolution = normalizeResolution(values.resolution || "") || "720p";
    const resolution = capability.resolutions?.find((item) => item.toLowerCase() === requestedResolution.toLowerCase()) || capability.defaultResolution || capability.resolutions?.[0] || requestedResolution;
    return { capability, seconds, ratio, resolution };
}

export function supportedUniArtReferenceModes(capability: UniArtVideoCapability): UniArtVideoReferenceMode[] {
    const modes: UniArtVideoReferenceMode[] = [];
    if (capability.modes.some((mode) => mode.id === "text_to_video")) modes.push("text_to_video");
    if (capability.modes.some((mode) => mode.id === "image_to_video")) modes.push("image_to_video");
    if (capability.modes.some((mode) => mode.id === "image_reference")) modes.push("image_reference");
    if (capability.modes.some((mode) => mode.id === "first_last_frame")) modes.push("first_last_frames");
    if (capability.modes.some((mode) => mode.id === "omni_reference")) modes.push("omni_reference");
    return modes;
}

export function preferredUniArtImageReferenceMode(capability: UniArtVideoCapability): UniArtVideoReferenceMode | null {
    const modes = supportedUniArtReferenceModes(capability);
    return (["image_reference", "image_to_video", "first_last_frames", "omni_reference"] as UniArtVideoReferenceMode[]).find((mode) => modes.includes(mode)) || null;
}

export function resolveUniArtReferenceMode(capability: UniArtVideoCapability, requested?: string): UniArtVideoReferenceMode {
    const modes = supportedUniArtReferenceModes(capability);
    return modes.includes(requested as UniArtVideoReferenceMode) ? (requested as UniArtVideoReferenceMode) : modes[0] || "image_reference";
}

export function resolveUniArtReferenceLimits(capability: UniArtVideoCapability, requested?: string): UniArtVideoReferenceLimits {
    if (!supportedUniArtReferenceModes(capability).length) return { mode: "image_reference", maxImages: 0, maxVideos: 0, maxAudios: 0 };
    const mode = resolveUniArtReferenceMode(capability, requested);
    if (mode === "text_to_video") return { mode, maxImages: 0, maxVideos: 0, maxAudios: 0 };
    if (mode === "image_to_video") return { mode, maxImages: 1, maxVideos: 0, maxAudios: 0 };
    if (mode === "first_last_frames") return { mode, maxImages: 2, maxVideos: 0, maxAudios: 0 };
    if (mode === "image_reference") return { mode, maxImages: IMAGE_REFERENCE_UPLOAD_LIMIT, maxVideos: 0, maxAudios: 0 };
    const inputs = capability.modes.find((item) => item.id === "omni_reference")?.inputTypes || [];
    return {
        mode,
        maxImages: inputs.includes("image") ? CLIENT_IMAGE_UPLOAD_CEILING : 0,
        maxVideos: inputs.includes("video") ? CLIENT_MEDIA_UPLOAD_CEILING : 0,
        maxAudios: inputs.includes("audio") ? CLIENT_MEDIA_UPLOAD_CEILING : 0,
    };
}

export function uniArtVideoSubmissionError(
    mode: UniArtVideoReferenceMode,
    prompt: string,
    counts: { images: number; videos: number; audios: number },
) {
    const { images, videos, audios } = counts;
    const mediaCount = images + videos + audios;
    if (mode === "text_to_video") return prompt.trim() ? null : "文生视频需要填写提示词";
    if (mode === "image_to_video" && (images !== 1 || videos || audios)) return "图生视频模式需要且只能使用 1 张图片";
    if (mode === "image_reference" && (images < 1 || images > IMAGE_REFERENCE_UPLOAD_LIMIT || videos || audios)) return "图片参考模式需要使用 1 至 9 张图片";
    if (mode === "first_last_frames" && (images !== 2 || videos || audios)) return "首尾帧模式需要且只能使用 2 张图片，第 1 张为首帧，第 2 张为尾帧";
    if (mode === "omni_reference" && mediaCount < 1) return "全能参考模式至少需要 1 个图片、视频或音频素材";
    return null;
}

function normalizeRatio(value: string) {
    const normalized = value.trim().toLowerCase();
    if (["21:9", "16:9", "9:16", "1:1", "4:3", "3:4", "auto", "adaptive"].includes(normalized)) return normalized;
    const match = normalized.match(/^(\d+)x(\d+)$/i);
    if (!match) return normalized;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.05) return "1:1";
    if (Math.abs(ratio - 4 / 3) < 0.08) return "4:3";
    if (Math.abs(ratio - 3 / 4) < 0.08) return "3:4";
    return width > height ? "16:9" : "9:16";
}

function normalizeResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high") return "1080p";
    if (normalized === "medium" || normalized === "auto") return "720p";
    if (normalized === "low") return "480p";
    if (/^\d+$/.test(normalized)) return `${normalized}p`;
    return normalized;
}
