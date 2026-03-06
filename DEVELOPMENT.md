# CodeRemote Development Guide

> Technical documentation for agents and developers extending CodeRemote functionality

## Current Status (2025-03-06)

### Working Features
- ✅ Local WiFi WebSocket connection (ws://192.168.x.x:port)
- ✅ External network access via ngrok tunnel
- ✅ iOS Safari WebSocket support
- ✅ Token-based authentication
- ✅ Debug web interface for testing
- ✅ Simple message echo handler
- ✅ Image transfer (bidirectional, up to 10MB, PNG/JPG/GIF/WebP)
- ✅ Image saved to E:/CodeRemote/Images/ on server

### Tested Platforms
- **iOS Safari**: WebSocket works with WSS (secure WebSocket)
- **Android Chrome**: Should work (not explicitly tested yet)
- **Windows/macOS Browser**: Works

---

## CodeRemote vs Happy Comparison

Happy (https://github.com/slopus/happy) is a production-ready mobile client for Claude Code & Codex. This section compares CodeRemote MVP with Happy.

### Project Positioning

| Aspect | CodeRemote | Happy |
|--------|-----------|-------|
| **定位** | MVP 原型验证 | 完整生产级产品 |
| **成熟度** | 实验阶段 | 已发布 App Store/Google Play |
| **代码量** | ~3000 行 | ~50000+ 行 |
| **CLI 集成** | 独立 WebSocket 服务器 | 完整包装器，直接替换 claude/codex |
| **App 框架** | Flutter (未完成) | Expo + React Native |
| **后端服务器** | 无 (直连) | 独立服务器 (加密同步) |
| **隧道方案** | 手动 ngrok | 自动内嵌 |

### Feature Comparison

| 功能 | CodeRemote | Happy | Status |
|------|------------|-------|--------|
| 文本消息 | ✅ | ✅ | 两者都有 |
| Token 认证 | ✅ | ✅ E2E 加密 | Happy 更强 |
| 外网访问 | ⚠️ 手动 ngrok | ✅ 自动 | 需改进 |
| **图片传输** | ✅ WebSocket 二进制帧 | ❌ | CodeRemote 领先 |
| 推送通知 | ❌ | ✅ | 需添加 |
| Claude Code 集成 | ❌ | ✅ 完整 | 核心差距 |
| 多会话支持 | ❌ | ✅ | 需添加 |
| 文件传输 | ❌ | ❌ | 两者都没有 |
| 代码高亮 | ❌ | ✅ | 需添加 |
| QR 码扫描 | ⚠️ 基础 | ✅ | 需完善 |
| 端到端加密 | ❌ | ✅ Signal Protocol | 安全差距 |

### Key Differences

**Happy's Advantages:**
1. **Deep Claude Code Integration** - 直接替换 `claude` 或 `codex` 命令
2. **End-to-End Encryption** - 使用 Signal Protocol
3. **Push Notifications** - iOS/Android 原生推送
4. **Automatic Tunnel** - 内置无需手动配置
5. **Session Management** - 本地/远程无缝切换
6. **Production Ready** - App Store/Play Store 上架

**CodeRemote's Advantages:**
1. **Simplicity** - 易于理解和修改
2. **Web Interface** - 可直接在浏览器测试
3. **Open Source** - 完全透明
4. **Lightweight** - 无需复杂依赖
5. **Debug Tools** - cr-debug.html 诊断工具

### Image Transfer Support

**Current Status: Neither CodeRemote nor Happy supports image transfer.**

To implement image transfer, you would need:

1. **WebSocket Binary Support**
   ```typescript
   // Server side
   ws.on('message', (data, isBinary) => {
     if (isBinary) {
       // Handle binary data
     }
   });
   ```

2. **Base64 Encoding** (Simple approach)
   ```typescript
   {
     type: 'image',
     content: 'base64_encoded_image_data',
     mimeType: 'image/png',
     fileName: 'screenshot.png',
     size: 12345
   }
   ```

3. **Chunked Transfer** (For large images)
   ```typescript
   {
     type: 'image_chunk',
     chunkId: 'uuid',
     chunkIndex: 0,
     totalChunks: 10,
     data: '...'
   }
   ```

---

## Roadmap & Improvements (Priority)

### P0 - Critical (Must Have)
1. ~~**Image Transfer Support**~~ - ✅ 已实现 (WebSocket 二进制帧)
2. **Automated Tunnel** - 当前手动 ngrok 不够友好
3. **Claude Code Integration** - 核心价值，直接执行 AI 命令

### P1 - Important (Should Have)
4. **End-to-End Encryption** - 安全考虑
5. **Push Notifications** - 主动通知
6. **QR Code Scanning** - 完善 Flutter App

### P2 - Enhancement (Nice to Have)
7. **File Transfer** - 除图片外的文件传输
8. **Code Syntax Highlighting** - 代码可读性
9. **Multi-Session Support** - 多设备同时连接
10. **Session Persistence** - 断线重连恢复

---

## External Network Access (4G/5G)

### Solution: ngrok

Due to Windows root certificate issues with Cloudflare Tunnel, **ngrok** is the recommended solution for external access.

#### Setup Steps

1. **Install ngrok**:
   ```bash
   winget install --id Ngrok.Ngrok --source winget
   ```

2. **Register ngrok account** (free):
   - Visit https://dashboard.ngrok.com/signup
   - Get your authtoken from dashboard

3. **Configure authtoken**:
   ```bash
   ngrok config add-authtoken YOUR_AUTHTOKEN
   ```

4. **Update ngrok** (if version is too old):
   ```bash
   ngrok update
   ```

5. **Start tunnel to WebSocket server** (port 8085):
   ```bash
   ngrok http 8085
   ```

6. **Get public URL**:
   ```bash
   curl -s http://127.0.0.1:4040/api/tunnels
   ```

#### WebSocket over ngrok

- ngrok HTTP tunnel: `https://xxx.ngrok-free.dev`
- WebSocket URL: `wss://xxx.ngrok-free.dev` (replace http with ws, https with wss)

---

## iOS Safari WebSocket Compatibility

### Key Findings

1. **WebSocket API Support**: iOS Safari fully supports WebSocket API
2. **WSS (Secure) Required**: iOS Safari requires WSS for external connections
3. **HTTPS Page + WS**: Pages served over HTTPS cannot connect to non-secure WS
4. **Local Network Access**: Works with both HTTP and WS on local network

### Debug Tools

Use `cr-debug.html` to diagnose iOS connection issues:

```bash
# Access debug page (local network)
http://192.168.5.23:8084/cr-debug.html
```

The debug page shows:
- Device detection (iOS, platform, network type)
- WebSocket API support status
- Real-time readyState values
- Detailed event logging

### Common iOS Errors

| Error | Meaning | Solution |
|-------|---------|----------|
| `readyState: 3 (CLOSED)` | Connection failed | Check URL and token |
| `code: 1006` | Abnormal closure | Server not responding or wrong URL |
| `Upgrade Required` | HTTP instead of WebSocket | Use ws:// or wss:// protocol |

---

## Architecture

### Ports

| Port | Service | Description |
|------|---------|-------------|
| 8084 | HTTP | Web interface (HTML files) |
| 8085 | WebSocket | CLI server (ws://) |
| 4040 | ngrok API | Tunnel management |

### WebSocket Protocol

```typescript
// Authentication
{ type: 'auth', token: 'xxx-xxx-xxx' }

// Server response - success
{ type: 'auth_success', clientId: 'xxx' }

// Server response - failed
{ type: 'auth_failed', error: 'Invalid token' }

// Message
{ type: 'message', content: 'hello' }

// Image upload - Step 1: send metadata (JSON)
{ type: 'image_meta', fileName: 'photo.png', mimeType: 'image/png', size: 12345, timestamp: 1234567890 }

// Image upload - Step 2: send binary data (ArrayBuffer/Buffer)
// ws.send(arrayBuffer)  <-- raw binary, no JSON wrapper

// Image saved confirmation (server → client)
{ type: 'image_saved', path: 'E:/CodeRemote/Images/image_20250306_123456.png', timestamp: 1234567890 }

// Image error (server → client)
{ type: 'image_error', error: '图片过大', code: 'TOO_LARGE', timestamp: 1234567890 }
```

### Image Transfer Architecture

```
Client                          Server
  |                               |
  |-- JSON: {type:'image_meta'} ->|  (1) Send metadata
  |                               |     fileName, mimeType, size
  |-- Binary: ArrayBuffer ------->|  (2) Send binary image data
  |                               |
  |<- JSON: {type:'image_saved'} -|  (3) Confirmation with path
  |   OR                          |
  |<- JSON: {type:'image_error'} -|  (3) Error details
```

**Image Constraints:**
- Max size: 10MB
- Allowed types: PNG, JPEG, GIF, WebP
- Save path: `E:/CodeRemote/Images/`
- Filename format: `image_YYYYMMDD_HHMMSS.ext`

### File Structure

```
code-remote-mvp/
├── cli/                    # Node.js CLI server
│   ├── src/
│   │   ├── index.ts        # Entry point + exports
│   │   ├── server.ts       # WebSocket server (image transfer)
│   │   ├── imageHandler.ts # Image validation & saving
│   │   ├── types/
│   │   │   └── image.ts    # Image type definitions
│   │   ├── handler.ts      # Message handling
│   │   ├── tunnel.ts       # Tunnel management
│   │   └── qrcode.ts      # QR code generation
│   └── dist/               # Compiled JS
│
├── app/                    # Flutter mobile app
│   └── lib/
│       ├── services/       # WebSocket service
│       ├── screens/        # UI screens
│       └── widgets/        # Reusable widgets
│
├── web/                    # Web test interfaces
│   ├── index.html          # Main web UI
│   ├── cr.html             # Compact web UI
│   ├── mobile.html         # Mobile-optimized UI
│   ├── cr-debug.html       # Debug tool
│   └── mobile-debug.html   # Mobile debug tool
│
├── start.bat               # Windows startup script
└── start.ps1               # PowerShell startup script
```

---

## Extending Functionality

### Adding New Commands

1. Edit `cli/src/handler.ts`
2. Add command handler in `handleMessage()` function
3. Rebuild: `npm run build`

Example:
```typescript
// In handler.ts
case 'command':
  const result = await executeCommand(data.content);
  ws.send(JSON.stringify({ type: 'message', content: result }));
  break;
```

### Adding Web Interface Features

1. Edit files in `web/` directory
2. WebSocket client connects to `ws://192.168.x.x:8085` locally or `wss://xxx.ngrok-free.dev` externally

### Mobile App Development

1. Navigate to `app/` directory
2. Run `flutter pub get`
3. Edit Dart files in `lib/`
4. Test with `flutter run`

---

## Troubleshooting

### Server won't start
```bash
# Check if port is in use
netstat -ano | grep 8085

# Kill process
taskkill //F //PID <PID>
```

### ngrok tunnel not working
```bash
# Check ngrok dashboard
curl -s http://127.0.0.1:4040/api/tunnels

# Restart tunnel
taskkill //F //IM ngrok.exe
ngrok http 8085
```

### iOS connection fails
1. Use debug page to check error details
2. Ensure using WSS (not WS) for external
3. Verify token matches server
4. Check if server is running

---

## License

MIT License
