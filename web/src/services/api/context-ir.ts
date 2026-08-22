import axios from "axios";

import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import { dataUrlToFile } from "@/lib/image-utils";
import { uploadVideoReferenceAsset } from "@/services/video-reference-assets";

type ContextIRResponse = {
    id?: string;
    status?: "submitting" | "pending" | "succeeded" | "failed";
    prompt?: string;
    error?: string;
};

type ContextIRContent =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string }; role: "reference_image" }
    | { type: "video_url"; video_url: { url: string }; role: "reference_video" }
    | { type: "audio_url"; audio_url: { url: string }; role: "reference_audio" };

export type H3IRReference = { kind: "image" | "video" | "audio"; previewUrl?: string; title?: string };

const IR_MODEL = "minimax-h3-ir";

export async function optimizeMiniMaxH3Prompt(config: AiConfig, prompt: string, references: H3IRReference[], signal?: AbortSignal) {
    const content: ContextIRContent[] = [{ type: "text", text: prompt.trim() || "（未填写，请根据参考素材生成合适的视频描述）" }];
    for (const reference of references) {
        if (!reference.previewUrl) continue;
        const url = await ensureReachableReference(reference.previewUrl, reference.title || "", signal);
        if (reference.kind === "image") content.push({ type: "image_url", image_url: { url }, role: "reference_image" } as const);
        else if (reference.kind === "video") content.push({ type: "video_url", video_url: { url }, role: "reference_video" } as const);
        else if (reference.kind === "audio") content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" } as const);
    }
    const create = await requestIR(config, "POST", "/video/context-ir", { model: IR_MODEL, content, duration: Number(config.videoSeconds) || 5, ratio: config.size || "16:9", idempotency_key: `canvas-ir-${crypto.randomUUID()}` }, signal);
    if (!create.id) throw new Error("提示词优化接口没有返回任务 ID");
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const current = await requestIR(config, "GET", `/video/context-ir/${encodeURIComponent(create.id)}`, undefined, signal);
        if (current.status === "succeeded" && current.prompt?.trim()) return current.prompt.trim();
        if (current.status === "failed") throw new Error(current.error || "提示词优化失败");
        await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, 1800);
            signal?.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
        });
    }
}

async function requestIR(config: AiConfig, method: "GET" | "POST", path: string, data?: unknown, signal?: AbortSignal) {
    try {
        const response = await axios.request<ContextIRResponse>({ method, url: buildApiUrl(config.baseUrl, path), data, signal, headers: { Authorization: `Bearer ${config.apiKey}`, ...(data ? { "Content-Type": "application/json" } : {}) } });
        return response.data;
    } catch (error) {
        if (axios.isAxiosError<{ error?: { message?: string } }>(error)) throw new Error(error.response?.data?.error?.message || `提示词优化请求失败（HTTP ${error.response?.status || "网络错误"}）`);
        throw error;
    }
}

async function ensureReachableReference(value: string, title: string, signal?: AbortSignal) {
    if (/^https?:\/\//i.test(value)) return value;
    if (!value.startsWith("data:")) throw new Error(`参考素材“${title || "未命名"}”没有可访问地址`);
    const file = dataUrlToFile({ dataUrl: value, name: title || "reference", type: value.slice(5, value.indexOf(";")) || "application/octet-stream", id: "ir-reference" });
    return (await uploadVideoReferenceAsset(file, title, signal)).url;
}
