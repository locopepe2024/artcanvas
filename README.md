<p align="center">
  <img src="web/public/logo.svg" width="96" alt="ArtCanvas logo">
</p>

<h1 align="center">ArtCanvas</h1>

<p align="center">
  面向图片、视频、音频与 Agent 工作流的开源无限画布
</p>

<p align="center">
  <a href="https://github.com/locopepe2024/artcanvas"><img src="https://img.shields.io/github/stars/locopepe2024/artcanvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/locopepe2024/artcanvas/tags"><img src="https://img.shields.io/github/v/tag/locopepe2024/artcanvas?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> ·
  <a href="docs/content/docs/overview/features.mdx">功能介绍</a> ·
  <a href="docs/content/docs/overview/docker.mdx">Docker 部署</a> ·
  <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布手册</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="SECURITY.md">安全策略</a>
</p>

ArtCanvas 将画布编排、AI 图片与视频生成、参考素材、提示词、个人素材和本地 Codex Agent 放在同一个浏览器工作台中。项目默认由浏览器直接请求用户配置的 OpenAI 兼容接口，画布、素材、生成记录和 API 配置主要保存在浏览器本地。

> [!CAUTION]
> 项目仍处于快速开发阶段，不保证不同版本之间的浏览器本地数据完全兼容。API Key 和 WebDAV 凭据保存在用户浏览器中，请勿在公共设备保存真实密钥，也不要公开分享配置导出文件。

## 上游与许可

ArtCanvas 基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 开发，并保留上游提交历史、作者信息和 AGPL-3.0 许可。ArtCanvas 的新增修改同样以 GNU Affero General Public License v3.0 发布，详细来源说明见 [NOTICE](NOTICE)。

## 核心功能

- 无限画布：多画布、节点拖拽缩放、连线、分组、小地图、撤销重做和导入导出。
- AI 创作：支持文本、图片、视频和音频生成，可配置 OpenAI 兼容接口及自定义调用脚本。
- 视频参考：支持文生视频、图生视频、图片参考、首尾帧和全能参考，并支持图片、视频、音频素材的连续 `@n` 索引。
- 视频任务恢复：持久化远端任务状态，刷新后继续查询；结果下载失败时可重新下载而不重复生成。
- 本地 Agent：通过 Canvas Agent 连接 Codex 或 Claude Code，以 MCP 工具读取和操作当前画布。
- 插件系统：支持远程节点插件、官方插件注册表和 TypeScript 插件 SDK。
- 本地优先：画布项目、个人素材和生成记录默认保存在 IndexedDB。

完整说明见 [功能介绍](docs/content/docs/overview/features.mdx)。

## 本地开发

需要 Bun 1.3+。

```bash
git clone https://github.com/locopepe2024/artcanvas.git
cd artcanvas/web
bun install
bun run dev
```

默认访问地址为 `http://localhost:3000`。

## Docker

```bash
git clone https://github.com/locopepe2024/artcanvas.git
cd artcanvas
docker compose up -d
```

Docker 默认映射端口 `3000`。首次打开后，在配置页面填写自己的 Base URL、API Key和模型。

## Canvas Agent

仓库内包含 Canvas Agent源码。当前兼容的上游 npm 包仍为 `@basketikun/canvas-agent`；ArtCanvas 暂不自动发布新的 npm 包，开发和验证本仓库 Agent 时请使用源码：

```bash
cd canvas-agent
npm ci
npm run build
npm test
```

## 贡献与安全

- 贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 提交贡献即表示同意 [CLA.md](CLA.md) 中适用于 ArtCanvas 新贡献的条款。
- 安全问题请按 [SECURITY.md](SECURITY.md) 通过私密渠道报告，不要在公开 Issue 中提交密钥或利用细节。

## 开源协议

项目使用 [GNU Affero General Public License v3.0](LICENSE)。如果修改后的版本通过网络向用户提供服务，需要按照 AGPL-3.0 向这些用户提供对应源代码并保留许可证与来源说明。
