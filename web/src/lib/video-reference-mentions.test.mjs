import { describe, expect, test } from "bun:test";

import { buildVideoReferenceMentions } from "./video-reference-mentions.ts";

describe("video page reference mentions", () => {
    test("keeps the global image, video, audio numbering contract", () => {
        const references = buildVideoReferenceMentions(
            [
                { id: "image-1", name: "人物持枪图片.png", type: "image/png", dataUrl: "https://canvas.test/1.png" },
                { id: "image-2", name: "角色近景.png", type: "image/png", dataUrl: "https://canvas.test/2.png" },
            ],
            [{ id: "video-1", name: "动作参考.mp4", type: "video/mp4", url: "https://canvas.test/1.mp4" }],
            [{ id: "audio-1", name: "角色声音.mp3", type: "audio/mpeg", url: "https://canvas.test/1.mp3" }],
        );

        expect(references.map((reference) => reference.label)).toEqual(["@1", "@2", "@3", "@4"]);
        expect(references.map((reference) => reference.kind)).toEqual(["image", "image", "video", "audio"]);
        expect(references[0].title).toBe("人物持枪图片.png");
    });

    test("shows frame roles without changing submitted labels", () => {
        const references = buildVideoReferenceMentions(
            [
                { id: "first", name: "首帧.png", type: "image/png", dataUrl: "first" },
                { id: "last", name: "尾帧.png", type: "image/png", dataUrl: "last" },
            ],
            [],
            [],
            "first_last_frames",
        );

        expect(references.map((reference) => reference.label)).toEqual(["@1", "@2"]);
        expect(references.map((reference) => reference.displayLabel)).toEqual(["首帧 · @1", "尾帧 · @2"]);
    });
});
