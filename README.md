# CodeRemote MVP

> Control Claude Code from your phone - Minimal Viable Product

## Overview

CodeRemote MVP validates the concept of controlling a Claude Code CLI from a mobile device through tunneling. This proof-of-concept demonstrates bidirectional communication between a Node.js CLI server and a Flutter mobile app.

## Features

### CLI Tool
- WebSocket server with secure token authentication
- QR code generation for easy mobile connection
- Cloudflare Tunnel integration for remote access
- Support for multiple tunnel providers (ngrok, frp, custom)
- Interactive command-line interface

### Mobile App (Flutter)
- Simple chat interface for CLI communication
- Secure WebSocket connection
- Connection status indicators
- Auto-save connection credentials
- Material Design 3 UI with dark mode

## Quick Start

### Prerequisites

- Node.js 18+ (for CLI)
- Flutter 3.0+ (for mobile app)
- cloudflared (optional, for remote access)

### CLI Setup

1. Navigate to the CLI directory:
```bash
cd code-remote-mvp/cli
```

2. Install dependencies:
```bash
npm install
```

3. Build the CLI:
```bash
npm run build
```

4. Start the server:
```bash
npm start
```

The CLI will display:
- The server URL (e.g., `ws://localhost:8080`)
- The authentication token
- A QR code for quick connection
- Instructions for setting up tunneling

### Mobile App Setup

1. Navigate to the app directory:
```bash
cd code-remote-mvp/app
```

2. Install dependencies:
```bash
flutter pub get
```

3. Run the app:
```bash
# Android
flutter run

# iOS Simulator (macOS only)
flutter run -d ios

# Web (for testing)
flutter run -d chrome
```

4. Connect to the CLI:
   - Tap the link icon in the app
   - Enter the server URL and token from the CLI
   - Or scan the QR code (coming soon)

## Debug Log

### 2026-03-11 - Agent 系统 & 体验优化

**新功能**:
1. **Agent 系统**: 支持 @ 语法动态加载专家 agent，每个 agent 可有自己的记忆、skill 和配置
2. **流式 thinking 显示**: 即使只有 thinking 内容没有普通文本，也会实时显示

**修复**:
1. **移除心跳机制**: 解决 Cloudflare 10000 次请求限制问题（ping/pong 每 30 秒一次，长时间运行会超限）
2. **过滤上下文压缩摘要**: 不再显示 "This session is being continued from a previous conversation..." 系统消息
3. **Markdown 换行优化**: 减少段落之间的间距（从 12px 改为 4px，移除 white-space: pre-wrap）

**Files Changed**:
- `cli/src/agent/` - 新增 Agent 系统（parser, config, context, types, index）
- `cli/src/server.ts` - 移除 ping/pong 心跳机制
- `cli/src/claude/storage.ts` - 过滤 isCompactSummary 和 isVisibleInTranscriptOnly 消息
- `cli/src/handlers/claude.ts` - 支持 agent system prompt
- `cli/src/claude/engine.ts` - 支持 agent system prompt 注入
- `chat-ui/src/App.tsx` - 流式消息过滤逻辑优化
- `chat-ui/src/index.css` - Markdown 样式调整

---

### 2026-03-09 - Feature: 处理中状态提示

**新功能**: 发送消息后显示"Claude 正在处理..."的加载提示

**原因**: 用户反馈发送消息后没有反馈提示，不知道 Claude 是否还在工作中

**实现**:
- 在消息列表底部添加加载提示组件
- 使用 Loader2 旋转动画 + Sparkles 闪烁图标
- 渐变背景 (accent → purple)
- 使用 Framer Motion 添加入场/退场动画

**Files Changed**:
- `chat-ui/src/App.tsx` - 添加 Loader2、Sparkles 图标导入，添加加载提示组件

---

### 2026-03-09 - Feature: 429 Rate Limit 自动重试

**新功能**: 遇到 Rate Limit (429) 错误时自动重试

**实现**:
- 最大重试次数: 3 次
- 重试策略: 指数退避（2s → 4s → 8s）
- 重试时会向前端发送状态通知

