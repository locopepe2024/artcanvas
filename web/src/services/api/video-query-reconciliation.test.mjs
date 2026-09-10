import { describe, expect, test } from "bun:test";

import { isRetryableVideoContentStatus, normalizeVideoSafetyFailureMessage, readApiErrorMessage, readProviderFailureMessage, readReportedOpenAIVideoFailure, reconcileReportedVideoFailure, shouldReconcileStoredVideoTaskQuery, videoTaskIdFromResultUrl } from "./video.ts";

describe("video task query reconciliation", () => {
    test("retries transient protected video content responses", () => {
        expect(isRetryableVideoContentStatus(502)).toBe(true);
        expect(isRetryableVideoContentStatus(503)).toBe(true);
        expect(isRetryableVideoContentStatus(504)).toBe(true);
        expect(isRetryableVideoContentStatus(500)).toBe(false);
    });
    test("reconciles queued-task 400s and transient provider query failures", () => {
        expect(shouldReconcileStoredVideoTaskQuery(400)).toBe(true);
        expect(shouldReconcileStoredVideoTaskQuery(404)).toBe(true);
        expect(shouldReconcileStoredVideoTaskQuery(500)).toBe(true);
        expect(shouldReconcileStoredVideoTaskQuery()).toBe(true);
    });

    test("does not hide authentication failures or cancellation", () => {
        expect(shouldReconcileStoredVideoTaskQuery(401)).toBe(false);
        expect(shouldReconcileStoredVideoTaskQuery(403)).toBe(false);
        expect(shouldReconcileStoredVideoTaskQuery(400, true)).toBe(false);
        expect(shouldReconcileStoredVideoTaskQuery(400, false, true)).toBe(false);
    });

    test("recognizes provider failure notes returned as successful HTTP payloads", () => {
        expect(readProviderFailureMessage({ noteType: "PROVIDER_FAILURE", failureReason: { errorCode: "PROVIDER_TIMEOUT" } })).toBe("上游生成超时，请稍后重试");
        expect(readProviderFailureMessage({ noteType: "PROVIDER_FAILURE", failureReason: { errorCode: "PROVIDER_OUTPUT_ERROR" } })).toBe("上游生成失败（PROVIDER_OUTPUT_ERROR）");
        expect(readProviderFailureMessage({ status: "running" })).toBe("");
    });

    test("persistent success or progress overrides a reported provider failure", () => {
        const completed = { status: "completed", result: { url: "https://example.com/result.mp4" } };
        expect(reconcileReportedVideoFailure("上游生成超时", completed)).toEqual(completed);
        expect(reconcileReportedVideoFailure("上游生成超时", { status: "pending" })).toEqual({ status: "pending" });
        expect(reconcileReportedVideoFailure("上游生成超时", null)).toEqual({ status: "failed", error: "上游生成超时" });
        expect(reconcileReportedVideoFailure("Generate failed: An error occurred.", null, true)).toEqual({ status: "pending" });
    });

    test("failure status wins over a stale result URL", () => {
        const response = {
            status: "failed",
            result_url: "/v1/videos/task_failed/content",
            requires_auth: true,
            error: {
                message: JSON.stringify({ noteType: "PROVIDER_FAILURE", failureReason: { errorCode: "PROVIDER_MODERATION_ERROR" } }),
            },
        };
        expect(readReportedOpenAIVideoFailure(response)).toBe("视频内容安全审核未通过，请修改提示词或随机种子后重试");
        expect(readReportedOpenAIVideoFailure({ status: "completed", result_url: "/v1/videos/task_ok/content" })).toBe("");
    });

    test("keeps a concrete provider message when generic codes are also present", () => {
        const response = {
            status: "failed",
            error: {
                code: "provider_task_failed",
                message: "第 1 张参考图片无法使用，请重新上传或替换素材",
            },
            message: "llm-error",
        };
        expect(readReportedOpenAIVideoFailure(response)).toBe("第 1 张参考图片无法使用，请重新上传或替换素材");
        expect(
            readApiErrorMessage({
                code: 400,
                message: "llm-error",
                error: { code: "provider_task_failed", message: "第 1 张参考图片无法使用，请重新上传或替换素材" },
            }),
        ).toBe("第 1 张参考图片无法使用，请重新上传或替换素材");
        expect(
            readApiErrorMessage({
                message: "llm-error",
                detail: JSON.stringify({ error: { code: "InvalidParameter", message: "The parameter `content[1]` is not valid" } }),
            }),
        ).toBe("The parameter `content[1]` is not valid");
    });

    test("maps content safety failures and recovers the task id from content URLs", () => {
        expect(normalizeVideoSafetyFailureMessage('video content safety blocked: 451 {"error_code":"video_unsafe"}')).toBe("视频内容安全审核未通过，请修改提示词或随机种子后重试");
        expect(readProviderFailureMessage({ noteType: "PROVIDER_FAILURE", failureReason: { errorCode: "PROVIDER_MODERATION_ERROR" } })).toBe("视频内容安全审核未通过，请修改提示词或随机种子后重试");
        expect(videoTaskIdFromResultUrl("https://uniart.fun/v1/videos/task_yCLglASVvtrUBfd40LVvLOgoqkDINYKp/content")).toBe("task_yCLglASVvtrUBfd40LVvLOgoqkDINYKp");
        expect(videoTaskIdFromResultUrl("https://storage.example/result.mp4")).toBe("");
    });
});
