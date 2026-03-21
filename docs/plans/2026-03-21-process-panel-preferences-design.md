# Process Panel Preferences Design

> Created: 2026-03-21
> Status: Implemented

## Goal

Add synced display preferences for the assistant process panel so users can choose which event categories are visible:

- status
- log
- tool

## Scope

- workspace-level preference
- synced through the existing backend websocket connection
- shared across devices connected to the same backend/workspace
- applies to both live messages and restored history

## Storage

Preferences are stored in:

`<workspace>/.coderemote/ui-preferences.json`

Current shape:

```json
{
  "processPanel": {
    "showStatus": true,
    "showLog": true,
    "showTool": true
  },
  "updatedAt": 1770000000000
}
```

## Backend

Backend reuses the existing `settings` websocket message type with new actions:

- `get_ui_preferences`
- `save_ui_preferences`

Responses:

- `ui_preferences`
- `ui_preferences_saved`
- `settings_error` with `action`

Implementation files:

- `cli/src/uiPreferences.ts`
- `cli/src/server.ts`

## Frontend

Frontend keeps the authoritative in-memory state in `App.tsx`.

Behavior:

- request preferences after websocket auth succeeds
- show the controls in the settings panel
- apply changes immediately in the UI
- save to backend
- rollback to the last saved state if save fails

Filtering rules:

- `showStatus` => `status`
- `showLog` => `log`
- `showTool` => `tool_use` and `tool_result`

If a message has no visible process events after filtering, the process panel is hidden.

Implementation files:

- `chat-ui/src/App.tsx`
- `chat-ui/src/types.ts`

## Verification

Backend:

- `cd cli && npm run build`
- `cd cli && npx jest src/__tests__/uiPreferences.test.ts src/__tests__/codexStorage.test.ts`

Frontend:

- `cd chat-ui && npm run lint`
- `cd chat-ui && npm run build`
