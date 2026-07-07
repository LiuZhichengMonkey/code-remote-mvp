# Multi-Provider Runtime Profile

Date: 2026-07-08

## Goal

Extend CodeRemote so the server, web UI, and mobile app all expose a consistent
**runtime provider profile** surface — users see which providers are usable in the
current session, can switch between them at runtime, and gracefully handle
providers that disappear mid-session (CLI uninstalled, version mismatch, etc.).

## Scope

This iteration covers:

- **Server (`apps/server`)** — advertise `supportedProviders`, expose per-provider
  availability, accept a `requestedCwd` on `createSession`, surface
  `SessionContextUsage` for compact prompts, stream `MessageProcessEvent` while
  a session is running, and standardize the engine factory.
- **Web UI (`apps/web`)** — render the provider list from the server instead of
  hard-coding `claude` / `codex`; surface temporary unavailability; render the
  project list with `sessionCount`; preview local resources (images) via
  `localResource.ts`; provide `HISTORY_PROJECT_SESSION_LIMIT = 100` cap.
- **Mobile (`apps/mobile`)** — refactor `ChatScreen` to consume typed streams
  (`connectionState`, `errors`, `messages`, `sessionContext`, `supportedProviders`,
  `sessionList`, `history`) with explicit `StreamSubscription` lifecycle and
  selectable provider.
- **Build** — Vite `manualChunks` splits for `react-vendor`, `ui-vendor`,
  `render-vendor`; the legacy root-level ignore patterns (`cli/`, `web/`,
  `debate-reports/`, `multi-agent-sessions/`) are anchored to root.
- **Docs** — README rewritten in English with feature overview and architecture
  diagram; gitignore updated to ship `dist/index.html` + `dist/assets/` while
  still ignoring other dist artifacts.

## Server API additions

- `runtimeProfiles` now exposes `SUPPORTED_PROVIDERS`, `pathToProjectKey`,
  `normalizeSupportedProviders`, `getFallbackProvider`, and
  `isProviderTemporarilyUnavailable`.
- `ClaudeHandler.createEngine(provider)` is a single switchpoint for future
  providers (deerflow placeholder lives behind the same interface).
- `resolveSessionWorkspaceContext(accessIdentity, requestedCwd)` accepts a
  client-supplied cwd, validates it is inside the user-allowed workspace root
  for non-admins, and refuses non-existent paths or files.
- `SessionRunState` gains `capturedContent` / `capturedThinking`,
  `bufferedToolEvents`, and `processEvents` so the WS can replay intermediate
  state on reconnect / focus / start / resume / compact snapshots.
- New context module exposes `estimateContextUsage`, `estimateSessionContextUsage`,
  `buildCompactPrompt`, and `SessionContextUsage`.

## Web UI surface

- `ConnectionPanel` takes `supportedProviders: Provider[]` and renders one button
  per provider, plus a fallback badge.
- `App.tsx` imports `localResource` helpers (`getPathDisplayName`,
  `isBareFileName`, `isPreviewableImagePath`, `normalizeLocalResourcePath`) to
  render previewable inline images.
- `projectHasKnownSessions(project)` guards the "empty history" copy.
- New `chatSessionState.test.ts` covers the per-session state reducer.

## Mobile surface

- `ChatScreen` keeps a typed subscription per stream, exposes a
  `ProviderDropdown`, and displays `SessionContextUsage` in the header chip.
- The transport (`websocket_service.dart`) is unchanged on the wire; only the
  client-side stream surface is enriched.

## Build / Docs

- `apps/web/vite.config.ts` adds a `manualChunks` function that returns
  `react-vendor`, `ui-vendor`, or `render-vendor` for `node_modules` matches
  (React, framer-motion/lucide, katex/marked/highlight.js) — first chunk load
  drops noticeably on cold deploys.
- `.gitignore` switches `apps/web/dist` from `dist/` to `dist/*` with explicit
  allow rules for `dist/index.html` and `dist/assets/**`. Root legacy paths
  get leading slashes so they match only at the repo root.
- `README.md` is rewritten in English: features, architecture diagram, prereqs,
  quick start. The Chinese walkthrough is removed in favor of the in-repo
  `docs/` plans.

## Verification

1. Server unit tests: `npm test --workspace apps/server` (covers
   `provider.test.ts`, `runtimeProfiles.test.ts`, `claude-handler-provider.test.ts`).
2. Web tests: `npm test --workspace apps/web` (covers
   `chatSessionState.test.ts`, `runtimeProfiles.test.ts`).
3. Manual smoke:
   - Cold-start server with `claude` only, open UI → only Claude button shown.
   - Switch config to add `codex`, restart → both buttons appear and Codex
     session starts without errors.
   - Temporarily rename the `claude` binary → UI shows
     "temporarily unavailable" badge and routes new sessions to the fallback.