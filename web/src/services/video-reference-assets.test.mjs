import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { isCanvasVideoAssetUrl } from "./video-reference-assets.ts";

describe("video reference asset storage", () => {
    test("recognizes only ArtCanvas same-origin temporary asset URLs", () => {
        const id = "a".repeat(64);
        expect(isCanvasVideoAssetUrl(`https://canvas.uniart.fun/video-assets/${id}.png`, "https://canvas.uniart.fun")).toBe(true);
        expect(isCanvasVideoAssetUrl(`/video-assets/${id}.mp4`, "https://canvas.uniart.fun")).toBe(true);
        expect(isCanvasVideoAssetUrl(`https://uniart.fun/video-assets/${id}.png`, "https://canvas.uniart.fun")).toBe(false);
        expect(isCanvasVideoAssetUrl("blob:https://canvas.uniart.fun/example", "https://canvas.uniart.fun")).toBe(false);
    });

    test("video workbench uploads selected references to ArtCanvas instead of IndexedDB blob stores", () => {
        const source = readFileSync(new URL("../pages/video/index.tsx", import.meta.url), "utf8");
        expect(source).toContain("uploadVideoReferenceAsset(file)");
        expect(source).not.toContain("uploadImage(file)");
        expect(source).not.toContain('uploadMediaFile(file, "video-reference")');
        expect(source).not.toContain('uploadMediaFile(file, "audio-reference")');
    });

    test("task submission reuses an existing ArtCanvas asset URL", () => {
        const source = readFileSync(new URL("./api/video.ts", import.meta.url), "utf8");
        expect(source).toContain("if (isCanvasVideoAssetUrl(directUrl)) return directUrl");
        expect(source).toContain("if (isCanvasVideoAssetUrl(reference.url)) return reference.url");
    });
});
