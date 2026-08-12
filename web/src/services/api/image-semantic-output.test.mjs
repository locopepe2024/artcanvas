import { describe, expect, test } from "bun:test";

import { resolveUniArtSemanticImageOutput } from "./image.ts";

describe("UniArt semantic image output", () => {
    test("submits 2K as semantic resolution instead of a pixel size for a UniArt fixed SKU", () => {
        expect(resolveUniArtSemanticImageOutput("adobe-firefly-nano-banana2-2k", "2k", "16:9", "https://uniart.fun/v1")).toEqual({
            resolution: "2k",
            aspect_ratio: "16:9",
        });
    });

    test("keeps pixel-size behavior for unrelated OpenAI-compatible endpoints", () => {
        expect(resolveUniArtSemanticImageOutput("custom-image-model", "2k", "16:9", "https://example.com/v1")).toBeNull();
    });
});
