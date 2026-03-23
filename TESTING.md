# CodeRemote 测试清单

## 1. 首次环境验证

1. 复制配置文件：

```powershell
Copy-Item .\config\coderemote.example.json .\config\coderemote.local.json
```

2. 在 `config/coderemote.local.json` 中确认：

- `server.port`
- `server.token`
- `server.workspaceRoot`
- `providers.claude.enabled`
- `providers.codex.enabled`
- `tunnel.mode`

3. 运行安装脚本：

```powershell
.\scripts\windows\setup.ps1
```

预期结果：

- 依赖安装成功
- `apps/server/dist/index.js` 存在
- `apps/web/dist/index.html` 存在
- `runtime/logs`
- `runtime/uploads`
- `runtime/reports`
- `runtime/discussions/sessions`

## 2. 启动验证

运行：

```powershell
.\scripts\windows\start.ps1
```

预期结果：

- `http://localhost:<port>` 可打开
- `ws://localhost:<port>` 可连接
- `runtime/logs/server.out.log` 与 `runtime/logs/server.err.log` 生成
- `/health` 返回 200

## 3. Claude / Codex 基础冒烟

### Claude 会话

1. 打开页面
2. 选择 `Claude`
3. 新建会话并发送一条消息

检查点：

- 会话创建成功
- 返回内容正常
- 当前会话 provider 固定为 `Claude`
- 历史列表显示正确 provider

### Codex 会话

1. 切换到 `Codex`
2. 新建会话并发送一条消息

检查点：

- 会话创建成功
- 返回内容正常
- 当前会话 provider 固定为 `Codex`
- 切到历史记录时不会错误显示为 Claude

## 4. 刷新恢复

在 Claude 和 Codex 各做一次：

1. 发起一个较长任务
2. 在任务仍运行时刷新页面

检查点：

- 页面刷新后还能看到最近一条历史记录
- 正在运行的会话仍显示 `Running`
- 重新连上后能继续看到后续输出
- 任务完成后状态从 `Running` 切回完成态

## 5. 历史与 provider 对齐

检查点：

- 历史列表标题不再把 Codex 会话归到 Claude
- 点击某个 Codex 历史会话后，顶部 provider 按钮同步为 Codex
- Claude 与 Codex 会话互不串线

## 6. 设置面板

检查点：

- 设置菜单可以打开和关闭
- 手机端设置面板可以滚动
- Process 面板的显示项开关可点击
- 开关切换后能动态影响当前运行中的展示

## 7. 多智能体运行产物

如果测试讨论功能，检查运行产物写入：

- `runtime/discussions/sessions`
- `runtime/reports`

而不是仓库根目录。

## 8. 自动启动

安装：

```powershell
.\scripts\windows\install-autostart.ps1
```

卸载：

```powershell
.\scripts\windows\uninstall-autostart.ps1
```

检查点：

- 计划任务创建成功
- 计划任务删除成功
- `autostart.openBrowserOnLogin` 生效

## 9. 构建回归

```powershell
cd .\apps\server
npm run build

cd ..\web
npm run build
```

两边都必须通过，且不能再依赖旧的根目录 `cli/`、`chat-ui/`、`web/` 路径。
