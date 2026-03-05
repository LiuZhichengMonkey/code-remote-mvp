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

### Tested Platforms
- **iOS Safari**: WebSocket works with WSS (secure WebSocket)
- **Android Chrome**: Should work (not explicitly tested yet)
- **Windows/macOS Browser**: Works

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
```

### File Structure

```
code-remote-mvp/
├── cli/                    # Node.js CLI server
│   ├── src/
│   │   ├── index.ts        # Entry point
│   │   ├── server.ts        # WebSocket server
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
└── web/                    # Web test interfaces
    ├── index.html          # Main web UI
    ├── cr.html             # Compact web UI
    ├── mobile.html         # Mobile-optimized UI
    ├── cr-debug.html       # Debug tool
    └── mobile-debug.html   # Mobile debug tool
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

## Future Improvements

1. **Auto-reconnect**: Handle connection drops gracefully
2. **Multi-client support**: Multiple phones connected simultaneously
3. **Claude Code Integration**: Actually execute Claude Code commands
4. **File Transfer**: Send/receive files
5. **Push Notifications**: Alert when server has new messages
6. **Voice Input**: Speech-to-text on mobile

---

## License

MIT License
