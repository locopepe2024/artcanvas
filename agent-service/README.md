# ArtCanvas Agent Service

`agent-service` 是通用 Agent 产品协议的 Phase 0 原型，与现有 Codex `canvas-agent` 兼容层并行存在。

当前只包含：

- 产品级 Session、Run、Event、Approval 和 Artifact 契约。
- 可替换的 `AgentRuntimeAdapter` 接口。
- 内存状态仓库和确定性的 Mock Runtime。
- 流式事件游标恢复、审批、拒绝、取消和终态测试。

当前不包含 HTTP/SSE API、持久化数据库、真实 Runtime、记忆、Skill 或生产部署能力，不能替代现有 Canvas Agent。

```bash
npm install
npm test
npm run build
```
