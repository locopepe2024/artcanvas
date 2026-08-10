import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { canvasAuthenticatedVideoResultUrl, canvasVideoResultUrl } from "./video-result-proxy.ts";

describe("Canvas video result proxy", () => {
    test("rewrites only signed UniArt video-cache URLs to the same-origin proxy", () => {
        expect(canvasVideoResultUrl("https://storage.iyishow.com/uniart-cache/videos/2026/08/10/task_1/result.mp4?sign=abc")).toBe(
            "/api/video-result-proxy/videos/2026/08/10/task_1/result.mp4?sign=abc",
        );
        expect(canvasVideoResultUrl("https://storage.iyishow.com/other/result.mp4?sign=abc")).toBe("https://storage.iyishow.com/other/result.mp4?sign=abc");
        expect(canvasVideoResultUrl("https://example.com/uniart-cache/videos/result.mp4?sign=abc")).toBe("https://example.com/uniart-cache/videos/result.mp4?sign=abc");
    });

    test("rewrites authenticated UniArt content URLs to the Canvas content proxy", () => {
        expect(canvasAuthenticatedVideoResultUrl("https://uniart.fun/v1/videos/task_abc123/content", "https://uniart.fun/v1")).toBe("/api/video-content-proxy/task_abc123");
        expect(canvasAuthenticatedVideoResultUrl("https://example.com/v1/videos/task_abc123/content", "https://uniart.fun/v1")).toBe("https://example.com/v1/videos/task_abc123/content");
    });

    test("nginx proxy is pinned to the UniArt cache host and forwards range requests", () => {
        const source = readFileSync(new URL("../../../nginx.conf", import.meta.url), "utf8");
        expect(source).toContain("location ^~ /api/video-result-proxy/");
        expect(source).toContain("location ^~ /api/video-content-proxy/");
        expect(source).toContain("proxy_pass https://storage.iyishow.com/uniart-cache/");
        expect(source).toContain("proxy_set_header Range $http_range;");
        expect(source).not.toContain("$arg_url");
    });
});
