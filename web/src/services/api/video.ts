import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { resolveUniArtReferenceLimits, resolveUniArtVideoParams, type UniArtVideoCapability } from "@/lib/uniart-video";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = {
    id: string;
    status?: string;
    error?: { message?: string };
    url?: string;
    result_url?: string;
    video_url?: string;
    object?: string;
    metadata?: { url?: string; video_url?: string } | null;
    content?: { video_url?: string; url?: string } | null;
};
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type StoredVideoTask = { task_id?: string; status?: string; fail_reason?: string; result_url?: string };
type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "plugin"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    return waitForVideoGenerationTask(config, task, options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    const pollDelayMs = task.provider === "seedance" ? 5000 : 2500;
    let retryDelayMs = pollDelayMs;
    while (true) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let state: VideoGenerationTaskState;
        try {
            state = await pollVideoGenerationTask(config, task, options);
            retryDelayMs = pollDelayMs;
        } catch (error) {
            if (!isRetryableVideoTaskQueryError(error) || options?.signal?.aborted) throw error;
            await delay(retryDelayMs, options?.signal);
            retryDelayMs = Math.min(15000, retryDelayMs * 2);
            continue;
        }
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        await delay(pollDelayMs, options?.signal);
    }
}

export function isRetryableVideoTaskQueryError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/鉴权失败|请求已取消/.test(message)) return false;
    return /视频(?:任务)?查询失败|Seedance 任务查询失败|Network Error|Failed to fetch|ERR_NETWORK|timeout|请求被限流|接口没有返回视频任务|接口没有返回任务|provider response has no task data|unmarshal .*task data|[（(](408|409|425|429|5\d\d)[）)]/i.test(message);
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (!resolveUniArtVideoParams(selectedModel, { seconds: requestConfig.videoSeconds, ratio: requestConfig.size, resolution: requestConfig.vquality }) && (videoReferences.length || audioReferences.length)) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考资产");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: "插件视频任务已失效，请重新生成" };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    return task.provider === "seedance" ? pollSeedanceTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error("模型调用脚本没有返回视频");
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(result.url, { signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await uploadMediaFile(await response.blob(), "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        } finally {
            window.clearTimeout(timeout);
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const requestModel = modelOptionName(model);
    const uniArtParams = resolveUniArtVideoParams(requestModel, { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality });
    if (uniArtParams) {
        try {
            const metadata = await buildUniArtVideoMetadata(config, uniArtParams.capability, uniArtParams.ratio, uniArtParams.resolution, references, videoReferences, audioReferences, options);
            const created = unwrapVideoResponse(
                (await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), { model: requestModel, prompt, seconds: String(uniArtParams.seconds), metadata }, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data,
            );
            if (!created.id) throw new Error("视频接口没有返回任务 ID");
            return { id: created.id, provider: "openai", model };
        } catch (error) {
            throw new Error(readAxiosError(error, "视频任务创建失败"));
        }
    }

    const body = new FormData();
    body.append("model", requestModel);
    body.append("prompt", prompt);
    body.append("seconds", String(normalizeVideoSeconds(config.videoSeconds)));
    body.append("size", genericVideoPixelSize(config.vquality, config.size));
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function buildUniArtVideoMetadata(
    config: AiConfig,
    capability: UniArtVideoCapability,
    ratio: string,
    resolution: string | undefined,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
) {
    const limits = resolveUniArtReferenceLimits(capability, config.videoReferenceMode);
    const mode = limits.mode;
    const hasReferences = references.length + videoReferences.length + audioReferences.length > 0;
    if (!hasReferences) return { ratio, ...(resolution ? { resolution } : {}) };
    if (references.length > limits.maxImages) throw new Error(`当前参考方式最多支持 ${limits.maxImages} 张参考图片`);
    if (videoReferences.length > limits.maxVideos) throw new Error("参考视频只能用于当前模型支持的全能参考模式");
    if (audioReferences.length > limits.maxAudios) throw new Error("参考音频只能用于当前模型支持的全能参考模式");
    if (mode === "image_to_video" && references.length !== 1) throw new Error("图生视频模式需要且只能使用 1 张图片");
    if (mode === "image_reference" && !references.length) throw new Error("图片参考模式至少需要 1 张图片");
    if (mode === "first_last_frames" && (references.length !== 2 || videoReferences.length || audioReferences.length)) throw new Error("首尾帧模式需要且只能使用 2 张图片，第 1 张为首帧，第 2 张为尾帧");
    if (capability.family === "meai" && videoReferences.some((item) => !item.durationMs || item.durationMs <= 0)) throw new Error("MEAI 参考视频缺少可读取的时长，请重新上传视频文件");

    const [imageURLs, videoURLs, audioURLs] = await Promise.all([
        Promise.all(references.map(async (image) => uploadCanvasVideoAsset(await dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) }), options))),
        Promise.all(videoReferences.map(async (video) => uploadCanvasVideoAsset(await referenceMediaFile(video), options))),
        Promise.all(audioReferences.map(async (audio) => uploadCanvasVideoAsset(await referenceMediaFile(audio), options))),
    ]);

    if (capability.family === "globalai") {
        const content: Array<Record<string, unknown>> = [];
        if (mode === "first_last_frames") {
            content.push({ type: "image_url", role: "first_frame", image_url: { url: imageURLs[0] } }, { type: "image_url", role: "last_frame", image_url: { url: imageURLs[1] } });
        } else {
            imageURLs.forEach((url) => content.push({ type: "image_url", role: "reference_image", image_url: { url } }));
            videoURLs.forEach((url) => content.push({ type: "video_url", role: "reference_video", video_url: { url } }));
            audioURLs.forEach((url) => content.push({ type: "audio_url", role: "reference_audio", audio_url: { url } }));
        }
        return { ratio, ...(resolution ? { resolution } : {}), content };
    }
    if (mode === "first_last_frames") return { ratio, ...(resolution ? { resolution } : {}), mode: "frames", first_frame_url: imageURLs[0], last_frame_url: imageURLs[1] };
    return {
        ratio,
        ...(resolution ? { resolution } : {}),
        mode: "references",
        image_urls: imageURLs,
        video_urls: videoURLs,
        audio_urls: audioURLs,
        ...(videoURLs.length ? { input_video_duration: Math.ceil(videoReferences.reduce((total, item) => total + (item.durationMs || 0), 0) / 1000) } : {}),
    };
}

