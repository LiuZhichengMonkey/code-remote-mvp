# Claude CLI 不可用时显示误导性 "API Key not configured" 错误

**日期**: 2026-06-24
**类型**: Bugfix
**影响范围**: `apps/server/src/claude/engine.ts`、`scripts/windows/start.ps1`

## 现象

用户启动 code-remote 后对话时收到错误：

```
API Key not configured. Set ANTHROPIC_API_KEY environment variable or configure in config.
```

错误归类 code 为 `API_KEY_MISSING`，误导用户去检查 API key。但实际上他们根本没设过 key（也不需要——项目走 Claude CLI 子进程，不需要 ANTHROPIC_API_KEY）。

## 根因

1. **`ClaudeCodeEngine.detectClaudeCLI()`（engine.ts:71）永久缓存探测结果**
   `spawn('claude', ['--version'], { shell: true })` 失败时（exit code 1 或 close code 1），把 `cliAvailable` 缓存为 `false`，**整个进程生命周期不再重试**。

2. **`sendMessage` 的 fallback 分支是死代码**
   探测返回 false 后走 `callAnthropicAPI()`（engine.ts:479-558），要求 `this.config.apiKey` 有值。但 `ClaudeCodeEngine` 的所有调用点（`handlers/claude.ts:112`、`multi-agent/llm-adapter.ts:114`）都没传 `config.apiKey`；并且 `apps/server/package.json` 里**根本没有 `@anthropic-ai/sdk` 依赖**。所以这条分支一旦走到，必然抛 "API Key not configured"。

3. **`detectClaudeCLI` 找不到 `claude` 的常见原因**
   - 服务以非交互 shell / 计划任务 / Windows 服务启动，PATH 被精简，`%APPDATA%\npm` 不在其中
   - `claude.cmd` 内部探测 ANTHROPIC 凭据缓存失败时也会以非 0 退出
   - 冷启动 5 秒超时被触发

**触发链路**：`PATH 缺 npm` → `detectClaudeCLI` close code 1 → 缓存 `cliAvailable=false` → `sendMessage` 走 SDK 分支 → 抛 `API Key not configured`（错误归类 `API_KEY_MISSING`）

## 解决方案

### 1. 引擎层 (`apps/server/src/claude/engine.ts`)

- **删除 `callAnthropicAPI` 整个方法**（约 80 行）。`@anthropic-ai/sdk` 不在 `package.json` 里，是死代码。
- **`sendMessage` 入口显式校验**：探测失败时抛出**准确错误**并归类为 `CLI_NOT_FOUND`，告诉用户实际是 PATH 找不到 `claude`，给出修复建议（安装 CLI 或在 config 设绝对路径）。
- **修复 `cliAvailable` 永久缓存 bug**：
  - 成功探测缓存 60s（避免每个消息都 spawn 一次 `--version`）
  - **失败探测不缓存**，让用户在修复 PATH 后下次消息能立即重试
  - 新增 `cliAvailableSince` 时间戳字段

### 2. 启动脚本 (`scripts/windows/start.ps1`)

- **前台分支**：用 `Add-CodeRemoteCommandDirectoryToPath -Value $claudeCommand / -Value $codexCommand` 把 provider CLI 目录 prepend 到 `$env:PATH`，让 node 子进程能 `spawn` 到 `claude`
- **后台 launcher.cmd**：在 `setlocal` 之后加 `set "PATH=%PATH%;<当前PATH>"` 透传给 cmd 子进程

## 测试验证

3 个端到端场景验证：

1. **PATH 正常** → `claude_done` 成功，0 个错误
2. **PATH 缺 npm**（手工设 `PATH=C:\Windows\System32`）→ 抛出准确错误：
   ```
   sendError: CLI_NOT_FOUND
   Claude CLI not available. Tried 'claude --version' but the command was found on PATH.
   Install Claude Code (https://claude.com/claude-code) or set providers.claude.cliCommand
   in config.json to an absolute path, then restart the server.
   ```
   不再误导用户去设 `ANTHROPIC_API_KEY`。
3. **探测失败后 PATH 修复** → 立即恢复成功（不再被永久缓存卡死）

单测 7/7 通过（`engine-args.test.ts`、`claude-handler-access.test.ts`），TypeScript `tsc --noEmit` 通过。

## 给后续开发者的注意事项

- 不要在 server 里加 `ANTHROPIC_API_KEY` / `@anthropic-ai/sdk` 相关代码——项目当前架构是 **Claude CLI 子进程模式**，不需要 API key。需要 SDK 直接调用时应该走 `multi-agent/llm-adapter.ts` 的 `AnthropicAdapter`（那个有正确的 key 传递路径）。
- `detectClaudeCLI` 的失败-不缓存策略是有意的。如果以后要恢复更激进的缓存，需要确保失败能通过 `updateConfig({preferCLI: undefined !== ...})` 重置。
- 任何用 `spawn(..., { shell: true })` 的地方都受 PATH 影响。如果遇到类似 "command not found"，先确认子进程 PATH。