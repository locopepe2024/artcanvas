import { type ReactNode } from "react";
import { Switch } from "antd";
import { FileText, GalleryHorizontalEnd, Image, Images, Layers3, type LucideIcon } from "lucide-react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { resolveUniArtReferenceMode, resolveUniArtVideoParams, supportedUniArtReferenceModes, type UniArtVideoCapability, type UniArtVideoReferenceMode } from "@/lib/uniart-video";
import { modelCapabilityOf, videoCapabilityOf, type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
    { value: "4k", label: "4K" },
];

const sizeOptions = [
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "1:1", label: "方形" },
    { value: "4:3", label: "横向 4:3" },
    { value: "3:4", label: "竖向 3:4" },
];

const secondOptions = Array.from({ length: 12 }, (_, index) => index + 4);

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    model?: string;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoReferenceMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    showReferenceModes?: boolean;
    compactLabels?: boolean;
};

export function VideoSettingsPanel({ config, model, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", showReferenceModes = true, compactLabels = false }: VideoSettingsPanelProps) {
    const selectedModel = model || (modelCapabilityOf(config, config.model) === "video" ? config.model : config.videoModel || config.model);
    const uniArtCapability = videoCapabilityOf(config, selectedModel);
    if (uniArtCapability) {
        return <UniArtVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} capability={uniArtCapability} showReferenceModes={showReferenceModes} compactLabels={compactLabels} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} compactLabels={compactLabels} />;
    }

    const seconds = config.videoSeconds || "6";
    const size = normalizeVideoRatioValue(config.size);
    const resolution = normalizeVideoResolutionValue(config.vquality);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className={`flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent transition hover:opacity-80 ${compactLabels ? "text-xs" : "text-sm"}`}
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[11px] leading-none opacity-55">{item.value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <DurationTimeline values={secondOptions} value={Number(seconds)} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
            </div>
        </ImageSettingsTheme>
    );
}

function UniArtVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, capability, showReferenceModes, compactLabels }: VideoSettingsPanelProps & { capability: UniArtVideoCapability }) {
    const params = resolveUniArtVideoParams(capability, { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality });
    const generateAudio = boolConfig(config.videoGenerateAudio, true);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                {showReferenceModes ? <ReferenceModeSettings capability={capability} value={config.videoReferenceMode} theme={theme} compactLabels={compactLabels} onChange={(value) => onConfigChange("videoReferenceMode", value)} /> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={params.resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => {
                            const preview = ratioPreview(item.value);
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    className={`flex min-h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 transition hover:opacity-80 ${compactLabels ? "text-xs" : "text-sm"}`}
                                    style={{ borderColor: params.ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", item.value)}
                                >
                                    <SizePreview width={preview.width} height={preview.height} color={theme.node.text} />
                                    <span>{item.label}</span>
                                    <span className="text-[10px] leading-none opacity-55">{item.value}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                <DurationTimeline values={secondOptions} value={params.seconds} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="rounded-xl border px-2.5 py-1" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label={generateAudio ? "音频开" : "音频关"} checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                    </div>
                </SettingGroup>
                <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                    参数最终由 UniArt 根据可用候选进行校验和路由。
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function VideoReferenceModeSelector({ config, model, onConfigChange, theme, className = "" }: Pick<VideoSettingsPanelProps, "config" | "model" | "onConfigChange" | "theme" | "className">) {
    const selectedModel = model || config.videoModel || config.model;
    const capability = videoCapabilityOf(config, selectedModel);
    if (!capability || !supportedUniArtReferenceModes(capability).length) return null;
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <ReferenceModeSettings capability={capability} value={config.videoReferenceMode} theme={theme} compactLabels onChange={(value) => onConfigChange("videoReferenceMode", value)} />
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, compactLabels }: VideoSettingsPanelProps) {
    const resolution = normalizeSeedanceResolution(config.vquality);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceResolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className={`flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 transition hover:opacity-80 ${compactLabels ? "text-xs" : "text-sm"}`}
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "自动匹配" : item.value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <DurationTimeline values={secondOptions} value={duration} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label={generateAudio ? "音频开" : "音频关"} checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

const referenceModeLabels: Record<UniArtVideoReferenceMode, { title: string; icon: LucideIcon }> = {
    text_to_video: { title: "文生视频", icon: FileText },
    image_to_video: { title: "图生视频", icon: Image },
    image_reference: { title: "图片参考", icon: Images },
    first_last_frames: { title: "首尾帧", icon: GalleryHorizontalEnd },
    omni_reference: { title: "全能参考", icon: Layers3 },
};

function ReferenceModeSettings({ capability, value, theme, compactLabels = false, onChange }: { capability: UniArtVideoCapability; value: string; theme: CanvasTheme; compactLabels?: boolean; onChange: (value: UniArtVideoReferenceMode) => void }) {
    const modes = supportedUniArtReferenceModes(capability);
    const selected = resolveUniArtReferenceMode(capability, value);
    return (
        <SettingGroup title="生成方式" color={theme.node.muted}>
            <div className="grid grid-cols-5 gap-1.5">
                {modes.map((mode) => {
                    const Icon = referenceModeLabels[mode].icon;
                    return (
                        <button
                            key={mode}
                            type="button"
                            className={`flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border bg-transparent px-0.5 font-medium leading-none transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${compactLabels ? "text-[10px]" : "text-xs"}`}
                            style={{ borderColor: selected === mode ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                            aria-pressed={selected === mode}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => onChange(mode)}
                        >
                            <Icon className="size-3.5 shrink-0" />
                            <span className="max-w-full whitespace-nowrap">{referenceModeLabels[mode].title}</span>
                        </button>
                    );
                })}
            </div>
            <div className="text-[11px] leading-4" style={{ color: theme.node.muted }}>入口由 UniArt 模型能力声明；素材数量与组合在提交时由 UniArt 最终校验。</div>
        </SettingGroup>
    );
}

export function videoResolutionLabel(value: string) {
    return resolutionTokenLabel(value);
}

export function videoSizeLabel(value: string) {
    if (/^\d+:\d+$/.test(value || "")) return videoRatioLabel(value);
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    return normalizeVideoRatioValue(value);
}

export function normalizeVideoRatioValue(value: string) {
    if (["16:9", "9:16", "1:1", "4:3", "3:4"].includes(value)) return value;
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (match) {
        const width = Number(match[1]);
        const height = Number(match[2]);
        const ratio = width / height;
        if (Math.abs(ratio - 1) < 0.05) return "1:1";
        if (Math.abs(ratio - 4 / 3) < 0.08) return "4:3";
        if (Math.abs(ratio - 3 / 4) < 0.08) return "3:4";
        return width > height ? "16:9" : "9:16";
    }
    return "16:9";
}

export function normalizeVideoResolutionValue(value: string) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase();
    if (normalized === "low" || normalized === "480" || normalized === "480p") return "480p";
    if (["auto", "high", "medium", "720", "720p"].includes(normalized)) return "720p";
    if (normalized === "1080" || normalized === "1080p") return "1080p";
    if (normalized === "4k" || normalized === "2160" || normalized === "2160p") return "4k";
    return "720p";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function DurationTimeline({ values, value, theme, onChange }: { values: number[]; value: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const options = [...new Set(values)].sort((left, right) => left - right);
    const selectedIndex = options.reduce((best, option, index) => (Math.abs(option - value) < Math.abs(options[best] - value) ? index : best), 0);
    const selected = options[selectedIndex];
    const disabled = options.length <= 1;
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                    时长
                </span>
                <output className="text-sm font-semibold tabular-nums" style={{ color: theme.node.text }}>
                    {selected} 秒
                </output>
            </div>
            <input
                type="range"
                min={0}
                max={Math.max(0, options.length - 1)}
                step={1}
                value={selectedIndex}
                disabled={disabled}
                aria-label="视频时长"
                aria-valuetext={`${selected} 秒`}
                className="h-8 w-full cursor-pointer accent-current disabled:cursor-default disabled:opacity-50"
                style={{ color: theme.node.text }}
                onChange={(event) => onChange(options[Number(event.target.value)])}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <div className="flex justify-between text-[10px] tabular-nums" style={{ color: theme.node.muted }}>
                <span>{options[0]}s</span>
                <span>{options.at(-1)}s</span>
            </div>
        </div>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive" || ratio === "auto") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function videoRatioLabel(value: string) {
    if (value === "auto" || value === "adaptive") return "自适应";
    return seedanceRatioOptions.find((item) => item.value === value)?.label || value;
}

function resolutionTokenLabel(value: string) {
    const normalized = String(value || "720").trim();
    if (/^4k$/i.test(normalized)) return "4K";
    if (/^\d+(?:p|k)$/i.test(normalized)) return normalized.toLowerCase();
    const canonical = normalizeVideoResolutionValue(normalized);
    return canonical === "4k" ? "4K" : canonical;
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}
