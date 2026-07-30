export type UniArtVideoCapability = {
    family: "globalai" | "sudashui" | "meai" | "seedance-route";
    durations: number[];
    ratios: string[];
    resolutions?: string[];
    defaultDuration: number;
    defaultRatio: string;
    defaultResolution?: string;
    references: {
        maxImages: number;
        maxVideos: number;
        maxAudios: number;
        supportsFrames: boolean;
    };
    source: "uniart-static-v3";
};

export type UniArtVideoReferenceMode = "image_to_video" | "image_reference" | "first_last_frames" | "omni_reference";

export type UniArtVideoReferenceLimits = {
    mode: UniArtVideoReferenceMode;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
};

const durationRange = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => start + index);
const standardRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const meaiRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"];

const references = (maxImages: number, maxVideos = 0, maxAudios = 0, supportsFrames = true) => ({ maxImages, maxVideos, maxAudios, supportsFrames });

function capability(values: Omit<UniArtVideoCapability, "source">): UniArtVideoCapability {
    return { ...values, source: "uniart-static-v3" };
}

const seedanceRouteCapabilities: Record<string, UniArtVideoCapability> = {
    "seedance-2.0-official": capability({ family: "seedance-route", durations: durationRange(4, 15), ratios: standardRatios, resolutions: ["720p", "1080p", "4k"], defaultDuration: 5, defaultRatio: "16:9", defaultResolution: "720p", references: references(1, 0, 1) }),
    "seedance-2.0-vip": capability({ family: "seedance-route", durations: durationRange(4, 15), ratios: standardRatios, resolutions: ["720p", "1080p"], defaultDuration: 6, defaultRatio: "16:9", defaultResolution: "720p", references: references(9, 3, 3) }),
    "seedance-2.0-proxy": capability({ family: "seedance-route", durations: [15], ratios: ["16:9", "9:16", "21:9"], resolutions: ["720p"], defaultDuration: 15, defaultRatio: "16:9", defaultResolution: "720p", references: references(9, 0, 3) }),
    "seedance-2.0-fast-official": capability({ family: "seedance-route", durations: durationRange(4, 15), ratios: standardRatios, resolutions: ["720p"], defaultDuration: 5, defaultRatio: "16:9", defaultResolution: "720p", references: references(1, 0, 1) }),
    "seedance-2.0-fast-vip": capability({ family: "seedance-route", durations: durationRange(4, 15), ratios: standardRatios, resolutions: ["720p"], defaultDuration: 6, defaultRatio: "16:9", defaultResolution: "720p", references: references(9, 3, 3) }),
    "seedance-2.0-fast-proxy": capability({ family: "seedance-route", durations: durationRange(4, 15), ratios: standardRatios, resolutions: ["720p"], defaultDuration: 5, defaultRatio: "16:9", defaultResolution: "720p", references: references(9, 0, 0) }),
};

const sudashuiCapabilities: Record<string, UniArtVideoCapability> = {
    "ua-sd20-07-01-standard-900-720p": capability({ family: "sudashui", durations: [15], ratios: ["16:9", "9:16"], defaultDuration: 15, defaultRatio: "16:9", references: references(9) }),
    "ua-sd20-07-01-fast-900-720p": capability({ family: "sudashui", durations: [5, 10, 15], ratios: ["16:9", "9:16", "21:9"], defaultDuration: 5, defaultRatio: "16:9", references: references(9) }),
    "ua-sd20-07-01-pro-900-720p": capability({ family: "sudashui", durations: [15], ratios: ["16:9", "9:16", "21:9"], defaultDuration: 15, defaultRatio: "16:9", references: references(9) }),
    "ua-sd20-07-01-pro-903-720p": capability({ family: "sudashui", durations: [15], ratios: ["16:9", "9:16"], defaultDuration: 15, defaultRatio: "16:9", references: references(9, 0, 3) }),
    "ua-sd20-07-01-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto", references: references(9, 3, 3) }),
    "ua-sd20-07-02-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto", references: references(9, 3, 3) }),
    "ua-sd20-07-03-standard-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto", references: references(4, 3, 1) }),
    "ua-sd20-07-03-fast-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto", references: references(4, 3, 1) }),
    "ua-sd20-07-04-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto", references: references(9, 3, 3) }),
    "ua-sd20-07-05-fast-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultDuration: 6, defaultRatio: "16:9", references: references(4, 3, 1) }),
    "ua-sd20-07-05-pro-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultDuration: 6, defaultRatio: "16:9", references: references(4, 3, 1) }),
    "ua-sd20-07-06-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto", references: references(9, 3, 3) }),
};

