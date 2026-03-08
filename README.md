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
