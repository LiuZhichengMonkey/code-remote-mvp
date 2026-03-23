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

默认模板已经提供一套可直接本地测试的值：

- `server.port = 8085`
- `server.token = "test123"`
- `server.workspaceRoot = "."`

至少需要检查这些字段：

- `server.port`
- `server.token`
- `server.workspaceRoot`
- `tunnel.mode`
- `tunnel.customPublicWsUrl`
- `providers.claude.cliCommand`
- `providers.codex.cliCommand`

如果你想直接复用现成的外网入口，常见配置是：

- `tunnel.mode = "custom"`
- `tunnel.customPublicWsUrl = "wss://acropetal-nonfalteringly-ruben.ngrok-free.dev"`

注意：

- `custom` 模式只告诉 CodeRemote “对外地址是什么”，不会替你创建隧道。
- 如果你希望脚本自己启动 ngrok，请改成 `tunnel.mode = "ngrok"`。

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

如果你本机浏览器对 `localhost` 有解析或缓存问题，优先使用：

- 本地 UI: `http://127.0.0.1:<server.port>`
- 本地 WebSocket: `ws://127.0.0.1:<server.port>`

如果后台启动后你怀疑服务没有常驻，可以改用前台模式：

```powershell
.\scripts\windows\start.ps1 -Foreground
```

前台模式会持续输出实时日志，适合首次搭建和排查连接问题。

## 连接参数

默认本地连接参数如下：

- URL: `ws://127.0.0.1:8085`
- Token: `test123`

如果你启用了上面的自定义外网入口，则对应连接参数是：

- URL: `wss://acropetal-nonfalteringly-ruben.ngrok-free.dev`
- Token: `test123`

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
