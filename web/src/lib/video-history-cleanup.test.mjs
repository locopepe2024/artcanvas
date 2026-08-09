import { describe, expect, test } from "bun:test";

import { removableTerminalVideoLogs, storageKeysOwnedOnlyByRemovedHistory } from "./video-history-cleanup.ts";

describe("video history cleanup", () => {
    test("removes only terminal history and preserves current or pending tasks", () => {
        const logs = [
            { id: "current", status: "失败" },
            { id: "pending", status: "生成中", task: { id: "task-1" } },
            { id: "success", status: "成功" },
            { id: "failed", status: "失败" },
            { id: "unknown", status: "已取消" },
            { status: "成功" },
        ];
        expect(removableTerminalVideoLogs(logs, ["current"]).map((log) => log.id)).toEqual(["success", "failed"]);
    });

    test("deletes only cache keys not retained by assets, canvas, image history, or running tasks", () => {
        const collectKeys = (value) => {
            const keys = new Set();
            const visit = (item) => {
                if (!item || typeof item !== "object") return;
                if (typeof item.storageKey === "string") keys.add(item.storageKey);
                Object.values(item).forEach((child) => (Array.isArray(child) ? child.forEach(visit) : visit(child)));
            };
            visit(value);
            return keys;
        };
        const removed = [{ video: { storageKey: "video:remove" } }, { references: [{ storageKey: "image:shared" }] }];
        const retained = {
            assets: [{ storageKey: "image:asset" }],
            projects: [{ nodes: [{ storageKey: "image:shared" }] }],
            imageLogs: [{ images: [{ storageKey: "image:image-log" }] }],
            videoLogs: [{ status: "生成中", video: { storageKey: "video:pending" } }],
        };
        expect(storageKeysOwnedOnlyByRemovedHistory(removed, retained, collectKeys)).toEqual(["video:remove"]);
    });
});
