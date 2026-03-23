# CodeRemote

CodeRemote 是一个面向 Windows 的本地远程控制项目，提供统一的 Web UI 来连接本机的 `claude` 和 `codex` CLI。

当前推荐流程已经整理为：

1. `git clone`
2. 复制一份本地配置
3. 运行一次 `setup.ps1`
4. 日常使用只运行 `start.ps1`

## 快速开始

### 1. 准备依赖

- Node.js 18+
- 本机可用的 `claude`
- 本机可用的 `codex`
- `ngrok`，仅当你需要 `tunnel.mode = "ngrok"` 时才需要

### 2. 复制配置

```powershell
Copy-Item .\config\coderemote.example.json .\config\coderemote.local.json
```

至少需要检查这些字段：

- `server.port`
- `server.token`
- `server.workspaceRoot`
- `tunnel.mode`
- `tunnel.customPublicWsUrl`
- `providers.claude.cliCommand`
- `providers.codex.cliCommand`

### 3. 首次安装与构建

```powershell
.\scripts\windows\setup.ps1
```

这个脚本会：

- 检查 `node`、`npm`、`claude`、`codex`、`ngrok`
- 安装 `apps/server` 和 `apps/web` 的依赖
- 构建后端和前端
- 初始化 `runtime/`
- 将 provider 配置写入本机 Claude/Codex 配置

### 4. 启动服务

```powershell
.\scripts\windows\start.ps1
```

启动后默认提供：

- 本地 UI: `http://localhost:<server.port>`
- 本地 WebSocket: `ws://localhost:<server.port>`

## 自动启动

安装登录自启动：

```powershell
.\scripts\windows\install-autostart.ps1
```

卸载登录自启动：

```powershell
.\scripts\windows\uninstall-autostart.ps1
```

是否在登录后自动打开浏览器，由 `config/coderemote.local.json` 中的 `autostart.openBrowserOnLogin` 控制。

## 目录结构

```text
apps/
  server/   后端与 CLI 封装
  web/      React Web UI
  mobile/   Flutter 移动端
config/
  coderemote.example.json
  coderemote.local.json
scripts/windows/
  setup.ps1
  start.ps1
  install-autostart.ps1
  uninstall-autostart.ps1
runtime/
  logs/
  uploads/
  reports/
  discussions/
docs/
examples/
tests/
```

## 开发与测试

- 开发说明见 `DEVELOPMENT.md`
- 手测清单见 `TESTING.md`
- 示例见 `examples/README.md`
