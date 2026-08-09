import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CORE_STORE_NAMES, coreStore, missingCoreStores } from "./browser-kv-storage.ts";

describe("managed browser storage schema", () => {
    test("declares every core store in one schema upgrade", () => {
        expect(CORE_STORE_NAMES).toEqual([
            "app_state",
            "image_files",
            "media_files",
            "agent_chat_messages",
            "image_generation_logs",
            "video_generation_logs",
            "prompt_cache",
        ]);
        expect(missingCoreStores(["app_state", "prompt_cache", "video_generation_logs"])).toEqual(["image_files", "media_files", "agent_chat_messages", "image_generation_logs"]);
    });

    test("reuses one store object instead of creating competing LocalForage instances", () => {
        expect(coreStore("video_generation_logs")).toBe(coreStore("video_generation_logs"));
    });

    test("core consumers no longer create LocalForage stores dynamically", () => {
        const files = [
            "../lib/localforage-storage.ts",
            "../pages/image/index.tsx",
            "../pages/video/index.tsx",
            "./agent-chat-storage.ts",
            "./api/prompts.ts",
            "./app-sync.ts",
            "./file-storage.ts",
            "./image-storage.ts",
        ];
        for (const file of files) {
            const source = readFileSync(new URL(file, import.meta.url), "utf8");
            expect(source).not.toContain("createInstance(");
            expect(source).not.toContain('from "localforage"');
        }
    });

    test("starts polling an accepted remote task before awaiting log persistence", () => {
        const source = readFileSync(new URL("../pages/video/index.tsx", import.meta.url), "utf8");
        const acceptedTaskBlock = source.slice(source.indexOf("const task = await createVideoGenerationTask"), source.indexOf("} catch (error) {", source.indexOf("const task = await createVideoGenerationTask")));
        expect(acceptedTaskBlock.indexOf("void pollGenerationLog(log")).toBeGreaterThan(-1);
        expect(acceptedTaskBlock.indexOf("await persistLogRecord(log)")).toBeGreaterThan(acceptedTaskBlock.indexOf("void pollGenerationLog(log"));
    });
});
