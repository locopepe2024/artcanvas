# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

FROM golang:1.23-alpine AS asset-server-build

WORKDIR /app
COPY asset-server/go.mod ./
COPY asset-server/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /artcanvas-asset-server .

# 运行镜像：Nginx 托管前端，并同源代理 ArtCanvas 自有的短期素材服务。
FROM nginx:1.27-alpine

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY --from=asset-server-build /artcanvas-asset-server /usr/local/bin/artcanvas-asset-server
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
VOLUME ["/data/video-assets"]
