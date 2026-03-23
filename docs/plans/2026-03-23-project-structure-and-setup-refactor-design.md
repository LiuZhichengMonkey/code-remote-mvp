# CodeRemote Project Structure And Setup Refactor Design

> Created: 2026-03-23
> Status: Approved

## 1. Goal

Refactor the repository so a new Windows user can:

1. `git clone` the repo
2. copy one local config file
3. run one setup script
4. run one start script

The result should be a working local environment for the existing CodeRemote stack, including:

- web UI
- backend server
- Claude provider support
- Codex provider support
- optional login-time auto-start

## 2. Scope

This refactor targets repository structure, startup flow, configuration, and documentation.

Included:

- repository directory cleanup
- unified Windows scripts
- unified local config file
- provider bootstrap from repository config into local Claude/Codex config
- login-time auto-start support
- documentation rewrite for new-user setup

Not included:

- Linux or macOS first-class startup support
- replacing local Claude/Codex CLIs with direct API-only execution
- migrating or rewriting historical Claude/Codex session storage formats
- broad backend protocol redesign

## 3. User-Facing Requirements

The refactor must satisfy these user-facing requirements:

- Windows is the primary supported environment.
- First-time setup uses a dedicated `setup.ps1`.
- Daily usage uses a dedicated `start.ps1`.
- External tools are checked but not auto-installed:
  - `claude`
  - `codex`
  - `ngrok`
- Auto-start is supported at user logon.
- Auto-start behavior can choose whether to open the browser automatically.
- Old scattered `.bat` entrypoints are removed instead of kept as legacy wrappers.

## 4. Current Problems

### 4.1 Entry points are scattered

The repository currently exposes multiple root-level scripts with overlapping responsibilities:

- `start.bat`
- `start-services.bat`
- `start-all.bat`
- `start-bg.bat`
- `start.ps1`
- `install-autostart.bat`
- `uninstall-autostart.bat`

This makes the correct user flow ambiguous.

### 4.2 Configuration is fragmented

Important runtime values are currently spread across:

- script constants
- provider-specific user home directories
- frontend state
- backend defaults

Users have to know too many places to inspect or edit.

### 4.3 Standard startup is too coupled to development tooling

Current flows still rely on separate frontend/dev-server concepts in places where a normal user only needs the built UI and the backend server.

### 4.4 Repository layout is noisy

The repo mixes:

- applications
- scripts
- runtime artifacts
- old static pages
- generated logs
- historical testing leftovers

at the repository root.

## 5. Recommended Approach

Adopt a repository-level structure cleanup plus a standardized Windows startup layer.

### 5.1 High-Level Strategy

- Move applications under `apps/`.
- Move supported Windows scripts under `scripts/windows/`.
- Centralize user-editable runtime settings under `config/`.
- Move runtime artifacts under `runtime/`.
- Keep the backend as the single standard runtime entrypoint.
- Serve the built web UI from the backend instead of treating Vite dev server as the default user flow.

## 6. Target Repository Structure

```text
code-remote-mvp/
├─ apps/
│  ├─ server/                 # current cli/
│  ├─ web/                    # current chat-ui/
│  └─ mobile/                 # current app/
├─ config/
│  ├─ coderemote.example.json
│  └─ coderemote.local.json   # gitignored
├─ scripts/
│  └─ windows/
│     ├─ setup.ps1
│     ├─ start.ps1
│     ├─ install-autostart.ps1
│     ├─ uninstall-autostart.ps1
│     └─ modules/
├─ docs/
│  ├─ plans/
│  ├─ setup/
│  └─ troubleshooting/
├─ tests/
│  ├─ integration/
│  ├─ e2e/
│  └─ fixtures/
├─ examples/
├─ runtime/
│  ├─ logs/
│  ├─ uploads/
│  ├─ reports/
│  └─ temp/
├─ README.md
├─ DEVELOPMENT.md
├─ TESTING.md
└─ .gitignore
```

### 6.1 Directory Mapping

- `cli/` -> `apps/server/`
- `chat-ui/` -> `apps/web/`
- `app/` -> `apps/mobile/`
- root startup scripts -> `scripts/windows/`
- root runtime outputs -> `runtime/`

### 6.2 Cleanup Targets

Remove or absorb old root-level script entrypoints and stale static/web leftovers that are no longer part of the supported path.

## 7. Unified Configuration Design

Two repository config files define the supported flow:

- `config/coderemote.example.json`
- `config/coderemote.local.json`

Users copy the example to the local file and edit only the local file.

### 7.1 Config Shape

```json
{
  "server": {
    "port": 8085,
    "token": "change-me",
    "workspaceRoot": "E:/your-workspace"
  },
  "ui": {
    "openBrowserOnStart": true
  },
  "tunnel": {
    "mode": "ngrok",
    "ngrokPath": "C:/path/to/ngrok.exe",
    "customPublicWsUrl": ""
  },
  "providers": {
    "claude": {
      "enabled": true,
      "cliCommand": "claude",
      "baseUrl": "",
      "authToken": "",
      "model": ""
    },
    "codex": {
      "enabled": true,
      "cliCommand": "codex",
      "baseUrl": "",
      "authToken": "",
      "model": ""
    }
  },
  "paths": {
    "logsDir": "./runtime/logs",
    "uploadsDir": "./runtime/uploads"
  },
  "autostart": {
    "taskName": "CodeRemote",
    "openBrowserOnLogin": false,
    "startMinimized": true
  }
}
```

### 7.2 Config Rules

