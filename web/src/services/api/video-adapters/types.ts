import type { VideoReferenceMode } from "@/stores/use-config-store";

export type VideoAdapterRequestInput = {
    model: string;
    prompt: string;
    mode?: VideoReferenceMode;
    duration: number;
    ratio: string;
    resolution?: string;
    imageURLs: string[];
    videoURLs: string[];
    audioURLs: string[];
    generateAudio?: boolean;
    watermark: boolean;
    faceMode: boolean;
    upscaleStyle?: "realistic" | "anime";
};

export interface VideoProviderAdapter {
    buildRequest(input: VideoAdapterRequestInput): Record<string, unknown>;
}
