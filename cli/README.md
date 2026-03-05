# CodeRemote CLI

The server-side component for CodeRemote - runs a WebSocket server that the mobile app connects to.

## Installation

```bash
cd cli
npm install
npm run build
```

## Usage

```bash
# Start server (default: port 8080)
npm start

# Custom port
npm start -- --port 3000

# With tunneling
npm start -- --tunnel cloudflare

# Custom token
npm start -- --token my-secret-token
```

## Commands

### `start`
Start the WebSocket server.

Options:
- `-p, --port <number>` - Port to listen on (default: 8080)
- `-t, --token <token>` - Custom auth token
- `--tunnel <type>` - Enable tunnel (cloudflare, ngrok, frp)
- `--host <host>` - Custom tunnel host URL
- `--no-tunnel` - Disable tunneling
- `-v, --verbose` - Verbose output

### `token`
Generate a new auth token.

```bash
code-remote token
code-remote token --length 16
```

### `test`
Test the WebSocket connection.

```bash
code-remote test
code-remote test --url ws://localhost:8080 --token my-token
```

## Architecture

```
┌─────────────────────────────────────────┐
│           CodeRemote CLI               │
├─────────────────────────────────────────┤
│  index.ts  - Main entry point          │
│  server.ts - WebSocket server           │
│  handler.ts - Message handler           │
│  auth.ts   - Authentication             │
│  tunnel.ts - Tunnel management          │
│  qrcode.ts - QR code generation         │
└─────────────────────────────────────────┘
```

## Message Protocol

### Client → Server
```json
{
  "type": "auth",
  "token": "your-token-here"
}
```

```json
{
  "type": "message",
  "content": "Hello, CodeRemote!",
  "timestamp": 1234567890
}
```

### Server → Client
```json
{
  "type": "auth_success",
  "clientId": "uuid-here",
  "timestamp": 1234567890
}
```

```json
{
  "type": "message",
  "content": "Response from server",
  "timestamp": 1234567890
}
```

```json
{
  "type": "error",
  "content": "Error message",
  "timestamp": 1234567890
}
```

## Development

```bash
# Watch mode with tsx
npm run dev

# Build
npm run build

# Run tests (if added)
npm test
```

## Security Considerations

1. **Tokens**: Use strong tokens (default UUID v4)
2. **WSS**: Use secure WebSocket (wss://) for remote connections
3. **Rate Limiting**: Consider adding rate limiting for production
4. **CORS**: Configure CORS if needed for web clients

## Troubleshooting

### Port already in use
```bash
# macOS/Linux
lsof -ti:8080 | xargs kill

# Windows
netstat -ano | findstr :8080
taskkill /PID <PID> /F
```

### Tunnel not working
- Verify cloudflared is installed: `cloudflared --version`
- Check internet connectivity
- Try alternative tunnel provider

### Connection refused
- Check firewall settings
- Verify port is not blocked
- Ensure server is running
