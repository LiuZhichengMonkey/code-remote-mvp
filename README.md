# CodeRemote

A unified Web UI for connecting to local AI coding assistants (`claude` and `codex`) remotely via browser or mobile app.

## Features

- **Dual Provider Support** — Connect to Claude Code and Codex CLI tools from a single interface
- **WebSocket Communication** — Real-time bidirectional messaging between UI and server
- **Session Management** — Create, resume, list, and delete chat sessions organized by project
- **Remote Access** — Tunnel support via ngrok or custom WebSocket URLs for out-of-network access
- **Multi-Agent Discussions** — Orchestrate debates and collaborations between multiple AI agents
- **File Browser** — Browse and preview workspace files with access control
- **Local HTTP Proxy** — Proxy and rewrite local resources with header/URL rewriting
- **Skill Discovery** — Detect and list available skills from connected providers
- **i18n** — Chinese and English interface
- **Mobile App** — Flutter-based mobile client with QR code quick-connect

## Architecture

```
apps/
├── server/     Node.js/TypeScript backend (WebSocket server, CLI wrappers)
├── web/        React 19 web UI (TailwindCSS, Vite)
└── mobile/     Flutter mobile app

config/         Configuration files
scripts/windows/ PowerShell automation scripts (setup, start, autostart)
runtime/        Logs, uploads, reports, and discussion artifacts
docs/plans/      Design documents for features
```

## Prerequisites

- Node.js 18+
- [claude](https://docs.anthropic.com/en/docs/claude-code) CLI, locally configured
- [codex](https://github.com/openai/codex) CLI, locally configured
- [ngrok](https://ngrok.com/) (only if `tunnel.mode = "ngrok"` in config)

## Quick Start

### 1. Clone and configure

```powershell
git clone <repo-url>
Copy-Item .\config\coderemote.example.json .\config\coderemote.local.json
```

Edit `config/coderemote.local.json` and verify at minimum:

- `server.port` — server port (default: `8085`)
- `server.token` — access token
- `server.workspaceRoot` — workspace root directory
- `tunnel.mode` — `"disabled"`, `"ngrok"`, or `"custom"`
- `providers.claude.cliCommand` — your claude CLI command
- `providers.codex.cliCommand` — your codex CLI command

> [!TIP]
> To use an existing public tunnel, set `tunnel.mode = "custom"` and `tunnel.customPublicWsUrl` to your WebSocket URL.

### 2. Install dependencies

```powershell
.\scripts\windows\setup.ps1
```

This script checks dependencies, installs `apps/server` and `apps/web` packages, builds both apps, initializes the runtime directory, and writes provider configuration.

### 3. Start the server

```powershell
.\scripts\windows\start.ps1
```

By default:
- Web UI: `http://localhost:8085`
- WebSocket: `ws://localhost:8085`

If you encounter localhost resolution issues, use `127.0.0.1` instead.

For foreground (log output) mode:

```powershell
.\scripts\windows\start.ps1 -Foreground
```

### 4. Connect

**Local connection:**
- URL: `ws://127.0.0.1:8085`
- Token: `test123` (from default config)

**Remote connection** (when tunnel is active):
- URL: your ngrok or custom public WebSocket URL
- Token: `test123`

**Mobile app:** Scan the QR code displayed by the server, or enter URL + token manually.

## Autostart

Install login autostart:

```powershell
.\scripts\windows\install-autostart.ps1
```

Uninstall:

```powershell
.\scripts\windows\uninstall-autostart.ps1
```

Control whether a browser opens on login with `autostart.openBrowserOnLogin` in the config.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for development setup and [TESTING.md](TESTING.md) for manual testing checklists.

## Examples

See [examples/README.md](examples/README.md) for integration examples including WebSocket clients, multi-agent setups, and frontend integrations.