async function uploadCanvasVideoAsset(file: File, options?: RequestOptions) {
    const body = new FormData();
    body.append("file", file);
    const response = await axios.post<{ path?: string }>("/api/video-assets", body, { signal: options?.signal });
    if (!response.data.path) throw new Error("参考素材上传接口没有返回访问地址");
    return new URL(response.data.path, window.location.origin).toString();
}

async function referenceMediaFile(reference: ReferenceVideo | ReferenceAudio) {
    const blob = reference.storageKey ? await getMediaBlob(reference.storageKey) : await (await fetch(reference.url)).blob();
    if (!blob) throw new Error(`参考素材 ${reference.name} 已丢失，请重新上传`);
    return new File([blob], reference.name, { type: reference.type || blob.type || "application/octet-stream" });
}

function genericVideoPixelSize(resolution: string, ratio: string) {
    const tier = normalizeVideoResolution(resolution).toLowerCase().replace(/p$/, "");
    const long = tier === "4k" ? 3840 : tier === "1080" ? 1920 : tier === "480" ? 854 : 1280;
    const short = tier === "4k" ? 2160 : tier === "1080" ? 1080 : tier === "480" ? 480 : 720;
    const normalizedRatio = ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(ratio) ? ratio : "16:9";
    if (normalizedRatio === "9:16") return `${short}x${long}`;
    if (normalizedRatio === "1:1") return `${short}x${short}`;
    if (normalizedRatio === "4:3") return `${Math.round((short * 4) / 3)}x${short}`;
    if (normalizedRatio === "3:4") return `${short}x${Math.round((short * 4) / 3)}`;
    return `${long}x${short}`;
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        if (!axios.isCancel(error) && !options?.signal?.aborted && axios.isAxiosError(error) && (error.response?.status || 0) >= 500) {
            const storedState = await pollStoredVideoTask(config, task, options);
            if (storedState) return storedState;
        }
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function pollStoredVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState | null> {
    try {
        const payload = (await axios.get<{ code?: string; data?: StoredVideoTask | null }>(aiApiUrl(config, `/video/generations/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data;
        if (payload?.code !== "success" || !payload.data) return null;
        const status = String(payload.data.status || "").toUpperCase();
        if (status === "SUCCESS") {
            const resultUrl = payload.data.result_url?.trim();
            if (!resultUrl) return { status: "failed", error: "视频任务已完成，但持久任务记录没有结果地址" };
            return { status: "completed", result: { url: resolveStoredVideoResultUrl(config, resultUrl), mimeType: "video/mp4" } };
        }
        if (status === "FAILURE") return { status: "failed", error: payload.data.fail_reason || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return null;
    }
}

function resolveStoredVideoResultUrl(config: AiConfig, resultUrl: string) {
    if (isPublicMediaUrl(resultUrl)) return resultUrl;
    try {
        return new URL(resultUrl, config.baseUrl).toString();
    } catch {
        return resultUrl;
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    try {
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(state);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (state.status === "succeeded" || state.status === "completed") return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: readApiErrorMessage(state.error?.message) || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、资产 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、资产 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { url, mimeType: "video/mp4" };
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const normalized = value.trim().toLowerCase();
    if (/^\d+k$/.test(normalized)) return normalized;
    const resolution = normalized.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse | SeedanceTask) {
    const video = payload as VideoResponse;
    return [payload.video_url, payload.result_url, payload.url, video.metadata?.video_url, video.metadata?.url, video.object, payload.content?.video_url, payload.content?.url].find(
        (url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)),
    );
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return `服务返回了 HTML 错误页面（${value.slice(0, 80)}...）`;
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error 可能是字符串或含 message 的对象
    const errorMsg = typeof payload.error === "string" ? payload.error : (payload.error as { message?: unknown })?.message;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(errorMsg) || readApiErrorMessage(payload.detail) || "";
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || "视频下载失败");
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地资产失败"));
        reader.readAsDataURL(blob);
    });
}
