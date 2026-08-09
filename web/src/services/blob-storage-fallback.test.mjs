import { describe, expect, test } from "bun:test";

import { persistBlobWithMemoryFallback, readBlobWithMemoryFallback, removeBlobWithMemoryFallback } from "./blob-storage-fallback.ts";

describe("browser blob storage fallback", () => {
    test("keeps the asset usable in memory when persistent storage rejects", async () => {
        const blob = new Blob(["reference"]);
        const memory = new Map();
        const store = {
            setItem: async () => {
                throw new Error("quota exceeded");
            },
            getItem: async () => null,
            removeItem: async () => {
                throw new Error("storage unavailable");
            },
        };

        expect(await persistBlobWithMemoryFallback(store, memory, "image:1", blob)).toBe(false);
        expect(await readBlobWithMemoryFallback(store, memory, "image:1")).toBe(blob);
        await removeBlobWithMemoryFallback(store, memory, "image:1");
        expect(memory.has("image:1")).toBe(false);
    });

    test("uses persistent storage when it is available", async () => {
        const blob = new Blob(["reference"]);
        const persisted = new Map();
        const memory = new Map();
        const store = {
            setItem: async (key, value) => {
                persisted.set(key, value);
                return value;
            },
            getItem: async (key) => persisted.get(key) || null,
            removeItem: async (key) => {
                persisted.delete(key);
            },
        };

        expect(await persistBlobWithMemoryFallback(store, memory, "image:1", blob)).toBe(true);
        expect(await readBlobWithMemoryFallback(store, memory, "image:1")).toBe(blob);
    });
});
