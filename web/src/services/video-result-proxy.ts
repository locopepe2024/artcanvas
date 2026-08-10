const UNIART_VIDEO_CACHE_ORIGIN = "https://storage.iyishow.com";
const UNIART_VIDEO_CACHE_PREFIX = "/uniart-cache/videos/";
const CANVAS_VIDEO_PROXY_PREFIX = "/api/video-result-proxy/videos/";

export function canvasVideoResultUrl(value: string) {
    try {
        const url = new URL(value);
        if (url.origin !== UNIART_VIDEO_CACHE_ORIGIN || !url.pathname.startsWith(UNIART_VIDEO_CACHE_PREFIX)) return value;
        return `${CANVAS_VIDEO_PROXY_PREFIX}${url.pathname.slice(UNIART_VIDEO_CACHE_PREFIX.length)}${url.search}`;
    } catch {
        return value;
    }
}
