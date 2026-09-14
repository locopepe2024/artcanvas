import { describe, expect, test } from "bun:test";

import { reconcileChannelModels } from "./use-config-store.ts";

describe("channel model catalog reconciliation", () => {
    test("adds newly published owner models and preserves local scripts", () => {
        const current = [{ name: "gpt-image-2", capability: "image", script: "custom-script" }];
        const fetched = [
            { name: "gpt-image-2", capability: "image" },
            { name: "gpt-image-2.5-sunburst-discount", capability: "image" },
        ];

        expect(reconcileChannelModels(current, fetched, true)).toEqual([
            { name: "gpt-image-2", capability: "image", script: "custom-script" },
            { name: "gpt-image-2.5-sunburst-discount", capability: "image", script: undefined },
        ]);
    });

    test("keeps manually selected catalog boundaries for non-owner channels", () => {
        const current = [{ name: "selected-video", capability: "video" }];
        const fetched = [
            { name: "selected-video", capability: "video", videoCapability: { modes: [{ id: "text_to_video", inputTypes: ["text"] }] } },
            { name: "unselected-image", capability: "image" },
        ];

        expect(reconcileChannelModels(current, fetched)).toEqual([fetched[0]]);
    });
});
