import type { VideoCapability, VideoReferenceMode } from "@/stores/use-config-store";

export type UniArtVideoCapability = VideoCapability;
export type UniArtVideoReferenceMode = VideoReferenceMode;

export type UniArtVideoReferenceLimits = {
    mode: UniArtVideoReferenceMode;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
};

// UniArt's public model capability intentionally publishes input kinds but not
// candidate-specific quantity limits. Infinity means "supported, server-owned
// admission limit"; zero remains the only unsupported value.
export const SERVER_VALIDATED_REFERENCE_LIMIT = Number.POSITIVE_INFINITY;

/** H3 提示词优化按模型家族开放；生成参数仍只读取 UniArt 发布的能力数据。 */
export function isMiniMaxH3Model(value: string) {
    return /(?:^|[^a-z0-9])minimax[-_ ]?h3(?:[^a-z0-9]|$)/i.test(value);
}

export function resolveUniArtVideoParams(capability: UniArtVideoCapability, values: { seconds?: string; ratio?: string; resolution?: string }) {
    const requestedDuration = Math.floor(Number(values.seconds));
    const seconds = capability.durations?.includes(requestedDuration) ? requestedDuration : capability.defaultDuration || 0;
    const requestedResolution = normalizeResolution(values.resolution || "");
    const resolution = capability.resolutions?.find((item) => item.toLowerCase() === requestedResolution.toLowerCase()) || capability.defaultResolution || "";
    const ratiosForResolution = capability.ratiosByResolution ? capability.ratiosByResolution[resolution.toLowerCase()] || [] : capability.ratios || [];
    const requestedRatio = normalizeRatio(values.ratio || "");
    const defaultRatio = capability.defaultRatio && ratiosForResolution.some((item) => item.toLowerCase() === capability.defaultRatio?.toLowerCase()) ? capability.defaultRatio : "";
    const ratio = ratiosForResolution.find((item) => item.toLowerCase() === requestedRatio.toLowerCase()) || defaultRatio;
    return { capability, seconds, ratio, resolution };
}

export function uniArtVideoParamsError(params: ReturnType<typeof resolveUniArtVideoParams>) {
    if (!params.seconds) return "UniArt 尚未发布当前模型的时长能力，请刷新模型列表";
    if (!params.resolution) return "UniArt 尚未发布当前模型的分辨率能力，请刷新模型列表";
    if (!params.ratio) return "UniArt 尚未发布当前分辨率的比例能力，请刷新模型列表";
    return null;
}

export function supportedUniArtReferenceModes(capability: UniArtVideoCapability): UniArtVideoReferenceMode[] {
    const modes: UniArtVideoReferenceMode[] = [];
    if (capability.modes.some((mode) => mode.id === "text_to_video" && mode.inputTypes.includes("text"))) modes.push("text_to_video");
    if (capability.modes.some((mode) => mode.id === "image_to_video" && mode.inputTypes.includes("image"))) modes.push("image_to_video");
    if (capability.modes.some((mode) => mode.id === "image_reference" && mode.inputTypes.includes("image"))) modes.push("image_reference");
    if (capability.modes.some((mode) => mode.id === "first_last_frame" && mode.inputTypes.includes("image"))) modes.push("first_last_frames");
    if (capability.modes.some((mode) => mode.id === "omni_reference" && mode.inputTypes.some((input) => input !== "text"))) modes.push("omni_reference");
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
    const modeDefinition = capability.modes.find((item) => (mode === "first_last_frames" ? item.id === "first_last_frame" : item.id === mode));
    if (mode === "image_to_video") return { mode, maxImages: modeDefinition?.inputTypes.includes("image") ? 1 : 0, maxVideos: 0, maxAudios: 0 };
    if (mode === "first_last_frames") return { mode, maxImages: modeDefinition?.inputTypes.includes("image") ? 2 : 0, maxVideos: 0, maxAudios: 0 };
    if (mode === "image_reference") return { mode, maxImages: publishedReferenceLimit(modeDefinition?.inputTypes.includes("image") === true, capability.maxReferenceImages), maxVideos: 0, maxAudios: 0 };
    const inputs = modeDefinition?.inputTypes || [];
    return {
        mode,
        maxImages: publishedReferenceLimit(inputs.includes("image"), capability.maxReferenceImages),
        maxVideos: publishedReferenceLimit(inputs.includes("video"), capability.maxReferenceVideos),
        maxAudios: publishedReferenceLimit(inputs.includes("audio"), capability.maxReferenceAudios),
    };
}

function publishedReferenceLimit(supported: boolean, limit?: number) {
    if (!supported) return 0;
    return limit === undefined ? SERVER_VALIDATED_REFERENCE_LIMIT : limit;
}

export function uniArtVideoSubmissionError(
    mode: UniArtVideoReferenceMode,
    prompt: string,
    counts: { images: number; videos: number; audios: number },
    limits?: UniArtVideoReferenceLimits,
) {
    const { images, videos, audios } = counts;
    const mediaCount = images + videos + audios;
    if (mode === "text_to_video") {
        if (mediaCount) return "文生视频模式不能使用参考素材，请切换到图生视频、参考或首尾帧模式";
        return prompt.trim() ? null : "文生视频需要填写提示词";
    }
    if (mode === "image_to_video" && (!limits?.maxImages || images !== 1 || videos || audios)) return limits?.maxImages ? "图生视频模式需要且只能使用 1 张图片" : "UniArt 尚未发布图生视频图片输入能力，请刷新模型能力";
    if (mode === "image_reference" && (!limits?.maxImages || images < 1 || images > limits.maxImages || videos || audios))
        return limits?.maxImages ? (Number.isFinite(limits.maxImages) ? `图片参考模式需要使用 1 至 ${limits.maxImages} 张图片` : "图片参考模式至少需要使用 1 张图片") : "UniArt 尚未发布图片参考输入能力，请刷新模型能力";
    if (mode === "first_last_frames" && (!limits?.maxImages || images !== 2 || videos || audios)) return limits?.maxImages ? "首尾帧模式需要且只能使用 2 张图片，第 1 张为首帧，第 2 张为尾帧" : "UniArt 尚未发布首尾帧图片输入能力，请刷新模型能力";
    if (mode === "omni_reference") {
        if (mediaCount < 1) return "全能参考模式至少需要 1 个图片、视频或音频素材";
        if (!limits || (!limits.maxImages && !limits.maxVideos && !limits.maxAudios)) return "UniArt 尚未发布全能参考素材输入能力，请刷新模型列表";
        if (images > limits.maxImages || videos > limits.maxVideos || audios > limits.maxAudios) return "参考素材数量超过 UniArt 当前模型能力上限";
    }
    return null;
}

function normalizeRatio(value: string) {
    const normalized = value.trim().toLowerCase();
    if (["21:9", "16:9", "9:16", "1:1", "4:3", "3:4", "auto", "adaptive"].includes(normalized)) return normalized;
    const match = normalized.match(/^(\d+)x(\d+)$/i);
    if (!match) return normalized;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width === height) return "1:1";
    if (width * 4 === height * 3) return "4:3";
    if (width * 3 === height * 4) return "3:4";
    if (width * 16 === height * 9) return "16:9";
    if (width * 9 === height * 16) return "9:16";
    return normalized;
}

function normalizeResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    if (/^\d+$/.test(normalized)) return `${normalized}p`;
    return normalized;
}
