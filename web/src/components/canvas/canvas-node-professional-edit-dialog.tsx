import { lazy, Suspense } from "react";
import { Modal, Spin } from "antd";

const FilerobotImageEditor = lazy(() => import("react-filerobot-image-editor"));
const editorTabs = ["Adjust", "Finetune", "Filters", "Annotate", "Watermark", "Resize"] as const;

const translations = {
    save: "保存",
    saveAs: "另存为",
    back: "返回",
    loading: "加载中…",
    resetOperations: "重置全部修改",
    changesLoseWarningHint: "重置后将丢失全部修改，是否继续？",
    discardChangesWarningHint: "关闭后，尚未保存的修改会丢失。",
    cancel: "取消",
    apply: "应用",
    warning: "提示",
    confirm: "确认",
    discardChanges: "放弃修改",
    undoTitle: "撤销",
    redoTitle: "重做",
    showImageTitle: "查看原图",
    zoomInTitle: "放大",
    fitTitle: "适应窗口",
    zoomOutTitle: "缩小",
    adjustTab: "调整",
    finetuneTab: "微调",
    filtersTab: "滤镜",
    watermarkTab: "水印",
    annotateTabLabel: "标注",
    resize: "缩放",
    resizeTab: "缩放",
    imageName: "图片名称",
    cropTool: "裁剪",
    original: "原始比例",
    custom: "自定义",
    square: "方形",
    landscape: "横向",
    portrait: "竖向",
    ellipse: "椭圆",
    arrowTool: "箭头",
    blurTool: "模糊",
    brightnessTool: "亮度",
    contrastTool: "对比度",
    hue: "色相",
    saturation: "饱和度",
    value: "明度",
    imageTool: "图片",
    importing: "导入中…",
    addImage: "添加图片",
    uploadImage: "上传图片",
    lineTool: "线条",
    penTool: "画笔",
    polygonTool: "多边形",
    rectangleTool: "矩形",
    resizeWidthTitle: "宽度（像素）",
    resizeHeightTitle: "高度（像素）",
    toggleRatioLockTitle: "锁定比例",
    resetSize: "恢复原始尺寸",
    rotateTool: "旋转",
    textTool: "文字",
    fontFamily: "字体",
    size: "大小",
    warmthTool: "色温",
    addWatermark: "添加水印",
    addTextWatermark: "添加文字水印",
    uploadWatermark: "上传水印",
    opacity: "不透明度",
    position: "位置",
    stroke: "描边",
    saveAsModalTitle: "保存图片",
    extension: "扩展名",
    format: "格式",
    quality: "质量",
    actualSize: "实际尺寸（100%）",
    fitSize: "适应窗口",
    download: "下载",
    width: "宽度",
    height: "高度",
};

type SavedImageData = {
    imageBase64?: string;
    imageCanvas?: HTMLCanvasElement;
    mimeType?: string;
};

export function CanvasNodeProfessionalEditDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (blob: Blob) => void | Promise<void> }) {
    const saveImage = async (saved: SavedImageData) => {
        const blob = saved.imageCanvas ? await canvasToBlob(saved.imageCanvas, saved.mimeType) : saved.imageBase64 ? await (await fetch(saved.imageBase64)).blob() : null;
        if (!blob) throw new Error("无法读取编辑结果");
        await onConfirm(blob);
    };

    return (
        <Modal open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} closable={false} width="96vw" centered destroyOnHidden styles={{ body: { height: "88vh", minHeight: 560, padding: 0, overflow: "hidden" } }}>
            <div className="h-full overflow-hidden">
                <Suspense fallback={<div className="flex h-full items-center justify-center"><Spin tip="正在加载图片编辑器" /></div>}>
                    <FilerobotImageEditor
                        source={dataUrl}
                        tabsIds={[...editorTabs]}
                        defaultTabId="Adjust"
                        defaultToolId="Crop"
                        savingPixelRatio={1}
                        previewPixelRatio={window.devicePixelRatio || 1}
                        defaultSavedImageType="png"
                        defaultSavedImageName="canvas-edited-image"
                        closeAfterSave={false}
                        useBackendTranslations={false}
                        translations={translations}
                        language="zh"
                        noCrossOrigin
                        observePluginContainerSize
                        onClose={onClose}
                        onSave={saveImage}
                    />
                </Suspense>
            </div>
        </Modal>
    );
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType = "image/png") {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败"))), mimeType));
}
