export type UniArtVideoCapability = {
    family: "globalai" | "sudashui" | "meai";
    durations: number[];
    ratios: string[];
    resolutions?: string[];
    defaultDuration: number;
    defaultRatio: string;
    defaultResolution?: string;
    source: "uniart-static-v1";
};

const durationRange = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => start + index);
const standardRatios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const meaiRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"];

function capability(values: Omit<UniArtVideoCapability, "source">): UniArtVideoCapability {
    return { ...values, source: "uniart-static-v1" };
}

const sudashuiCapabilities: Record<string, UniArtVideoCapability> = {
    "ua-sd20-07-01-standard-900-720p": capability({ family: "sudashui", durations: [15], ratios: ["16:9", "9:16"], defaultDuration: 15, defaultRatio: "16:9" }),
    "ua-sd20-07-01-fast-900-720p": capability({ family: "sudashui", durations: [5, 10, 15], ratios: ["16:9", "9:16", "21:9"], defaultDuration: 5, defaultRatio: "16:9" }),
    "ua-sd20-07-01-pro-900-720p": capability({ family: "sudashui", durations: [15], ratios: ["16:9", "9:16", "21:9"], defaultDuration: 15, defaultRatio: "16:9" }),
    "ua-sd20-07-01-pro-903-720p": capability({ family: "sudashui", durations: [15], ratios: ["16:9", "9:16"], defaultDuration: 15, defaultRatio: "16:9" }),
    "ua-sd20-07-01-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto" }),
    "ua-sd20-07-02-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto" }),
    "ua-sd20-07-03-standard-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto" }),
    "ua-sd20-07-03-fast-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto" }),
    "ua-sd20-07-04-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto" }),
    "ua-sd20-07-05-fast-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultDuration: 6, defaultRatio: "16:9" }),
    "ua-sd20-07-05-pro-431-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultDuration: 6, defaultRatio: "16:9" }),
    "ua-sd20-07-06-pro-933-720p": capability({ family: "sudashui", durations: durationRange(4, 15), ratios: ["auto"], defaultDuration: 6, defaultRatio: "auto" }),
};

export function getUniArtVideoCapability(model: string): UniArtVideoCapability | null {
    const name = model.trim();
    if (sudashuiCapabilities[name]) return sudashuiCapabilities[name];
    if (/^ua-sd20-09-/i.test(name)) {
        return capability({ family: "meai", durations: durationRange(4, 15), ratios: meaiRatios, resolutions: ["720P", "1080P"], defaultDuration: 15, defaultRatio: "16:9", defaultResolution: "720P" });
    }
    if (/^sd_2\.0_(?:fast_)?special_(?:720p|1080p|2k|4k)(?:_with_video_ref)?$/i.test(name)) {
        const resolution = name.match(/(?:720p|1080p|2k|4k)/i)?.[0].toLowerCase() || "720p";
        return capability({ family: "globalai", durations: durationRange(4, 15), ratios: standardRatios, resolutions: [resolution], defaultDuration: 5, defaultRatio: "16:9", defaultResolution: resolution });
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

function normalizeRatio(value: string) {
    if (standardRatios.includes(value) || value === "auto") return value;
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return value;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (Math.abs(width - height) / Math.max(width, height) < 0.03) return "1:1";
    return width > height ? "16:9" : "9:16";
}

function normalizeResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high" || normalized === "medium" || normalized === "auto") return "720p";
    if (normalized === "low") return "480p";
    if (/^\d+$/.test(normalized)) return `${normalized}p`;
    return normalized;
}
