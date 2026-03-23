# CodeRemote Server

`apps/server` 是 CodeRemote 的后端与 CLI 封装层，负责：

- WebSocket / HTTP 服务
- Claude / Codex provider 接入
- 会话管理
- 设置与 runtime profile 管理
- 多智能体讨论能力

## 推荐启动方式

普通用户不要直接在这里手动拼命令，优先从仓库根目录运行：

```powershell
.\scripts\windows\setup.ps1
.\scripts\windows\start.ps1
```

## 本地开发命令

```powershell
cd .\apps\server
npm install
npm run build
npm test
```

## 直接运行 CLI

```powershell
cd .\apps\server
node .\dist\index.js start --port 8085 --no-tunnel
```

常用命令：

- `start`
- `bootstrap-config`
- `token`
- `test`

### `bootstrap-config`

把仓库级配置写入本机 Claude / Codex 运行配置：

```powershell
node .\dist\index.js bootstrap-config --config-file ..\..\config\coderemote.local.json
```

## 路径约定

- Web 静态资源来自 `apps/web/dist`
- 上传文件写入 `runtime/uploads`
- 多智能体讨论会话写入 `runtime/discussions/sessions`
- 报告写入 `runtime/reports`
