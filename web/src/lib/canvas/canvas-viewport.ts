export const CANVAS_MIN_SCALE = 0.1;
export const CANVAS_MAX_SCALE = 16;
export const CANVAS_WHEEL_ZOOM_FACTOR = 1.12;

export function clampCanvasScale(scale: number) {
    return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale));
}