**Files Changed**:
- `cli/src/claude/engine.ts` - 添加 maxRetries、baseRetryDelay 属性和自动重试逻辑

---

### 2026-03-09 - Bugfix: 过滤 tool_result 类型的用户消息

**问题**: 打开历史会话时，工具调用结果（如 "Task #1 created successfully"）显示在用户的气泡上

**原因**: `tool_result` 类型的消息在会话文件中 `type` 为 `"user"`，但内容是工具调用的结果，不是用户真正输入的内容

**解决方案**: 在 `storage.ts` 中添加过滤逻辑，检查 `content` 数组中是否包含 `type: 'tool_result'` 的块，如果是则跳过

**Files Changed**:
- `cli/src/claude/storage.ts` - 添加 tool_result 过滤逻辑

---

### 2026-03-09 - 消息分页加载功能

**新功能**:
1. **消息分页**: 打开历史会话时默认只加载最后 20 条消息，滚动到顶部自动加载更多
2. **加载更多 UI**: 顶部显示"Load earlier messages"按钮，显示剩余消息数量

**优化**:
- Thinking 只在实时流式生成时显示，历史记录中不显示
- 过滤只包含 `<thinking>` 标签的消息，避免空白气泡

**Files Changed**:
- `cli/src/claude/storage.ts` - 添加 `loadPaginated()` 分页加载方法
- `cli/src/claude/session.ts` - 添加 `resumePaginated()` 方法
- `cli/src/handlers/claude.ts` - 添加 `load_more` action，修改 `resume` 支持分页
- `cli/src/server.ts` - 添加 `limit` 和 `beforeIndex` 字段
- `chat-ui/src/App.tsx` - 分页状态、加载更多函数、消息过滤

---

### 2026-03-09 - UI 优化和会话标题编辑功能

**新功能**:
1. **会话标题编辑**: 点击顶部标题可直接编辑，修改后自动保存到会话文件
2. **工具调用显示优化**: 使用 Claude CLI 风格显示工具调用，如 `Read(file.txt)` 而不是完整路径
3. **429 错误重试**: 遇到 Rate Limit 错误时显示重试按钮

**优化**:
- Thinking 区域只在实时生成时显示，已保存的会话不显示
- 过滤掉只有 thinking 内容的空白消息气泡

**Files Changed**:
- `chat-ui/src/App.tsx` - 工具调用格式化、thinking 显示逻辑、重试按钮、标题编辑
- `chat-ui/src/types.ts` - 添加 canRetry 和 retryContent 字段
- `cli/src/claude/storage.ts` - 添加 rename 和 renameSessionFromProject 方法
- `cli/src/claude/session.ts` - 添加 rename 方法
- `cli/src/handlers/claude.ts` - 添加 rename action 处理
- `cli/src/server.ts` - 添加 title 字段支持

---

### 2026-03-08 - Session Not Saving Bug

**Issue**: Sessions created via CodeRemote were not persisting - closing and reopening the page would lose all conversation history.

**Root Cause**: In `cli/src/claude/storage.ts`, the code was looking for `entry.session_id` (underscore format) when parsing Claude CLI session files, but the actual field name is `sessionId` (camelCase).

**Solution**: Changed the field lookup from `entry.session_id` to `entry.sessionId`.

**Files Changed**:
- `cli/src/claude/storage.ts` - Fixed field name, added cwd parsing
- `cli/src/claude/engine.ts` - Added working directory handling for Claude CLI
- `cli/src/handlers/claude.ts` - Added project list, cross-project session handling

---

## Tunneling (Optional but Recommended)

To access your CLI from anywhere, set up a tunnel:

### Cloudflare Tunnel (Free & Recommended)

#### Installation
- **macOS**: `brew install cloudflared`
- **Linux**: Download from https://github.com/cloudflare/cloudflared/releases
- **Windows**: `winget install --id Cloudflare.cloudflared`

#### Usage
The CLI will automatically detect and use cloudflared when you run:
```bash
npm start
```

### ngrok

1. Download from https://ngrok.com/download
2. Run with tunneling enabled:
```bash
npm start -- --tunnel ngrok
```

