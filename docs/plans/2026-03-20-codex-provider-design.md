# CodeRemote Codex Provider Design

> Created: 2026-03-20
> Status: Approved

## 1. Goal

Add first-class `Codex CLI` support while keeping existing `Claude` support.

Required user-facing behavior:

- `Claude` and `Codex` both remain available.
- A session chooses its provider at creation time and keeps it for its whole lifetime.
- Session list, history restore, pagination, rename, delete, stop, multi-session concurrency, and discussion mode all work for both providers.
- The UI stays unified instead of splitting into separate Claude and Codex screens.

## 2. Core Decisions

### 2.1 Provider Model

- Introduce a provider-aware chat architecture instead of duplicating the current Claude pipeline.
- Providers are fixed per session:
  - `claude`
  - `codex`
- Provider switching happens by switching sessions, not by switching a running session.

### 2.2 Scope

This work targets local CLIs only:

- `claude`
- `codex`

No API-only Codex integration is included in this phase.

### 2.3 Discussion Alignment

Discussion mode must work under both providers.

- Claude sessions use Claude-backed discussion workers.
- Codex sessions use Codex-backed discussion workers.
- Discussion output is injected back into the host session using the same provider-neutral path.

## 3. Architecture

### 3.1 High-Level Shape

```text
chat-ui
  -> provider-neutral websocket protocol
  -> server
    -> ChatHandler
      -> ProviderRegistry
        -> ClaudeProvider
        -> CodexProvider
      -> SessionRegistry
      -> DiscussionRouter
```

### 3.2 Main Backend Components

- `ChatHandler`
  - Replaces Claude-only request routing.
  - Resolves the current session.
  - Dispatches work to the correct provider runtime and storage adapter.
- `ProviderRuntime`
  - Normalizes provider-specific CLI output into internal chat events.
- `ProviderStorage`
  - Lists sessions.
  - Loads session history.
  - Supports pagination, rename, delete, and project scoping when available.
- `DiscussionProviderAdapter`
  - Creates provider-specific discussion workers while keeping the discussion API stable.

## 4. Unified Session Model

The shared session model is extended with provider metadata.

```ts
type ProviderType = 'claude' | 'codex';

interface ChatSession {
  id: string;
  title: string;
  provider: ProviderType;
  providerSessionId?: string;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
  projectId?: string;
  messages: ChatMessage[];
}
```

### 4.1 Field Rules

- `id`
  - Stable CodeRemote session identifier used by the frontend.
- `provider`
  - Immutable after session creation.
- `providerSessionId`
  - Actual session id used by the underlying CLI resume mechanism.
- `cwd`
  - Working directory needed for provider resume and storage lookup.
- `projectId`
  - Provider-specific grouping key used for session browsing.

## 5. Transport Protocol

Current websocket events are Claude-specific. They need to become provider-neutral.

### 5.1 New Event Family

- `chat_start`
- `chat_stream`
- `chat_tool`
- `chat_log`
- `chat_done`
- `chat_error`

Every event includes:

- `sessionId`
- `provider`
- `timestamp`

### 5.2 Compatibility Strategy

- The frontend first supports both old `claude_*` events and new `chat_*` events.
- The backend migrates internal send paths to `chat_*`.
- Old Claude-only names can be removed after the new path is verified.

## 6. Provider Runtime Design

### 6.1 Claude Runtime

Claude keeps using the existing CLI path, based on:

- `claude --print`
- `--output-format stream-json`
- `--resume <sessionId>`

The Claude runtime is wrapped behind the common provider interface instead of being called directly by the handler.

### 6.2 Codex Runtime

Codex uses local CLI execution and resume support.

Expected command families:

- `codex exec --json`
- `codex exec resume <sessionId> --json` or equivalent supported resume path

The Codex runtime parses JSONL output and maps provider-specific records into shared internal events:

- `text-delta`
- `thinking-delta`
- `tool-call`
- `tool-result`
- `log`
- `done`
- `error`

### 6.3 Internal Event Normalization

Both runtimes emit the same normalized event stream so the existing frontend behavior can be preserved:

- active session streams directly
- background session content accumulates
- switching back flushes with `replace`
- stop logic works per session

## 7. Storage Design

### 7.1 Claude Storage

Claude storage remains based on:

- `~/.claude/projects/...`

Existing pagination, rename, delete, and cross-project lookup logic should be moved behind a provider storage interface rather than rewritten.

### 7.2 Codex Storage

Codex storage is added on top of:

- `~/.codex/sessions/...jsonl`

Codex session parsing must extract:

- session id
- cwd
- created and updated timestamps
- user-visible messages
- provider metadata

### 7.3 Session Listing

The session list returned to the UI stays unified but must include `provider`.

The sidebar should visibly label each session as `Claude` or `Codex`.

## 8. Frontend Behavior

### 8.1 Session Creation

When creating a new session, the user chooses a provider:

- `Claude`
- `Codex`

After creation:

- the session is tagged with that provider
- all future sends and restores use that provider

### 8.2 Sidebar and Session Switching

- Session list remains a single list.
- Each item shows a provider badge.
- Switching sessions also switches provider context implicitly.

### 8.3 Settings

Settings become provider-aware.

Phase-1 expectation:

- Claude settings continue to expose `ANTHROPIC_*` values.
- Codex settings at minimum expose detection and active configuration state.
- A full Codex config editor is not required for the first pass.

## 9. Discussion Design

Discussion remains a single feature surface, but runtime selection depends on the host session provider.

### 9.1 Routing Rules

- Host session provider `claude`:
  - use Claude-backed discussion workers
- Host session provider `codex`:
  - use Codex-backed discussion workers

### 9.2 Guarantees

For both providers, discussion should support:

- start
- streaming updates
- result generation
- result injection into the host session
- stop and cleanup

## 10. Error Handling

Provider-specific failure modes must not collapse into one generic error.

Required error classes:

- provider CLI not found
- provider session not found
- provider resume failed
- provider storage parse failed
- rate limit or provider rejection
- stream parse error

If a provider emits tool events that cannot be fully normalized, the system should degrade to log output instead of blocking the main response path.

## 11. Rollout Strategy

### 11.1 Phase Order

1. Extract provider-neutral chat protocol and session model.
2. Wrap existing Claude behavior behind provider interfaces.
3. Add Codex runtime and Codex storage.
4. Route discussion through provider-aware adapters.
5. Remove remaining Claude-only assumptions from the UI and handlers.

### 11.2 Safety Goals

- No regression to existing Claude flows.
- No cross-session or cross-provider stream leakage.
- No accidental stop/delete operations across providers.

## 12. Acceptance Criteria

- Users can create both Claude and Codex sessions.
- Provider is visible in the session list and preserved on restore.
- Both providers support:
  - send
  - stream
  - stop
  - resume
  - rename
  - delete
  - paginated history loading
- Multi-session concurrency works without stream corruption.
- Discussion mode works for both providers.
- Existing Claude behavior remains functional.
