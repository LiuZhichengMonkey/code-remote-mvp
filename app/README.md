# CodeRemote Mobile App

Flutter mobile app for controlling CodeRemote CLI from your phone.

## Setup

```bash
cd app
flutter pub get
```

## Running

```bash
# Android
flutter run

# iOS Simulator (macOS)
flutter run -d ios

# Web
flutter run -d chrome
```

## Build APK

```bash
flutter build apk --release
```

The APK will be at: `build/app/outputs/flutter-apk/app-release.apk`

## Features

- Simple chat interface
- Secure WebSocket connection
- Connection status indicator
- Auto-save credentials
- Material Design 3 UI
- Dark mode support
- Responsive design

## Architecture

```
lib/
├── main.dart                    # App entry point
├── screens/
│   ├── chat_screen.dart        # Main chat screen
│   └── qr_scanner_screen.dart  # QR scanner (coming soon)
└── services/
    └── websocket_service.dart  # WebSocket client
```

## Connection

1. Tap the link icon (🔗) in the app bar
2. Enter the server URL from your CLI
3. Enter the token from your CLI
4. Tap Connect

### Server URL Format

- **Local**: `ws://192.168.1.100:8080` (your computer's IP)
- **Tunnel**: `wss://xxx.trycloudflare.com`

## Permissions

The app requires:
- **Internet**: For WebSocket connections

### Android
Added in `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

### iOS
Added in `ios/Runner/Info.plist`:
```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```

## Development

```bash
# Hot reload enabled
flutter run

# Hot reload: press 'r'
# Hot restart: press 'R'
# Quit: press 'q'

# Analyze code
flutter analyze

# Format code
dart format .

# Run tests
flutter test
```

## Platform-Specific Notes

### Android
- Requires Android 5.0+ (API level 21+)
- No additional setup required

### iOS
- Requires iOS 13.0+
- May need to open `ios/Runner.xcworkspace` in Xcode first
- For physical devices, ensure signing is configured

### Web
- Works in modern browsers
- Some features may behave differently

## Troubleshooting

### Can't connect
- Verify CLI is running
- Check the URL format (ws:// or wss://)
- Ensure both devices are on the same network (for local connections)
- Check firewall settings

### Connection drops frequently
- Poor network connection
- Tunnel provider may have timeouts
- Try using a different network

### App crashes
- Check logs: `flutter logs`
- Try clearing app data
- Report issues with device and OS version

## Future Features

- QR code scanning
- Voice input
- File operations UI
- Code highlighting
- Multiple sessions
- Push notifications
