import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export function buildVideoReferenceMentions(images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[], mode?: string): CanvasResourceReference[] {
    const counts = { images: images.length, videos: videos.length };
    return [
        ...images.map((reference, index): CanvasResourceReference => {
            const label = seedanceReferenceLabel("image", index, counts);
            const frameLabel = mode === "first_last_frames" && index < 2 ? `${index === 0 ? "首帧" : "尾帧"} · ${label}` : label;
            return {
                id: `video-page-image:${reference.id}`,
                nodeId: reference.id,
                kind: "image",
                label,
                displayLabel: frameLabel,
                title: reference.name || frameLabel,
                previewUrl: reference.dataUrl || reference.url,
                active: true,
            };
        }),
        ...videos.map((reference, index): CanvasResourceReference => {
            const label = seedanceReferenceLabel("video", index, counts);
            return {
                id: `video-page-video:${reference.id}`,
                nodeId: reference.id,
                kind: "video",
                label,
                displayLabel: label,
                title: reference.name || label,
                previewUrl: reference.url,
                active: true,
            };
        }),
        ...audios.map((reference, index): CanvasResourceReference => {
            const label = seedanceReferenceLabel("audio", index, counts);
            return {
                id: `video-page-audio:${reference.id}`,
                nodeId: reference.id,
                kind: "audio",
                label,
                displayLabel: label,
                title: reference.name || label,
                previewUrl: reference.url,
                active: true,
            };
        }),
    ];
}