export function getUniArtVideoCapability(model: string): UniArtVideoCapability | null {
    const name = model.trim();
    if (seedanceRouteCapabilities[name]) return seedanceRouteCapabilities[name];
    if (sudashuiCapabilities[name]) return sudashuiCapabilities[name];
    const meaiCode = name.match(/^ua-sd20-09-(\d{2})-/i)?.[1];
    if (meaiCode) {
        const isFull = meaiCode === "08";
        const compact = meaiCode === "04" || meaiCode === "06";
        const noMultimodal = meaiCode === "00";
        return capability({
            family: "meai",
            durations: durationRange(4, 15),
            ratios: meaiRatios,
            resolutions: isFull ? ["720p", "1080p"] : ["720p"],
            defaultDuration: 15,
            defaultRatio: "16:9",
            defaultResolution: "720p",
            references: noMultimodal ? references(9, 0, 0, false) : compact ? references(4, 3, 1) : references(9, 3, 3),
        });
    }
    if (/^sd_2\.0_(?:fast_)?special_(?:720p|1080p|2k|4k)(?:_with_video_ref)?$/i.test(name)) {
        const resolution = name.match(/(?:720p|1080p|2k|4k)/i)?.[0].toLowerCase() || "720p";
        const withVideo = /_with_video_ref$/i.test(name);
        return capability({
            family: "globalai",
            durations: durationRange(4, 15),
            ratios: standardRatios,
            resolutions: [resolution],
            defaultDuration: 5,
            defaultRatio: "16:9",
            defaultResolution: resolution,
            references: references(1, withVideo ? 1 : 0, 1),
        });
    }
    return null;
}

export function resolveUniArtVideoParams(model: string, values: { seconds?: string; ratio?: string; resolution?: string }) {
    const capability = getUniArtVideoCapability(model);
    if (!capability) return null;
    const requestedDuration = Math.floor(Number(values.seconds));
    const seconds = capability.durations.includes(requestedDuration) ? requestedDuration : capability.defaultDuration;
    const normalizedRatio = normalizeRatio(values.ratio || "");
    const compatibleRatio = normalizedRatio === "auto" && capability.ratios.includes("adaptive") ? "adaptive" : normalizedRatio;
    const ratio = capability.ratios.includes(compatibleRatio) ? compatibleRatio : capability.defaultRatio;
    const normalizedResolution = normalizeResolution(values.resolution || "");
    const resolution = capability.resolutions?.find((value) => value.toLowerCase() === normalizedResolution.toLowerCase()) || capability.defaultResolution;
    return { capability, seconds, ratio, resolution };
}

export function supportedUniArtReferenceModes(capability: UniArtVideoCapability): UniArtVideoReferenceMode[] {
    const modes: UniArtVideoReferenceMode[] = [];
    if (capability.references.maxImages > 0) modes.push("image_to_video", "image_reference");
    if (capability.references.supportsFrames) modes.push("first_last_frames");
    if (capability.references.maxVideos > 0 || capability.references.maxAudios > 0) modes.push("omni_reference");
    return modes;
}

export function resolveUniArtReferenceMode(capability: UniArtVideoCapability, requested?: string): UniArtVideoReferenceMode {
    const modes = supportedUniArtReferenceModes(capability);
    return modes.includes(requested as UniArtVideoReferenceMode) ? (requested as UniArtVideoReferenceMode) : modes[0] || "image_reference";
}

export function resolveUniArtReferenceLimits(capability: UniArtVideoCapability, requested?: string): UniArtVideoReferenceLimits {
    const mode = resolveUniArtReferenceMode(capability, requested);
    if (mode === "image_to_video") return { mode, maxImages: 1, maxVideos: 0, maxAudios: 0 };
    if (mode === "first_last_frames") return { mode, maxImages: 2, maxVideos: 0, maxAudios: 0 };
    if (mode === "image_reference") return { mode, maxImages: capability.references.maxImages, maxVideos: 0, maxAudios: 0 };
    return { mode, maxImages: capability.references.maxImages, maxVideos: capability.references.maxVideos, maxAudios: capability.references.maxAudios };
}

function normalizeRatio(value: string) {
    if (standardRatios.includes(value) || value === "auto") return value;
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return value;
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
    if (normalized === "high" || normalized === "medium" || normalized === "auto") return "720p";
    if (normalized === "low") return "480p";
    if (/^\d+$/.test(normalized)) return `${normalized}p`;
    return normalized;
}
