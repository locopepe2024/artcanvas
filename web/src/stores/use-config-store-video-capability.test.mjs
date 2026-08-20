import { describe, expect, test } from "bun:test";

import { normalizeVideoCapability } from "./use-config-store.ts";

describe("video capability normalization", () => {
    test("preserves explicit Face Mode support", () => {
        expect(
            normalizeVideoCapability({
                modes: [{ id: "image_reference", inputTypes: ["text", "image"] }],
                supportsFaceMode: true,
            }),
        ).toMatchObject({ supportsFaceMode: true });
    });

    test("does not infer Face Mode from ordinary image support", () => {
        expect(
            normalizeVideoCapability({
                modes: [{ id: "image_reference", inputTypes: ["text", "image"] }],
            })?.supportsFaceMode,
        ).toBeUndefined();
    });
});
