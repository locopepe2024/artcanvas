# Contributing to ArtCanvas

感谢你参与 ArtCanvas。

## 开始之前

- 先搜索现有 Issue 和 Pull Request，避免重复工作。
- Bug 请提供版本、浏览器、复现步骤、预期行为和实际行为。
- 功能或跨模块改动建议先开 Issue 说明目标和边界。
- 不要提交 API Key、访问令牌、Cookie、个人画布数据或带敏感信息的截图。

## 开发

Web：

```bash
cd web
bun install
bun run typecheck
bun run build
node --test src/lib/canvas/*.test.mjs
```

Canvas Agent：

```bash
cd canvas-agent
npm ci
npm test
npm run build
```

素材服务：

```bash
cd asset-server
go test ./...
```

## Pull Request

- 每个 PR 只处理一个明确目标，不混入无关重构。
- 描述变更原因、用户可见影响、验证命令和仍未验证的内容。
- 用户可感知的变化需要更新 `CHANGELOG.md` 的 `Unreleased`。
- 已实现但仍需人工验收的行为写入 `docs/content/docs/progress/pending-test.mdx`。
- 保留上游作者、许可证和来源说明。

提交贡献即表示你同意 [CLA.md](CLA.md)。该 CLA 仅适用于提交到 ArtCanvas 的新贡献，不追溯适用于上游项目的历史贡献。
