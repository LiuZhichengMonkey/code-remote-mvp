# CodeRemote Codex Provider Implementation Plan

> Created: 2026-03-20
> Status: Draft
> Based on: `2026-03-20-codex-provider-design.md`

## 1. Implementation Strategy

Build the feature by extracting provider-neutral layers first, then attach Codex support on top of them.

This avoids two independent chat stacks and keeps Claude regressions visible early.

## 2. Workstreams

### Workstream A: Shared Types and Protocol

Targets:

- introduce `ProviderType`
- add provider fields to session models
- define provider-neutral websocket event names
- keep temporary compatibility with current Claude-only event names

Primary files:

- `cli/src/server.ts`
- `cli/src/claude/types.ts` or a new shared chat types module
- `chat-ui/src/types.ts`
- `chat-ui/src/App.tsx`

### Workstream B: Backend Handler Extraction

Targets:

- replace Claude-specific handler assumptions with a provider router
- preserve current running-session behavior
- preserve background accumulation and active-session flushing

Primary files:

- `cli/src/handlers/claude.ts`
- new provider-neutral handler module
- `cli/src/server.ts`

Expected outcome:

- a unified handler can create, send, stop, and restore sessions for either provider

### Workstream C: Provider Runtime Interfaces

Targets:

- define a shared provider runtime interface
- wrap existing Claude engine
- add Codex runtime using local CLI JSON output

Primary files:

- `cli/src/claude/engine.ts`
- new provider runtime module(s)
- new Codex runtime module(s)

Runtime interface shape:

```ts
interface ChatProviderRuntime {
  detectCli(): Promise<boolean>;
  sendMessage(...): Promise<ProviderSendResult>;
  stop(sessionId?: string): boolean;
}
```

### Workstream D: Storage Abstraction

Targets:

- hide provider-specific session lookup behind one storage contract
- preserve Claude project browsing behavior
- add Codex session listing and parsing

Primary files:

- `cli/src/claude/storage.ts`
- `cli/src/claude/session.ts`
- new Codex storage and session modules

Expected outcome:

- list sessions
- resume session
- paginated load
- rename
- delete

### Workstream E: Frontend Session UX

Targets:

- provider selector when creating a session
- provider badges in session list
- provider-neutral handling for chat start/stream/done/error

Primary files:

- `chat-ui/src/App.tsx`
- `chat-ui/src/types.ts`

Expected outcome:

- one UI path for both providers

### Workstream F: Discussion Routing

Targets:

- route discussion runtime by host session provider
- preserve summary injection into the host session
- isolate provider-specific discussion worker logic

Primary files:

- `cli/src/handlers/discussion.ts`
- `cli/src/multi-agent/llm-adapter.ts`
- provider-specific discussion runtime modules as needed

## 3. Ordered Delivery Plan

### Step 1

Create shared provider types and session metadata plumbing.

Done when:

- sessions can carry `provider`
- frontend can display provider from loaded session metadata

### Step 2

Introduce provider-neutral websocket events while keeping frontend backward compatibility.

Done when:

- backend can emit `chat_*`
- frontend can consume `chat_*`
- existing Claude flows still work

### Step 3

Wrap Claude behavior behind shared runtime and storage interfaces.

Done when:

- Claude still works
- the main handler no longer hardcodes Claude assumptions

### Step 4

Implement Codex runtime and Codex session storage.

Done when:

- Codex sessions can be created
- Codex messages stream in the UI
- Codex sessions can be resumed from disk

### Step 5

Make session CRUD provider-aware.

Done when:

- rename, delete, list, load more all work for both providers

### Step 6

Route discussion through provider-aware adapters.

Done when:

- discussion runs under Claude host sessions
- discussion runs under Codex host sessions
- summaries are injected back correctly

### Step 7

Remove remaining Claude-only naming and UI text where safe.

Done when:

- no core chat path depends on `claude_*` naming

## 4. Test Plan

### Backend Unit Tests

- provider type serialization
- handler routing by session provider
- Claude parser regression coverage
- Codex session parser coverage
- internal event normalization coverage

### Backend Integration Tests

- create Claude session and send a message
- create Codex session and send a message
- resume Claude session
- resume Codex session
- stop running session by provider
- load more messages

### Frontend Verification

- create session with provider selector
- provider badge appears in session list
- switching between Claude and Codex sessions works
- running indicator behaves correctly
- background stream accumulation still works

### Discussion Verification

- Claude discussion still runs
- Codex discussion runs from a Codex host session
- summary injection returns to the correct host session

## 5. Risks

- Codex CLI event structure may differ from Claude more than expected.
- Codex session files may require looser parsing rules than Claude storage.
- Frontend currently has direct `claude_*` assumptions and may need broader cleanup than expected.
- Discussion code already has local uncommitted edits, so integration there must be conservative.

## 6. Definition of Done

The feature is complete when:

- the app supports both Claude and Codex local CLIs
- provider is fixed per session and visible to the user
- session management works for both providers
- discussion works for both providers
- Claude regressions are covered by verification
