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
const CLIENT_MEDIA_UPLOAD_CEILING = 10;

export function resolveUniArtVideoParams(capability: UniArtVideoCapability, values: { seconds?: string; ratio?: string; resolution?: string }) {
    const requestedDuration = Math.floor(Number(values.seconds));
    const seconds = Math.max(4, Math.min(15, Number.isFinite(requestedDuration) ? requestedDuration : 6));
    const ratio = normalizeRatio(values.ratio || "") || "16:9";
    const resolution = normalizeResolution(values.resolution || "") || "720p";
    return { capability, seconds, ratio, resolution };
}

export function supportedUniArtReferenceModes(capability: UniArtVideoCapability): UniArtVideoReferenceMode[] {
    const modes: UniArtVideoReferenceMode[] = [];
    if (capability.modes.some((mode) => mode.id === "image_to_video")) modes.push("image_to_video");
    if (capability.modes.some((mode) => mode.id === "image_reference")) modes.push("image_reference");
    if (capability.modes.some((mode) => mode.id === "first_last_frame")) modes.push("first_last_frames");
    if (capability.modes.some((mode) => mode.id === "omni_reference")) modes.push("omni_reference");
    return modes;
}

export function resolveUniArtReferenceMode(capability: UniArtVideoCapability, requested?: string): UniArtVideoReferenceMode {
    const modes = supportedUniArtReferenceModes(capability);
    return modes.includes(requested as UniArtVideoReferenceMode) ? (requested as UniArtVideoReferenceMode) : modes[0] || "image_reference";
}

export function resolveUniArtReferenceLimits(capability: UniArtVideoCapability, requested?: string): UniArtVideoReferenceLimits {
    if (!supportedUniArtReferenceModes(capability).length) return { mode: "image_reference", maxImages: 0, maxVideos: 0, maxAudios: 0 };
    const mode = resolveUniArtReferenceMode(capability, requested);
    if (mode === "image_to_video") return { mode, maxImages: 1, maxVideos: 0, maxAudios: 0 };
    if (mode === "first_last_frames") return { mode, maxImages: 2, maxVideos: 0, maxAudios: 0 };
    if (mode === "image_reference") return { mode, maxImages: CLIENT_IMAGE_UPLOAD_CEILING, maxVideos: 0, maxAudios: 0 };
    const inputs = capability.modes.find((item) => item.id === "omni_reference")?.inputTypes || [];
    return {
        mode,
        maxImages: inputs.includes("image") ? CLIENT_IMAGE_UPLOAD_CEILING : 0,
        maxVideos: inputs.includes("video") ? CLIENT_MEDIA_UPLOAD_CEILING : 0,
        maxAudios: inputs.includes("audio") ? CLIENT_MEDIA_UPLOAD_CEILING : 0,
    };
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
