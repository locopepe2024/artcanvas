import { describe, expect, test } from "bun:test";

import { preferredUniArtImageReferenceMode, resolveUniArtReferenceLimits } from "./uniart-video.ts";

describe("UniArt video reference mode selection", () => {
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
});
