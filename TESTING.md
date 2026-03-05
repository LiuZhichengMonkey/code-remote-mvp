# Testing Guide

This guide covers how to test the CodeRemote MVP.

## Test Environment

You'll need:
1. A computer for running the CLI
2. A mobile device or emulator for the app
3. Both devices on the same network (for local testing)

## Test Scenarios

### 1. Local Network Testing

#### Step 1: Start the CLI
```bash
cd cli
npm install
npm run build
npm start
```

Expected output:
- Server started message
- Port number (default: 8080)
- Token (random UUID)
- QR code displayed
- Connection instructions

#### Step 2: Find Your Computer's IP

**macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Windows:**
```bash
ipconfig
```
Look for "IPv4 Address" (e.g., 192.168.1.100)

#### Step 3: Run the Mobile App

```bash
cd app
flutter pub get
flutter run
```

#### Step 4: Connect
1. Tap the link icon (🔗) in the app
2. Enter: `ws://YOUR_IP:8080` (e.g., `ws://192.168.1.100:8080`)
3. Enter the token from CLI output
4. Tap Connect

Expected: Green status indicator, "Connected!" message

#### Step 5: Send Message
1. Type "Hello" in the input field
2. Tap Send

Expected: Message appears in app, CLI logs the message

---

### 2. Remote Testing (with Tunnel)

#### Step 1: Install Cloudflare Tunnel

**macOS:**
```bash
brew install cloudflared
```

**Windows:**
```bash
winget install --id Cloudflare.cloudflared
```

**Linux:**
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
```

#### Step 2: Start CLI with Tunnel
```bash
npm start
```

Expected: Tunnel URL displayed (e.g., `https://abc123.trycloudflare.com`)

#### Step 3: Connect from Anywhere
1. Open the mobile app
2. Enter: `wss://abc123.trycloudflare.com`
3. Enter the token
4. Tap Connect

#### Step 4: Test Across Networks
- Connect to WiFi, then switch to mobile data
- Connection should remain active

---

### 3. Test Cases

| Test | Expected Result |
|------|----------------|
| **CLI starts** | Server starts, displays info, no errors |
| **Invalid token** | "Authentication failed" error |
| **Invalid URL** | Connection error message |
| **Disconnect** | Status changes to disconnected |
| **Reconnect** | Can reconnect with same credentials |
| **Multiple messages** | All messages sent/received |
| **Long message** | Message handled correctly |
| **Special characters** | Characters preserved |
| **Empty message** | Not sent (validation) |
| **Server restart** | Client disconnects, can reconnect |

---

### 4. Performance Tests

| Metric | Expected |
|--------|----------|
| Connection time | < 5 seconds (local) |
| Message latency | < 100ms (local) |
| App startup | < 3 seconds |
| Memory usage | Stable, no leaks |

---

### 5. Cross-Platform Testing

#### Android
- [ ] Emulator (various API levels)
- [ ] Physical device
- [ ] Different screen sizes
- [ ] Dark mode

#### iOS (if available)
- [ ] Simulator
- [ ] Physical device
- [ ] Dark mode

#### Web (optional)
- [ ] Chrome
- [ ] Safari
- [ ] Firefox

---

### 6. Network Conditions

| Condition | Expected |
|-----------|----------|
| Strong WiFi | Smooth operation |
| Weak WiFi | May see delays |
| 4G/5G | Should work (with tunnel) |
| No internet | Only local connections |

---

### 7. Error Handling Tests

1. **CLI stopped while connected**
   - App shows "Connection lost"
   - Can reconnect when CLI starts

2. **Network change**
   - App detects disconnect
   - Manual reconnect required

3. **Token changed**
   - Old connections rejected
   - New connections work with new token

---

### 8. Troubleshooting Common Issues

#### "Connection refused"
- CLI is not running
- Wrong port number
- Firewall blocking connection

#### "Authentication failed"
- Wrong token
- Token has spaces (trim needed)

#### "Socket error"
- Network issue
- Tunnel not active

#### App crashes
- Check `flutter logs`
- Try clearing app data
- Report bug with logs

---

### 9. Test Checklist

Before declaring MVP ready:

- [ ] CLI starts without errors
- [ ] QR code displays correctly
- [ ] App connects to local CLI
- [ ] App connects via tunnel
- [ ] Messages sent from app appear in CLI
- [ ] Messages from CLI appear in app
- [ ] Disconnect works properly
- [ ] Reconnect works properly
- [ ] Invalid token rejected
- [ ] Invalid URL shows error
- [ ] UI is responsive
- [ ] No memory leaks
- [ ] Credentials saved correctly

---

### 10. Acceptance Criteria

The MVP is considered successful when:

1. **CLI starts reliably** - Every time, under 5 seconds
2. **Connection works** - App can connect to CLI
3. **Messages work** - Bidirectional communication successful
4. **Tunneling works** - Can connect from anywhere
5. **Basic UX** - Intuitive enough for testing

---

## Reporting Issues

When reporting issues, include:
1. Device info (make, model, OS version)
2. CLI version (`code-remote --version`)
3. Exact error messages
4. Steps to reproduce
5. Expected vs actual behavior
