# CodeRemote 开发说明

## 仓库布局

```text
apps/server   Node/TypeScript 后端，负责 WebSocket、会话、provider 接入
apps/web      React Web UI
apps/mobile   Flutter 移动端
config        仓库级配置模板与本地配置
scripts       启动、安装、自启动脚本
runtime       日志、上传、讨论会话、报告等运行产物
examples      集成示例与多智能体示例
tests         仓库级补充测试，浏览器冒烟脚本位于 tests/e2e/agent-browser
```

约束：

- 新的用户入口不要再放到仓库根目录。
- 运行期产物统一写入 `runtime/`。
- Windows 用户默认使用 `scripts/windows/setup.ps1` 和 `scripts/windows/start.ps1`。

## 常用命令

### 后端

```powershell
cd .\apps\server
npm install
npm run build
npm test
```

### 前端

```powershell
cd .\apps\web
npm install
npm run build
npm test
```

### 移动端

```powershell
cd .\apps\mobile
flutter pub get
flutter run
```

## 推荐开发流程

### 修改启动、配置、provider 行为时

同时检查这些位置：

- `config/coderemote.example.json`
- `scripts/windows/modules/Common.ps1`
- `scripts/windows/setup.ps1`
- `scripts/windows/start.ps1`
- `apps/server/src/repoConfig.ts`
- `apps/server/src/runtimeProfiles.ts`

### 修改前端与后端路径约定时

同时检查这些位置：

- `apps/server/src/index.ts`
- `apps/server/src/server.ts`
- `apps/web/src/`
- `README.md`
- `TESTING.md`

### 修改多智能体讨论相关功能时

默认运行产物路径已经迁到：

- `runtime/discussions/sessions`
- `runtime/reports`

不要再把会话或报告写回仓库根目录。

## 本地启动

日常联调优先使用仓库根目录脚本：

```powershell
.\scripts\windows\setup.ps1
.\scripts\windows\start.ps1
```

如果要排查启动或本地连接问题，优先使用：

```powershell
.\scripts\windows\start.ps1 -Foreground
```

只在需要单独调试某个应用时，才直接进入 `apps/server` 或 `apps/web` 运行命令。

## 提交前检查

至少执行：

1. `npm run build` in `apps/server`
2. `npm run build` in `apps/web`
3. 如改动会话、provider、设置面板，按 `TESTING.md` 做一轮手测

## 不应提交的内容

- `runtime/`
- `apps/server/node_modules/`
- `apps/web/node_modules/`
- 临时日志、截图、调试输出
- 本地配置 `config/coderemote.local.json`
