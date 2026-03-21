# CodeRemote Codex Provider Handoff

> Created: 2026-03-21
> Status: Active
> Related:
> - `docs/plans/2026-03-20-codex-provider-design.md`
> - `docs/plans/2026-03-20-codex-provider-implementation.md`

## 1. Current State

This branch now supports both local `claude` and local `codex` in the same app.

Key product behavior:

- provider is fixed when a session is created
- Claude and Codex sessions can coexist and be switched in the same UI
- history/session CRUD is provider-aware
- discussion follows the host session provider
- Mermaid/flowchart content can render in chat messages
- Codex uses a structured process panel instead of Claude-style thinking text

## 2. Key Files

Backend:

- `cli/src/server.ts`
- `cli/src/handlers/claude.ts`
- `cli/src/handlers/discussion.ts`
- `cli/src/claude/session.ts`
- `cli/src/claude/storage.ts`
- `cli/src/claude/types.ts`
- `cli/src/codexEngine.ts`
- `cli/src/codexStorage.ts`
- `cli/src/session/`
- `cli/src/codex/`

Frontend:

- `chat-ui/src/App.tsx`
- `chat-ui/src/DiscussionPanel.tsx`
- `chat-ui/src/types.ts`

Ops:

- `start-services.bat`

## 3. Important Implementation Notes

### Provider model

- The app still reuses much of the Claude naming internally, but sessions now carry `provider`.
- UI switching must follow the session's persisted provider, not only the current top-level tab state.

### Codex history and process panel

- Codex history is parsed from local `~/.codex/sessions/**/*.jsonl`.
- The parser reconstructs:
  - user messages
  - assistant final answers
  - process events
  - tool calls/tool results
- Codex does not expose Claude-style thinking blocks in the same form, so the UI shows process events instead.

### Recent bugfix

The latest fix was for Codex history restore in `cli/src/codexStorage.ts`.

Symptoms before the fix:

- consecutive assistant final answers were merged into one message
- commentary/process logs were duplicated
- `custom_tool_call` activity was missing from restored history

Current parser behavior:

- keeps consecutive assistant final answers as separate messages
- dedupes repeated commentary/process events
- supports `custom_tool_call` and `custom_tool_call_output`
- attaches `task_complete` to the active assistant message process state

Regression coverage:

- `cli/src/__tests__/codexStorage.test.ts`

## 4. How To Start

Recommended one-click start:

```bat
start-services.bat
```

Expected local endpoints:

- backend: `ws://localhost:8085`
- frontend: `http://localhost:5173`

The launcher also starts ngrok and prints an external `wss://...` URL.

## 5. Recommended Verification

### Backend

```powershell
cd cli
npm run build
npx jest src/__tests__/codexStorage.test.ts
```

### Frontend

```powershell
cd chat-ui
npm run lint
npm run build
```

### Manual smoke test

1. Start services with `start-services.bat`.
2. Create one Claude session and one Codex session.
3. Send a message in each and confirm provider stays fixed per session.
4. Switch through history and confirm the provider toggle reflects the loaded session.
5. Open a Codex history session and confirm:
   - the message list is correct
   - the process panel is present
   - tool calls are visible
6. Send/render a Mermaid block such as `flowchart TD` and confirm it renders.

## 6. Known Caveats

- If history looks stale after backend edits, restart the backend process. History parsing happens server-side.
- `start-services.bat` uses Windows-only process control and ngrok assumptions.
- There are unrelated temporary/local files that should not be trusted as part of the feature unless explicitly committed.

## 7. Useful Real Debug Artifact

One real Codex session used to debug history parsing:

- session id: `019d0b41-2df5-7672-a31d-ab769d1d0dc5`
- file:
  - `C:\Users\TheCheng\.codex\sessions\2026\03\20\rollout-2026-03-20T20-38-34-019d0b41-2df5-7672-a31d-ab769d1d0dc5.jsonl`

If Codex history regresses again, replay that file through `CodexSessionStorage.load()` / `loadPaginated()` first.
