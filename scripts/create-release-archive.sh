#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
output=${1:-/tmp/artcanvas-$(git -C "$repo_root" rev-parse --short=12 HEAD).tar.gz}
origin_url=$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)

case "$origin_url" in
    *locopepe2024/artcanvas.git) ;;
    *)
        echo "拒绝归档：当前仓库 origin 不是 ArtCanvas：$origin_url" >&2
        exit 1
        ;;
esac

if [ ! -f "$repo_root/web/package.json" ] || [ ! -f "$repo_root/asset-server/go.mod" ]; then
    echo "拒绝归档：当前 Git 根目录缺少 ArtCanvas 关键路径：$repo_root" >&2
    exit 1
fi

if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
    echo "拒绝归档：ArtCanvas 工作树存在未提交变更" >&2
    exit 1
fi

git -C "$repo_root" archive --format=tar.gz --output="$output" HEAD

archive_commit=$(gzip -dc "$output" | git get-tar-commit-id)
head_commit=$(git -C "$repo_root" rev-parse HEAD)
if [ "$archive_commit" != "$head_commit" ]; then
    echo "拒绝归档：archive=$archive_commit HEAD=$head_commit" >&2
    exit 1
fi

for path in AGENTS.md VERSION web/package.json web/src/pages/video/index.tsx asset-server/go.mod; do
    if ! gzip -dc "$output" | tar -tf - "$path" >/dev/null 2>&1; then
        echo "拒绝归档：缺少关键路径 $path" >&2
        exit 1
    fi
done

echo "$output"