- `coderemote.example.json` is committed.
- `coderemote.local.json` is local-only and gitignored.
- Repository scripts treat this config as the single source of truth for startup behavior.
- Setup can bootstrap provider config files from this repository config into user home directories.

## 8. Script Responsibilities

### 8.1 `scripts/windows/setup.ps1`

Responsibilities:

- check `node` and `npm`
- check external commands and configured executables:
  - `claude`
  - `codex`
  - `ngrok`
- verify `config/coderemote.local.json` exists
- create runtime directories
- install dependencies for:
  - `apps/server`
  - `apps/web`
- build:
  - `apps/server`
  - `apps/web`
- write configured provider values into:
  - `~/.claude/settings.json`
  - `~/.codex/config.toml`
  - `~/.codex/auth.json`
- print a summary of detected tools, outputs, and connection URLs

This script is for first-time setup and rebuilds, not long-running service startup.

### 8.2 `scripts/windows/start.ps1`

Responsibilities:

- load repository local config
- verify setup outputs exist
- clear or refuse conflicting ports
- launch the backend server as the single standard runtime process
- pass resolved port, token, workspace, and static path
- ensure the backend serves the built web UI
- write logs to `runtime/logs`
- optionally open the browser

Supported modes:

- normal manual start
- `-Autostart` mode for scheduled-task execution

### 8.3 `scripts/windows/install-autostart.ps1`

Responsibilities:

- verify local config and successful setup artifacts
- create a per-user Windows scheduled task
- trigger at logon
- invoke `powershell.exe` with `start.ps1 -Autostart`
- respect config-driven auto-open behavior

### 8.4 `scripts/windows/uninstall-autostart.ps1`

Responsibilities:

- remove the scheduled task created by install
- leave other runtime state untouched

## 9. Runtime Design

### 9.1 Standard Runtime Flow

The backend becomes the only supported user runtime entrypoint.

- `apps/server` starts the HTTP + WebSocket server
- `apps/server` serves `apps/web/dist`
- users connect through one port and one base URL

Vite dev server remains a developer-only tool, not a standard setup requirement.

### 9.2 Runtime Artifacts

Runtime outputs move under `runtime/`:

- `runtime/logs`
- `runtime/uploads`
- `runtime/reports`
- `runtime/temp`

These paths should be passed in or resolved centrally rather than hard-coded inside scripts.

## 10. Provider Bootstrap

The repository config supplies initial runtime profile values for local provider CLIs.

### 10.1 Claude Bootstrap

`setup.ps1` writes configured values into `~/.claude/settings.json`, including:

- base URL
- auth token
- model
- permissive mode defaults already required by this project

### 10.2 Codex Bootstrap

`setup.ps1` writes configured values into:

- `~/.codex/config.toml`
- `~/.codex/auth.json`

including:

- base URL
- auth token
- model

### 10.3 Compatibility Rule

This refactor does not migrate or delete existing provider session histories. It only standardizes bootstrap and startup around current provider homes and storage.

## 11. Auto-Start Design

Auto-start targets user logon, not system-service boot.

### 11.1 Behavior

- implemented with Windows scheduled tasks
- created in the current user context
- no service-manager conversion
- browser-open behavior is configurable

### 11.2 Browser Rules

- manual start uses `ui.openBrowserOnStart`
- scheduled-task start uses `autostart.openBrowserOnLogin`

## 12. Documentation Plan

### 12.1 `README.md`

Rewrite for new users:

- what the project is
- prerequisites
- quick start
- config copy/edit flow
- setup/start commands
- auto-start commands
- common failure cases

### 12.2 `DEVELOPMENT.md`

Rewrite for contributors:

- new directory structure
- server/web relationship
- provider bootstrap model
- developer-only frontend/backend workflows
- runtime log locations

### 12.3 `TESTING.md`

Rewrite as an execution checklist for:

- first-time setup
- normal startup
- Claude and Codex session verification
- logon auto-start verification

## 13. Migration Strategy

### 13.1 Phase Order

1. add the unified config layer
2. add new Windows scripts
3. remove hard-coded path assumptions in the backend
4. move application directories under `apps/`
5. rewrite docs
6. remove old root-level startup scripts and obsolete leftovers
7. verify the new clone-to-start path end-to-end

### 13.2 Data Compatibility

Preserve:

- existing provider home config locations
- existing provider session history
- current Claude/Codex session features

This is a repository and startup-layer refactor, not a session-storage migration.

## 14. Risks And Mitigations

### 14.1 Static path breakage

Risk:

- moving directories breaks backend static-file assumptions

Mitigation:

- resolve static paths from configuration or startup parameters instead of relative assumptions

### 14.2 Startup working-directory drift

Risk:

- scheduled-task execution and manual execution may run from different working directories

Mitigation:

- all scripts resolve the repository root explicitly and use absolute paths

### 14.3 Missing build outputs

Risk:

- users run start before setup or after partial cleanup

Mitigation:

- `start.ps1` performs explicit build-artifact checks and fails with a clear message

### 14.4 Documentation drift

Risk:

- docs keep pointing to old scripts or old directories

Mitigation:

- rewrite core docs in the same refactor and verify commands against the new structure

## 15. Acceptance Criteria

- A new Windows user can clone the repository and get started by:
  - copying one config file
  - editing a small set of values
  - running `setup.ps1`
  - running `start.ps1`
- The backend serves the built web UI directly.
- Claude and Codex remain available through the existing app flow.
- External dependency checks are clear and actionable.
- Auto-start at user logon can be installed and removed through dedicated scripts.
- Old multi-entry startup scripts are removed.
- Runtime files are moved out of the repository root into `runtime/`.
- Top-level documentation matches the supported path.
