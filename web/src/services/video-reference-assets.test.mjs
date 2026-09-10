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

    test("UniArt image edits submit hosted URLs as JSON", () => {
        const source = readFileSync(new URL("./api/image.ts", import.meta.url), "utf8");
        expect(source).toContain("if (isUniArtApiUrl(requestConfig.baseUrl))");
        expect(source).toContain("uploadVideoReferenceAsset(file, undefined, options?.signal)");
        expect(source).toContain("images,");
        expect(source).toContain("const maskUrl = mask ? await resolveUniArtImageReferenceUrl(mask, options) : undefined");
        expect(source).toContain("...(maskUrl ? { mask: maskUrl } : {}),");
        expect(source).not.toContain("UniArt URL 素材接口暂不支持蒙版编辑");
        expect(source).toContain('aiHeaders(requestConfig, "application/json")');
    });

    test("all video reference modes resolve local media to hosted URLs", () => {
        const source = readFileSync(new URL("./api/video.ts", import.meta.url), "utf8");
        expect(source).toContain("resolveSeedanceImageUrl(image, options)");
        expect(source).toContain("resolveSeedanceVideoUrl(video, options)");
        expect(source).toContain("resolveSeedanceAudioUrl(audio, options)");
        expect(source).toContain("uploadVideoReferenceAsset(file, undefined, options?.signal)");
        expect(source).toContain("uploadVideoReferenceAsset(blob, video.name, options?.signal)");
        expect(source).toContain("uploadVideoReferenceAsset(blob, audio.name, options?.signal)");
        expect(source).not.toContain("return blobToDataUrl(blob)");
    });
});
