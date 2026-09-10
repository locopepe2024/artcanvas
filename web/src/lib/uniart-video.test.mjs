import { describe, expect, test } from "bun:test";

import { buildUniArtOfficialContent } from "../services/api/video.ts";
import { minimaxH3Adapter } from "../services/api/video-adapters/minimax-h3.ts";
import { isMiniMaxH3Model, preferredUniArtImageReferenceMode, resolveUniArtReferenceLimits, resolveUniArtVideoParams, SERVER_VALIDATED_REFERENCE_LIMIT, uniArtVideoParamsError, uniArtVideoSubmissionError } from "./uniart-video.ts";

describe("UniArt video reference mode selection", () => {
    test("keeps H3 prompt optimization active before detailed capability refresh completes", () => {
        expect(isMiniMaxH3Model("minimax-h3-vip")).toBe(true);
        expect(isMiniMaxH3Model("channel-1::minimax_h3_discount")).toBe(true);
        expect(isMiniMaxH3Model("minimax-h3-vip（UniArt）")).toBe(true);
        expect(isMiniMaxH3Model("seedance-v1-pro")).toBe(false);
    });

    test("offers an image-capable mode while text-to-video is selected", () => {
        const capability = {
            durations: [5],
            ratios: ["16:9"],
            resolutions: ["720p"],
            modes: [{ id: "text_to_video", inputTypes: ["text"] }, { id: "image_to_video", inputTypes: ["image"] }, { id: "omni_reference", inputTypes: ["image", "video", "audio"] }],
        };
        expect(preferredUniArtImageReferenceMode(capability)).toBe("image_to_video");
        expect(resolveUniArtReferenceLimits(capability, "text_to_video").maxImages).toBe(0);
        expect(resolveUniArtReferenceLimits(capability, "image_to_video").maxImages).toBe(1);
    });

    test("prefers image-reference when the model exposes it", () => {
        const capability = {
            durations: [5],
            ratios: ["16:9"],
            resolutions: ["720p"],
            modes: [{ id: "text_to_video", inputTypes: ["text"] }, { id: "omni_reference", inputTypes: ["image"] }, { id: "image_reference", inputTypes: ["image"] }],
        };
        expect(preferredUniArtImageReferenceMode(capability)).toBe("image_reference");
    });

    test("uses published input types when UniArt keeps quantity admission server-side", () => {
        const capability = {
            modes: [{ id: "omni_reference", inputTypes: ["image", "audio"] }],
        };
        expect(resolveUniArtReferenceLimits(capability, "omni_reference")).toEqual({ mode: "omni_reference", maxImages: SERVER_VALIDATED_REFERENCE_LIMIT, maxVideos: 0, maxAudios: SERVER_VALIDATED_REFERENCE_LIMIT });
        expect(uniArtVideoSubmissionError("omni_reference", "", { images: 1, videos: 0, audios: 1 }, resolveUniArtReferenceLimits(capability, "omni_reference"))).toBeNull();
    });

    test("exposes omni audio/video inputs from the published limits", () => {
        const capability = {
            modes: [{ id: "omni_reference", inputTypes: ["image", "video", "audio"] }],
            maxReferenceImages: 9,
            maxReferenceVideos: 3,
            maxReferenceAudios: 3,
        };
        expect(resolveUniArtReferenceLimits(capability, "omni_reference")).toEqual({ mode: "omni_reference", maxImages: 9, maxVideos: 3, maxAudios: 3 });
    });

    test("requires the published image input type for image modes", () => {
        const capability = { modes: [{ id: "first_last_frame", inputTypes: ["text"] }] };
        expect(resolveUniArtReferenceLimits(capability, "first_last_frames").maxImages).toBe(0);
        expect(uniArtVideoSubmissionError("first_last_frames", "", { images: 2, videos: 0, audios: 0 }, resolveUniArtReferenceLimits(capability, "first_last_frames"))).toContain("图片输入能力");
    });

    test("keeps text-to-video text-only and maps frame roles", () => {
        expect(uniArtVideoSubmissionError("text_to_video", "a prompt", { images: 1, videos: 0, audios: 0 })).toContain("不能使用参考素材");
        expect(buildUniArtOfficialContent("", "first_last_frames", ["first", "last"], [], [])).toEqual([
            { type: "image_url", image_url: { url: "first" }, role: "first_frame" },
            { type: "image_url", image_url: { url: "last" }, role: "last_frame" },
        ]);
    });

    test("blocks parameters that UniArt has not published", () => {
        expect(uniArtVideoParamsError(resolveUniArtVideoParams({ modes: [{ id: "text_to_video", inputTypes: ["text"] }] }, {}))).toContain("时长能力");
    });

    test("uses the published ratio set for each H3 resolution", () => {
        const capability = {
            modes: [{ id: "text_to_video", inputTypes: ["text"] }],
            resolutions: ["720p", "2k"],
            ratiosByResolution: { "720p": ["16:9", "9:16"], "2k": ["16:9", "9:16", "1:1"] },
            durations: [6],
        };
        expect(resolveUniArtVideoParams(capability, { seconds: "6", resolution: "2k", ratio: "1:1" }).ratio).toBe("1:1");
        expect(resolveUniArtVideoParams(capability, { seconds: "6", resolution: "720p", ratio: "1:1" }).ratio).toBe("");
    });

    test("does not send optional fields that UniArt did not publish", () => {
        const request = minimaxH3Adapter.buildRequest({ model: "minimax-h3-vip", prompt: "test", mode: "text_to_video", duration: 6, ratio: "16:9", resolution: "2k", imageURLs: [], videoURLs: [], audioURLs: [], watermark: false, faceMode: false });
        expect(request).not.toHaveProperty("generate_audio");
        expect(request).not.toHaveProperty("face_mode");
    });

    test("sends anime upscale only when explicitly selected", () => {
        const request = minimaxH3Adapter.buildRequest({ model: "minimax-h3-vip", prompt: "test", mode: "image_reference", duration: 6, ratio: "4:3", resolution: "2k", imageURLs: ["https://example.com/a", "https://example.com/b"], videoURLs: [], audioURLs: [], watermark: false, faceMode: false, upscaleStyle: "anime" });
        expect(request).toHaveProperty("upscale_style", "anime");
        const realistic = minimaxH3Adapter.buildRequest({ model: "minimax-h3-vip", prompt: "test", mode: "image_reference", duration: 6, ratio: "4:3", resolution: "2k", imageURLs: ["https://example.com/a", "https://example.com/b"], videoURLs: [], audioURLs: [], watermark: false, faceMode: false, upscaleStyle: "realistic" });
        expect(realistic).not.toHaveProperty("upscale_style");
    });

    test("does not leak upscale fields into Seedance requests", async () => {
        const { seedanceAdapter } = await import("../services/api/video-adapters/seedance.ts");
        const request = seedanceAdapter.buildRequest({ model: "seedance", prompt: "test", mode: "image_reference", duration: 5, ratio: "1:1", resolution: "720p", imageURLs: [], videoURLs: [], audioURLs: [], watermark: false, faceMode: false, upscaleStyle: "anime" });
        expect(request).not.toHaveProperty("upscale_style");
    });
});