## Project Structure

```
code-remote-mvp/
├── cli/                      # CLI Tool (Node.js/TypeScript)
│   ├── bin/
│   │   └── code-remote.js   # Executable entry point
│   ├── src/
│   │   ├── index.ts         # Main CLI entry
│   │   ├── server.ts        # WebSocket server
│   │   ├── handler.ts       # Message handler
│   │   ├── auth.ts          # Authentication
│   │   ├── tunnel.ts        # Tunnel management
│   │   └── qrcode.ts        # QR code generation
│   ├── package.json
│   └── tsconfig.json
│
├── app/                      # Mobile App (Flutter)
│   ├── lib/
│   │   ├── main.dart
│   │   ├── screens/
│   │   │   ├── chat_screen.dart
│   │   │   └── qr_scanner_screen.dart
│   │   ├── services/
│   │   │   └── websocket_service.dart
│   │   └── widgets/
│   │       ├── message_bubble.dart
│   │       ├── connection_dialog.dart
│   │       └── connection_status.dart
│   ├── android/
│   ├── ios/
│   └── pubspec.yaml
│
└── README.md
```

## CLI Commands

```bash
# Start the server
code-remote start

# Start on a custom port
code-remote start --port 3000

# Start with custom token
code-remote start --token my-secret-token

# Start with tunneling
code-remote start --tunnel cloudflare

# Start without tunneling (local only)
code-remote start --no-tunnel

# Generate a new token
code-remote token

# Test WebSocket connection
code-remote test --url ws://localhost:8080 --token my-token
```

## Development

### CLI Development

```bash
cd cli
npm run dev  # Run with tsx for hot reload
```

### Mobile App Development

```bash
cd app
flutter pub get
flutter run

# Hot reload enabled by default
# Press 'r' to hot reload, 'R' to hot restart
```

## Testing

### Local Network Testing

1. Start the CLI with local access only:
```bash
npm start -- --no-tunnel
```

2. Find your computer's local IP:
- macOS/Linux: `ifconfig` or `ip addr`
- Windows: `ipconfig`

3. Connect from mobile:
- URL: `ws://YOUR_COMPUTER_IP:8080`
- Token: Displayed in CLI output

### Remote Testing (with Tunnel)

1. Install cloudflared (see above)

2. Start the CLI:
```bash
npm start
```

3. The CLI will display a tunnel URL like `https://xxx.trycloudflare.com`

4. Connect from mobile anywhere:
- URL: `wss://xxx.trycloudflare.com`
- Token: Displayed in CLI output

## Security Notes

- This is an MVP for demonstration purposes
- Tokens are transmitted over WebSocket (use WSS for production)
- Consider rate limiting for production use
- Use HTTPS/WSS for all remote connections

## Known Limitations

- QR code scanning not yet implemented in app
- No file operations
- No voice input
- No slash commands
- Single session only

## Future Roadmap

After MVP validation:

1. **Claude Code Integration** - Connect to actual Claude Code CLI
2. **QR Code Scanning** - In-app scanner for quick connection
3. **File Operations** - Browse and edit remote files
4. **Slash Commands** - `/read`, `/edit`, `/run` commands
5. **Code Highlighting** - Syntax highlighting for code responses
6. **Multiple Sessions** - Support for multiple CLI connections
7. **Push Notifications** - Alert on new messages
8. **Voice Input** - Speech-to-text integration

## Troubleshooting

### CLI won't start
- Check if port 8080 is in use: `lsof -i:8080` (macOS/Linux)
- Use a different port: `code-remote start --port 3000`

### Mobile app won't connect
- Ensure CLI is running
- Check firewall settings
- For local network, ensure both devices are on same network
- For tunneling, verify tunnel is active

### Tunnel not working
- Ensure cloudflared is installed: `cloudflared --version`
- Check internet connection
- Try alternative tunnel (ngrok)

## License

MIT License - feel free to use this code for your projects!

## Contributing

This is an MVP project. Feel free to fork and improve!

---

**Note**: This MVP is a proof-of-concept. For production use, consider additional security measures, proper error handling, and a more robust architecture.
