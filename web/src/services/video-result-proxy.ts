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

export function canvasAuthenticatedVideoResultUrl(value: string, apiBaseUrl: string) {
    try {
        const target = new URL(value, apiBaseUrl);
        const api = new URL(apiBaseUrl);
        const match = target.pathname.match(/^\/v1\/videos\/(task_[A-Za-z0-9]+)\/content\/?$/);
        if (target.origin !== api.origin || !/^uniart\.fun$/i.test(api.hostname) || !match) return target.toString();
        return `/api/video-content-proxy/${match[1]}`;
    } catch {
        return value;
    }
}
