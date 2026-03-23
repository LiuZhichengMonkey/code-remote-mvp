# Examples

示例代码位于 `examples/`，用于演示 WebSocket 协议、多智能体能力和 Agent 配置。

## 运行前提

先在仓库根目录完成一次：

```powershell
.\scripts\windows\setup.ps1
```

以下命令都默认从仓库根目录执行。

## 目录说明

```text
examples/
  websocket/      WebSocket 协议示例
  multi-agent/    多智能体与 EventBus 示例
  agents/         Agent 配置示例
  frontend/       前端接入示例
```

## 多智能体示例

```powershell
npx tsx .\examples\multi-agent\basic-debate.ts basic
npx tsx .\examples\multi-agent\parallel-debate.ts basic
npx tsx .\examples\multi-agent\eventbus-usage.ts basic
```

这些示例会复用 `apps/server/src/multi-agent` 中的实现，运行产物默认写入 `runtime/`。

## 其它文档

- WebSocket 示例说明：`examples/websocket/README.md`
- Agent 配置说明：`examples/agents/README.md`
- 多智能体源码说明：`apps/server/src/multi-agent/README.md`
