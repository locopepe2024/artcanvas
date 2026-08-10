import axios from "axios";

export type UploadedVideoReferenceAsset = {
    url: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
};

export async function uploadVideoReferenceAsset(input: File | Blob, fileName?: string, signal?: AbortSignal): Promise<UploadedVideoReferenceAsset> {
    const name = input instanceof File ? input.name : fileName || referenceFileName(input.type);
    const file = input instanceof File ? input : new File([input], name, { type: input.type || "application/octet-stream" });
    const metadataPromise = readReferenceMetadata(file);
    const body = new FormData();
    body.append("file", file);
    const response = await axios.post<{ path?: string }>("/api/video-assets", body, { signal }).catch((error: unknown) => {
        if (axios.isAxiosError<{ error?: { message?: string } }>(error)) throw new Error(error.response?.data?.error?.message || `参考素材上传失败（HTTP ${error.response?.status || "网络错误"}）`);
        throw error;
    });
    if (!response.data.path) throw new Error("参考素材上传接口没有返回访问地址");
    return {
        url: new URL(response.data.path, window.location.origin).toString(),
        bytes: file.size,
        mimeType: file.type || "application/octet-stream",
        ...(await metadataPromise),
    };
}

export function isCanvasVideoAssetUrl(value?: string, currentOrigin = typeof window === "undefined" ? "" : window.location.origin) {
    if (!value || !currentOrigin) return false;
    try {
        const url = new URL(value, currentOrigin);
        return url.origin === currentOrigin && /^\/video-assets\/[0-9a-f]{64}\.[a-z0-9]+$/i.test(url.pathname);
    } catch {
        return false;
    }
}

async function readReferenceMetadata(file: File) {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/")) return {};
    const url = URL.createObjectURL(file);
    try {
        if (file.type.startsWith("image/")) return await readImageMetadata(url);
        if (file.type.startsWith("video/")) return await readVideoMetadata(url);
        return await readAudioMetadata(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function readImageMetadata(url: string) {
    return new Promise<{ width?: number; height?: number }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
        image.onerror = () => resolve({});
        image.src = url;
    });
}

function readVideoMetadata(url: string) {
    return new Promise<{ width?: number; height?: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve({ width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        };
        const timeout = window.setTimeout(done, 5000);
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMetadata(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        };
        const timeout = window.setTimeout(done, 5000);
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}

function referenceFileName(mimeType: string) {
    if (mimeType === "image/jpeg") return "reference.jpg";
    if (mimeType.startsWith("image/")) return "reference.png";
    if (mimeType.startsWith("video/")) return "reference.mp4";
    if (mimeType.startsWith("audio/")) return "reference.mp3";
    return "reference.bin";
}
