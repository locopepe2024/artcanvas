import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, Plus, RefreshCw, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Tag, Typography } from "antd";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoReferenceModeSelector, VideoSettingsPanel, normalizeVideoRatioValue, normalizeVideoResolutionValue, videoResolutionLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceRatio, seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS, SEEDANCE_VIDEO_MIME_TYPES } from "@/lib/seedance-video";
import { preferredUniArtImageReferenceMode, resolveUniArtReferenceLimits, uniArtVideoSubmissionError } from "@/lib/uniart-video";
import { collectMediaStorageKeys, deleteStoredMedia, resolveMediaUrl } from "@/services/file-storage";
import { collectImageStorageKeys, deleteStoredImages, resolveImageUrl } from "@/services/image-storage";
import { createVideoGenerationTask, isRetryableVideoTaskQueryError, storeGeneratedVideo, waitForVideoGenerationTask, type VideoGenerationTask } from "@/services/api/video";
import { uploadVideoReferenceAsset } from "@/services/video-reference-assets";
import { isQuotaExceededStorageError, writeWithConfirmedQuotaCleanup } from "@/services/browser-storage-errors";
import { claimVideoLogRecovery } from "@/lib/video-log-recovery";
import { removableTerminalVideoLogs, storageKeysOwnedOnlyByRemovedHistory } from "@/lib/video-history-cleanup";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { modelOptionLabel, modelOptionName, useConfigStore, useEffectiveConfig, videoCapabilityOf, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { coreStore } from "@/services/browser-kv-storage";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "生成中" | "成功" | "失败";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoReferenceMode" | "videoFaceMode">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const logStore = coreStore("video_generation_logs");
const imageLogStore = coreStore("image_generation_logs");

function isRecoverablePollingFailure(log: GenerationLog) {
    if (log.status !== "失败" || !log.task) return false;
    return /^(Seedance )?视频生成超时，请稍后重试$/.test(log.error || "") || isRetryableVideoTaskQueryError(new Error(log.error || ""));
}

export default function VideoPage() {
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileInputTargetRef = useRef<"all" | "image" | "video" | "audio">("all");
    const dragDepthRef = useRef(0);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const attemptedLogRecoveryRef = useRef<Set<string>>(new Set());
    const recoverableLogsRef = useRef<GenerationLog[]>([]);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [recoverTaskOpen, setRecoverTaskOpen] = useState(false);
    const [recoverTaskId, setRecoverTaskId] = useState("");
    const [referenceDragTarget, setReferenceDragTarget] = useState<"image" | "video" | "audio" | null>(null);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const submittingRef = useRef(false);
    const quotaCleanupPromiseRef = useRef<Promise<{ approved: boolean; logs: number }> | null>(null);
    const quotaCleanupDeclinedRef = useRef(false);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const uniArtCapability = videoCapabilityOf(effectiveConfig, model);
    const seedance = isSeedanceVideoConfig({ ...effectiveConfig, model });
    const referenceLimits = videoReferenceLimitsForConfig(effectiveConfig);
    const alternateImageReferenceMode = uniArtCapability && !referenceLimits.maxImages ? preferredUniArtImageReferenceMode(uniArtCapability) : null;
    const imageReferenceTitle = referenceLimits.mode === "first_last_frames" ? "首尾帧" : referenceLimits.mode === "image_to_video" ? "图生视频参考图" : "参考图";
    const imageReferenceHint =
        referenceLimits.mode === "first_last_frames"
            ? "请按顺序添加首帧和尾帧，共 2 张"
            : referenceLimits.mode === "image_to_video"
              ? "请添加 1 张主体或起始画面"
              : referenceLimits.mode === "image_reference"
                ? "请添加 1 至 9 张参考图片"
                : referenceLimits.maxImages
                  ? "可添加多张参考图片"
                  : "该模型未声明参考图片能力";
    const submissionError = uniArtCapability
        ? uniArtVideoSubmissionError(referenceLimits.mode, prompt, { images: references.length, videos: videoReferences.length, audios: audioReferences.length })
        : prompt.trim()
          ? null
          : "请输入视频提示词";
    const canGenerate = !submissionError;

    useEffect(() => {
        setReferences((value) => value.slice(0, referenceLimits.maxImages));
        setVideoReferences((value) => value.slice(0, referenceLimits.maxVideos));
        setAudioReferences((value) => value.slice(0, referenceLimits.maxAudios));
    }, [referenceLimits.maxImages, referenceLimits.maxVideos, referenceLimits.maxAudios]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    useEffect(() => {
        resumePendingLogs([...recoverableLogsRef.current, ...logs]);
        // 配置持久化晚于页面记录恢复时，重新尝试尚未启动的远程任务。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveConfig]);

    const openReferenceUpload = (target: "image" | "video" | "audio") => {
        fileInputTargetRef.current = target;
        if (fileInputRef.current) {
            fileInputRef.current.accept = target === "image" ? "image/*" : target === "video" ? "video/mp4,video/quicktime" : "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";
            fileInputRef.current.click();
        }
    };

    const switchAndUploadImageReference = () => {
        if (!alternateImageReferenceMode) return;
        updateConfig("videoReferenceMode", alternateImageReferenceMode);
        openReferenceUpload("image");
    };

    const addReferences = async (files?: FileList | null, target: "all" | "image" | "video" | "audio" = "all") => {
        const selectedFiles = Array.from(files || []);
        const latestConfig = { ...useConfigStore.getState().config, channelMode: "local" as const };
        const latestLimits = videoReferenceLimitsForConfig(latestConfig);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning("已忽略不支持的参考资产，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageFiles =
            target === "all" || target === "image" ? selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, Math.max(0, latestLimits.maxImages - references.length)) : [];
        const videoFiles =
            target === "all" || target === "video"
                ? selectedFiles.filter((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, Math.max(0, latestLimits.maxVideos - videoReferences.length))
                : [];
        const audioFiles =
            target === "all" || target === "audio" ? selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, Math.max(0, latestLimits.maxAudios - audioReferences.length)) : [];
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning("已忽略超过 30MB 的参考图");
        if (selectedFiles.some((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning("已忽略超过 200MB 的参考视频");
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 15MB 的参考音频");
        try {
            const nextReferences = await Promise.all(
                imageFiles.map(async (file) => {
                    const image = await uploadVideoReferenceAsset(file);
                    return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url };
                }),
            );
            const nextVideoReferences = await Promise.all(
                videoFiles.map(async (file) => {
                    const video = await uploadVideoReferenceAsset(file);
                    return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
                }),
            );
            const uploadedAudioReferences = await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadVideoReferenceAsset(file);
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, durationMs: audio.durationMs };
                }),
            );
            const nextAudioReferences = filterAudioReferencesByDuration(audioReferences, uploadedAudioReferences, message.warning);
            setReferences((value) => [...value, ...nextReferences].slice(0, latestLimits.maxImages));
            setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, latestLimits.maxVideos));
            setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, latestLimits.maxAudios));
        } catch (error) {
            message.error(`参考素材上传失败：${error instanceof Error ? error.message : "请重新选择文件"}`);
        }
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>, target: "image" | "video" | "audio") => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(target);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(null);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(null);
        void addReferences(event.dataTransfer.files, referenceDragTarget || "all");
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, Math.max(0, referenceLimits.maxImages - references.length)).map(async (blob, index) => {
                    const name = `clipboard-${index + 1}.png`;
                    const image = await uploadVideoReferenceAsset(blob, name);
                    return { id: nanoid(), name, type: image.mimeType, dataUrl: image.url };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, referenceLimits.maxImages));
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };
    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        if (submittingRef.current) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "视频任务正在提交，请稍后重试" });
            return;
        }
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "视频生成参数无效" });
            return;
        }
        submittingRef.current = true;
        setSubmitting(true);
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences);
            const log = buildLog({ prompt: snapshot.text, model: snapshot.model, config: snapshot.config, references: snapshot.references, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, durationMs: 0, status: "生成中", task });
            stageLog(log);
            void pollGenerationLog(log, snapshot.config, agentTaskId);
            try {
                await persistLogRecord(log);
                void refreshLogs(false);
            } catch (storageError) {
                message.warning(`任务 ${task.id} 已创建并继续查询，但生成记录保存失败：${errorMessageOf(storageError)}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            setResults([{ id: nanoid(), status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLogSafely(
                buildLog({
                    prompt: snapshot.text,
                    model: snapshot.model,
                    config: snapshot.config,
                    references: snapshot.references,
                    videoReferences: snapshot.videoReferences,
                    audioReferences: snapshot.audioReferences,
                    durationMs: performance.now() - batchStartedAt,
                    status: "失败",
                    error: errorMessage,
                }),
                false,
            );
            message.error(errorMessage);
            if (!activeLogIdsRef.current.size) setRunning(false);
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    // 响应 Agent 面板下发的视频命令：填入提示词，并按需自动触发生成。
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && submittingRef.current) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: "视频工作台已有任务正在运行" });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        // Read the store at click time. A settings switch can be changed just
        // before submission, while this render's effectiveConfig closure still
        // contains the previous value. Face mode must never be lost at that
        // boundary because it controls provider-side asset preflight.
        const latestConfig = { ...useConfigStore.getState().config, channelMode: "local" as const };
        const latestModel = latestConfig.videoModel || latestConfig.model;
        const latestCapability = videoCapabilityOf(latestConfig, latestModel);
        const latestSeedance = isSeedanceVideoConfig({ ...latestConfig, model: latestModel });
        const latestLimits = latestCapability
            ? resolveUniArtReferenceLimits(latestCapability, latestConfig.videoReferenceMode)
            : { mode: "image_reference" as const, maxImages: latestSeedance ? SEEDANCE_REFERENCE_LIMITS.images : 0, maxVideos: latestSeedance ? SEEDANCE_REFERENCE_LIMITS.videos : 0, maxAudios: latestSeedance ? SEEDANCE_REFERENCE_LIMITS.audios : 0 };
        const latestSubmissionError = latestCapability
            ? uniArtVideoSubmissionError(latestLimits.mode, text, { images: references.length, videos: videoReferences.length, audios: audioReferences.length })
            : text
              ? null
              : "请输入视频提示词";
        if (latestSubmissionError) {
            message.error(latestSubmissionError);
            return null;
        }
        if (!isAiConfigReady(latestConfig, latestModel)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        const videoReferenceError = latestSeedance ? seedanceVideoReferenceError(videoReferences) : null;
        if (videoReferenceError) {
            message.error(`${videoReferenceError}。${seedanceVideoReferenceHint}`);
            return null;
        }
        return { text, model: latestModel, config: buildVideoConfig(latestConfig, latestModel), references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const retryResult = () => {
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: "生成视频",
            coverUrl: "",
            tags: [],
            source: "视频创作台",
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success("已加入我的资产");
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            if (references.length >= referenceLimits.maxImages) {
                message.warning("已达到画布单次上传安全上限，具体参数由 UniArt 校验");
                return;
            }
            const blob = await (await fetch(payload.dataUrl)).blob();
            const stored = await uploadVideoReferenceAsset(blob, payload.title || "reference.png");
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url }].slice(0, referenceLimits.maxImages));
        } else if (payload.kind === "video") {
            if (!referenceLimits.maxVideos) {
                message.warning("参考视频仅能用于当前模型支持的全能参考模式");
                return;
            }
            const blob = await (await fetch(payload.url)).blob();
            const stored = await uploadVideoReferenceAsset(blob, payload.title || "reference.mp4");
            setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, url: stored.url, width: stored.width || payload.width, height: stored.height || payload.height, durationMs: stored.durationMs }].slice(0, referenceLimits.maxVideos));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const mediaKeys = logs
            .filter((log) => selectedLogIds.includes(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        void Promise.all([deleteStoredMedia(mediaKeys), ...selectedLogIds.map((id) => logStore.removeItem(id))]).then(() => {
            quotaCleanupDeclinedRef.current = false;
            return refreshLogs();
        });
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        stageLog(log);
        setPreviewLog((current) => (current?.id === log.id ? log : current));
        await persistLogRecord(log);
        await refreshLogs(resumePending);
    };

    const persistLogRecord = async (log: GenerationLog) => {
        const write = () => logStore.setItem(log.id, serializeLog(log));
        if (quotaCleanupDeclinedRef.current) {
            try {
                await write();
                return;
            } catch (error) {
                if (!isQuotaExceededStorageError(error)) throw error;
                throw new Error("浏览器存储空间仍不足；任务继续查询，请在生成记录中清理不需要的历史后再恢复", { cause: error });
            }
        }
        const result = await writeWithConfirmedQuotaCleanup(write, () => requestHistoryCleanup(log));
        if (result.status === "stored") return;
        if (result.status === "recovered") {
            quotaCleanupDeclinedRef.current = false;
            message.success(`已清理 ${result.logs} 条本地视频历史记录并恢复当前任务保存`);
            return;
        }
        quotaCleanupDeclinedRef.current = true;
        if (result.status === "declined") throw new Error("浏览器存储空间已满；任务仍在继续查询，请保留 task ID，清理本地生成记录后再恢复", { cause: result.error });
        if (result.status === "nothing-to-clean") throw new Error("浏览器存储空间已满，但没有可清理的已完成或失败视频记录；请在生成记录中删除不需要的任务，或清理该站点的浏览器数据", { cause: result.error });
        throw new Error("清理历史记录后浏览器空间仍不足；任务继续查询，请保留 task ID 并清理更多本地数据", { cause: result.error });
    };

    const requestHistoryCleanup = (currentLog: GenerationLog) => {
        if (quotaCleanupPromiseRef.current) return quotaCleanupPromiseRef.current;
        const promise = confirmHistoryCleanup().then(async (approved) => ({ approved, logs: approved ? (await clearTerminalVideoHistory(currentLog)).logs : 0 }));
        quotaCleanupPromiseRef.current = promise;
        const reset = () => {
            if (quotaCleanupPromiseRef.current === promise) quotaCleanupPromiseRef.current = null;
        };
        void promise.then(reset, reset);
        return promise;
    };

    const confirmHistoryCleanup = () =>
        new Promise<boolean>((resolve) => {
            let settled = false;
            const settle = (approved: boolean) => {
                if (settled) return;
                settled = true;
                resolve(approved);
            };
            modal.confirm({
                title: "浏览器存储空间已满",
                content: "是否清理已成功或失败的本地视频生成记录及其未被资产、画布引用的缓存？正在运行的任务、我的资产和画布内容不会删除。",
                okText: "清理历史并继续",
                cancelText: "暂不清理",
                okButtonProps: { danger: true },
                onOk: () => settle(true),
                onCancel: () => settle(false),
                afterClose: () => settle(false),
            });
        });

    const clearTerminalVideoHistory = async (currentLog: GenerationLog) => {
        const [storedVideoLogs, storedImageLogs] = await Promise.all([readStorageRecords<GenerationLog>(logStore), readStorageRecords<Record<string, unknown>>(imageLogStore)]);
        const protectedLogIds = new Set([currentLog.id, ...activeLogIdsRef.current]);
        const removable = removableTerminalVideoLogs(storedVideoLogs, protectedLogIds);
        if (!removable.length) return { logs: 0 };
        const removableIds = new Set(removable.map((log) => log.id));
        const activeLogs = recoverableLogsRef.current.filter((log) => protectedLogIds.has(log.id));
        const retainedData = {
            assets: useAssetStore.getState().assets,
            projects: (await import("@/stores/canvas/use-canvas-store")).useCanvasStore.getState().projects,
            imageLogs: storedImageLogs,
            videoLogs: [currentLog, ...activeLogs, ...storedVideoLogs.filter((log) => !removableIds.has(log.id))],
        };
        const removableImages = storageKeysOwnedOnlyByRemovedHistory(removable, retainedData, collectImageStorageKeys);
        const removableMedia = storageKeysOwnedOnlyByRemovedHistory(removable, retainedData, collectMediaStorageKeys);
        await Promise.all(removable.map((log) => logStore.removeItem(log.id)));
        await Promise.all([deleteStoredImages(removableImages), deleteStoredMedia(removableMedia)]);
        setLogs((value) => value.filter((item) => !removableIds.has(item.id)));
        setSelectedLogIds((value) => value.filter((id) => !removableIds.has(id)));
        if (previewLog && removableIds.has(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        return { logs: removable.length };
    };

    const saveLogSafely = async (log: GenerationLog, resumePending = true) => {
        try {
            await saveLog(log, resumePending);
            return true;
        } catch (error) {
            message.warning(`生成记录保存失败：${errorMessageOf(error)}`);
            return false;
        }
    };

    const stageLog = (log: GenerationLog) => {
        recoverableLogsRef.current = [log, ...recoverableLogsRef.current.filter((item) => item.id !== log.id)];
        setLogs((value) => [log, ...value.filter((item) => item.id !== log.id)].sort((a, b) => b.createdAt - a.createdAt));
    };

    const refreshLogs = async (resumePending = true) => {
        const nextLogs = await readStoredLogs((rawLogs) => {
            recoverableLogsRef.current = rawLogs;
        });
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (!log.task || (log.status !== "生成中" && !isRecoverablePollingFailure(log))) continue;
            if (!claimVideoLogRecovery(attemptedLogRecoveryRef.current, log.id, log.task.id)) continue;
            void pollGenerationLog(log, undefined, undefined, false);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string, presentResult = true) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        const task = log.task;
        claimVideoLogRecovery(attemptedLogRecoveryRef.current, log.id, task.id);
        const latestConfig = { ...useConfigStore.getState().config, channelMode: "local" as const };
        const taskConfig = buildVideoConfig({ ...latestConfig, ...log.config }, task.model || log.model);
        if (!isAiConfigReady(configOverride || taskConfig, (configOverride || taskConfig).model)) return;
        activeLogIdsRef.current.add(log.id);
        if (presentResult) {
            setRunning(true);
            setStartedAt((value) => value || performance.now());
            setResults([{ id: log.id, status: "pending" }]);
        }
        try {
            if (isRecoverablePollingFailure(log)) {
                log = { ...log, status: "生成中", error: undefined };
                await saveLogSafely(log, false);
            }
            const result = await waitForVideoGenerationTask(configOverride || taskConfig, task);
            const stored = await storeGeneratedVideo(result, configOverride || taskConfig);
            const nextVideo: GeneratedVideo = {
                id: nanoid(),
                url: stored.url,
                storageKey: stored.storageKey,
                durationMs: Date.now() - log.createdAt,
                width: stored.width || 1280,
                height: stored.height || 720,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            };
            if (presentResult) setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
            await saveLogSafely({ ...log, status: "成功", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined }, false);
            if (presentResult) message.success("视频已生成");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            if (presentResult) setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLogSafely({ ...log, status: "失败", durationMs: Date.now() - log.createdAt, error: errorMessage }, false);
            if (presentResult) message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (presentResult) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const recoverGenerationTask = async () => {
        const taskId = recoverTaskId.trim();
        if (!/^task_[A-Za-z0-9]+$/.test(taskId)) {
            message.warning("请输入有效的 task_ 任务 ID");
            return;
        }
        const latestConfig = { ...useConfigStore.getState().config, channelMode: "local" as const };
        const selectedModel = latestConfig.videoModel || latestConfig.model;
        const taskConfig = buildVideoConfig(latestConfig, selectedModel);
        if (!isAiConfigReady(taskConfig, selectedModel)) {
            message.warning("请先完成当前视频模型的 API 配置");
            openConfigDialog(true);
            return;
        }
        const task: VideoGenerationTask = { id: taskId, provider: "openai", model: selectedModel };
        const log = buildLog({ prompt: prompt.trim(), model: selectedModel, config: taskConfig, references: [], videoReferences: [], audioReferences: [], durationMs: 0, status: "生成中", task });
        stageLog(log);
        setPreviewLog(log);
        setResults([{ id: log.id, status: "pending" }]);
        setRecoverTaskOpen(false);
        setRecoverTaskId("");
        void pollGenerationLog(log, taskConfig);
        await saveLogSafely(log, false);
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoReferenceMode) updateConfig("videoReferenceMode", log.config.videoReferenceMode);
        if (log.config.videoFaceMode) updateConfig("videoFaceMode", log.config.videoFaceMode);
        setResults(log.status === "生成中" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || "生成失败" }]);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div className="flex items-start justify-between gap-3">
                            <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">视频创作台</h1>
                            <div className="flex shrink-0 gap-2">
                                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => setRecoverTaskOpen(true)}>
                                    恢复任务
                                </Button>
                                <div className="flex gap-2 lg:hidden">
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        记录
                                    </Button>
                                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        参数
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">提示词</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            查看提示词库
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            查看我的资产
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder="描述镜头运动、主体动作、场景氛围和画面风格" />
                            </div>

                            <VideoReferenceModeSelector config={effectiveConfig} model={model} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} />

                            {referenceLimits.maxImages > 0 ? <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{imageReferenceTitle}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            剪切板
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} disabled={references.length >= referenceLimits.maxImages} onClick={() => openReferenceUpload("image")}>
                                            上传
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget === "image" ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                    onDragEnter={(event) => handleReferenceDragEnter(event, "image")}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800" title={`${referenceLimits.mode === "first_last_frames" ? (index === 0 ? "首帧" : "尾帧") : "参考图"} ${seedanceReferenceLabel("image", index)}`}>
                                            <img src={item.dataUrl} alt={`${item.name}，${seedanceReferenceLabel("image", index)}`} className="size-full object-cover" />
                                            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-white/30">
                                                {referenceLimits.mode === "first_last_frames" ? `${index === 0 ? "首帧" : "尾帧"} · ${seedanceReferenceLabel("image", index)}` : seedanceReferenceLabel("image", index)}
                                            </span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考图"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{referenceDragTarget === "image" ? "松开即可上传参考图" : imageReferenceHint}</div> : null}
                                </div>
                            </div> : alternateImageReferenceMode ? (
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-stone-300 px-3 py-3 text-sm dark:border-stone-700">
                                    <span className="text-stone-500 dark:text-stone-400">当前为文生视频模式，可切换到图片能力并上传参考图。</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={switchAndUploadImageReference}>
                                        切换并上传参考图
                                    </Button>
                                </div>
                            ) : null}

                            {referenceLimits.maxVideos > 0 ? (
                                <div className="min-w-0">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-base font-semibold">参考视频</span>
                                        <Button size="small" icon={<Upload className="size-3.5" />} disabled={videoReferences.length >= referenceLimits.maxVideos} onClick={() => openReferenceUpload("video")}>
                                            上传
                                        </Button>
                                    </div>
                                    <div
                                        className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget === "video" ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                        onDragEnter={(event) => handleReferenceDragEnter(event, "video")}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                        }}
                                        onDragLeave={handleReferenceDragLeave}
                                        onDrop={handleReferenceDrop}
                                    >
                                        {videoReferences.map((item, index) => (
                                            <div key={item.id} className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800" title={`参考视频 ${seedanceReferenceLabel("video", index, { images: references.length, videos: videoReferences.length })}`}>
                                                <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                                <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-white/30">{seedanceReferenceLabel("video", index, { images: references.length, videos: videoReferences.length })}</span>
                                                <ReferenceOrderButtons index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                                <button
                                                    type="button"
                                                    className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                    onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                    aria-label="移除参考视频"
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                        {!videoReferences.length ? (
                                            <div className="flex min-w-full items-center justify-center text-sm text-stone-500">
                                                {referenceDragTarget === "video" ? "松开即可上传参考视频" : "暂无参考视频，可拖入多个文件，最终由 UniArt 校验"}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            {referenceLimits.maxAudios > 0 ? (
                                <div className="min-w-0">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-base font-semibold">参考音频</span>
                                        <Button size="small" icon={<Upload className="size-3.5" />} disabled={audioReferences.length >= referenceLimits.maxAudios} onClick={() => openReferenceUpload("audio")}>
                                            上传
                                        </Button>
                                    </div>
                                    <div
                                        className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget === "audio" ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                        onDragEnter={(event) => handleReferenceDragEnter(event, "audio")}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                        }}
                                        onDragLeave={handleReferenceDragLeave}
                                        onDrop={handleReferenceDrop}
                                    >
                                        {audioReferences.map((item, index) => (
                                            <div key={item.id} className="group relative flex h-20 w-48 shrink-0 flex-col justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900" title={`参考音频 ${seedanceReferenceLabel("audio", index, { images: references.length, videos: videoReferences.length })}`}>
                                                <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                                    <Music2 className="size-4 shrink-0" />
                                                    <span className="shrink-0 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-white/30">{seedanceReferenceLabel("audio", index, { images: references.length, videos: videoReferences.length })}</span>
                                                    <span className="truncate">{item.name}</span>
                                                </div>
                                                <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                                <ReferenceOrderButtons index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                                <button
                                                    type="button"
                                                    className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                    onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                    aria-label="移除参考音频"
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                        {!audioReferences.length ? (
                                            <div className="flex min-w-full items-center justify-center text-center text-sm text-stone-500">
                                                {referenceDragTarget === "audio" ? "松开即可上传参考音频" : "暂无参考音频，可拖入多个文件；单个 15MB 内，最终由 UniArt 校验"}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {videoResolutionLabel(effectiveConfig.vquality)} · {videoSizeLabel(effectiveConfig.size)} · {normalizeVideoSeconds(effectiveConfig.videoSeconds)}s
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    调整
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={submitting} disabled={!canGenerate || submitting} onClick={() => void generate()}>
                                开始生成
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">生成结果</h2>
                            {running ? <Tag className="m-0 px-2 py-1">等待 {formatDuration(elapsedMs)}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || "生成失败"} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成视频" />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files, fileInputTargetRef.current);
                    fileInputTargetRef.current = "all";
                    event.target.value = "";
                }}
            />
            <Drawer title="生成记录" placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={previewGenerationLog}
                />
            </Drawer>
            <Drawer title="参数" placement="bottom" height="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal
                title="恢复视频任务"
                open={recoverTaskOpen}
                centered
                okText="恢复"
                cancelText="取消"
                onOk={() => void recoverGenerationTask()}
                onCancel={() => {
                    setRecoverTaskOpen(false);
                    setRecoverTaskId("");
                }}
            >
                <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">输入 UniArt 返回的 task_ 任务 ID，将查询并保存已有视频，不会重新生成或重复扣费。</p>
                <Input value={recoverTaskId} placeholder="task_xxxxxxxxx" autoFocus onChange={(event) => setRecoverTaskId(event.target.value)} onPressEnter={() => void recoverGenerationTask()} />
            </Modal>
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={config} model={model} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" showReferenceModes={false} />
            </div>
        </>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        添加到资产
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        下载
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>生成中</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    重试
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">生成记录</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    新建
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? "取消" : "全选"}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    删除
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">暂无生成记录</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{videoResolutionLabel(log.resolution)}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "成功" ? "blue" : log.status === "生成中" ? "processing" : "red"}>
                        {log.status}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs)}
                    </Tag>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs(onRawLogs?: (logs: GenerationLog[]) => void) {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        const sortedLogs = logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        onRawLogs?.(sortedLogs);
        return (await Promise.all(sortedLogs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url).catch(() => log.video?.url || "") } : log.video;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url).catch(() => item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url).catch(() => item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl).catch(() => item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "成功",
        task: log.task,
        video,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > 15000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn("已忽略不符合时长要求的参考音频：单个 2-15 秒，总时长不超过 15 秒");
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoReferenceMode: log.config?.videoReferenceMode || "image_reference",
        videoFaceMode: log.config?.videoFaceMode || "false",
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    videoReferences,
    audioReferences,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoReferenceMode: config.videoReferenceMode,
        videoFaceMode: config.videoFaceMode,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const seedance = isSeedanceVideoConfig({ ...config, model });
    return {
        ...config,
        model,
        videoModel: model,
        size: seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoRatioValue(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
    };
}

function videoReferenceLimitsForConfig(config: AiConfig) {
    const model = config.videoModel || config.model;
    const capability = videoCapabilityOf(config, model);
    if (capability) return resolveUniArtReferenceLimits(capability, config.videoReferenceMode);
    const seedance = isSeedanceVideoConfig({ ...config, model });
    return { mode: "image_reference" as const, maxImages: seedance ? SEEDANCE_REFERENCE_LIMITS.images : 0, maxVideos: seedance ? SEEDANCE_REFERENCE_LIMITS.videos : 0, maxAudios: seedance ? SEEDANCE_REFERENCE_LIMITS.audios : 0 };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessageOf(error: unknown) {
    return error instanceof Error ? error.message : String(error || "未知错误");
}

async function readStorageRecords<T>(store: ReturnType<typeof coreStore>) {
    const records: T[] = [];
    await store.iterate<T, void>((value) => {
        records.push(value);
    });
    return records;
}
