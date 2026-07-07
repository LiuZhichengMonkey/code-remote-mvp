# DeerFlow Provider Integration Design

## Goal

Integrate DeerFlow into CodeRemote MVP as a third provider so users can:

- create DeerFlow-backed sessions inside the existing provider switcher
- keep one unified chat surface for Claude, Codex, and DeerFlow
- use DeerFlow uploads, artifacts, subtasks, reasoning, and provider settings from the same mobile-friendly UI
- keep provider fixed at session creation time
- preserve the current CodeRemote WebSocket contract for the frontend where practical

## Why DeerFlow Is Different

CodeRemote currently assumes providers look like local CLI runtimes:

- session-oriented
- local-history-backed
- streamed over the server's own WebSocket protocol

DeerFlow is a platform, not a CLI wrapper:

- execution unit: `thread` + `run`
- transport: HTTP + SSE
- first-class structured outputs: uploads, artifacts, subtasks, skills, models, memory

Because of that, DeerFlow should not be forced into the exact same backend shape as Claude and Codex. It should present as a third provider in the UI, but be bridged internally through a provider-specific adapter.

## Recommended Architecture

Use a hybrid bridge provider architecture.

- Frontend:
  - keep the existing provider switcher and unified chat page
  - add DeerFlow-specific rendering blocks and settings sections
- CodeRemote server:
  - add a DeerFlow provider adapter that talks to DeerFlow Gateway and LangGraph APIs
  - keep frontend communication on the existing CodeRemote WebSocket
- DeerFlow:
  - remains the source of truth for thread history, runs, uploads, artifacts, skills, models, and memory

## Session Model

### Provider

Extend provider enums to:

- `claude`
- `codex`
- `deerflow`

### Session Identity

For DeerFlow sessions:

- `session.id = thread_id`
- provider is fixed to `deerflow` at creation time

Do not overload `providerSessionId` with `run_id`. A DeerFlow run is an execution instance, not the conversation identity.

### Session Metadata

Add DeerFlow-specific metadata on sessions:

- `threadId`
- `latestRunId`
- `assistantId`
- `mode` (`flash | standard | pro | ultra`)
- `selectedModel`
- `lastSyncedAt`
- `artifactCount`
- `uploadCount`

## Message Model

Reuse existing generic fields where possible:

- `content`
- `thinking`
- `attachments`
- `process`

Add DeerFlow-specific provider metadata to support structured rendering:

- `messageType`
- `toolCalls`
- `artifacts`
- `subtasks`
- `sourceMessageIds`
- `rawEventKinds`

### Mapping Rules

#### Plain AI text

- map to `content`

#### Reasoning

- map to `thinking`
- optionally mirror summary events into `process.events`

#### Tool calls and tool results

- map to existing `process.events`
- preserve raw structured payload in DeerFlow message metadata

#### Subtasks

- do not flatten into plain tool logs only
- expose explicit subtask records for dedicated UI cards

#### Artifacts / present_files

- map to attachments
- extend remote file source types with `artifact`

## Backend Bridge

### Core Principle

Frontend continues to talk only to CodeRemote WebSocket.

Backend adds a DeerFlow bridge:

- Gateway API for models, skills, agents, memory, uploads, artifacts
- LangGraph API for threads, history, and stream execution

### Lifecycle

#### New session

1. frontend requests `session:new provider=deerflow`
2. backend creates DeerFlow thread
3. backend returns `session_created`
4. created session id is the DeerFlow `thread_id`

#### Send message

1. upload files to DeerFlow thread if needed
2. start DeerFlow `runs/stream`
3. consume SSE server-side
4. translate SSE into CodeRemote WebSocket events

#### Resume session

1. frontend sends existing `session:resume`
2. backend loads DeerFlow thread history
3. backend sends normalized `session_resumed`

#### Session list

- list from a local cached mirror for responsiveness
- refresh from DeerFlow `threads/search`

## WebSocket Event Strategy

Prefer compatibility over a new protocol.

### Reuse existing event families

- `session_created`
- `session_resumed`
- `claude_start`
- `claude_stream`
- `claude_log`
- `claude_done`
- `session_running_state`

These can continue to be emitted with `provider: "deerflow"`.

### Add DeerFlow-specific structured events

- `provider_artifacts`
- `provider_subtasks`
- `provider_uploads`
- `provider_settings_payload`

These are needed because artifacts, uploads, and subtasks are not just text stream variants.

## Reconnect and Running State

Running-state resilience is mandatory.

- backend owns the SSE stream while a DeerFlow run is active
- backend buffers:
  - latest accumulated content
  - reasoning summary
  - subtask state
  - artifact state
  - upload state
- on frontend reconnect:
  - emit `session_running_state`
  - replay buffered state snapshot
- on stream interruption:
  - do not mark session complete blindly
  - query DeerFlow state where possible
  - surface explicit stream interruption if final state is unknown

## History and Cache Strategy

DeerFlow remains the source of truth.

CodeRemote stores only a local mirror cache for:

- thread summary list
- normalized message snapshot
- latest known artifact/upload/subtask state
- last sync timestamps

Suggested local files:

- `.coderemote/deerflow-thread-cache.json`
- `.coderemote/deerflow-thread-index.json`

## Frontend Rendering

Stay on the unified chat page, but add DeerFlow-capable components.

### Core chat bubble

Reuse current support for:

- markdown
- code blocks
- mermaid
- image/file preview
- process panel

### Add DeerFlow-specific blocks

#### Subtask card

Display:

- title
- status
- summary
- final result or error

#### Artifact list

Display:

- artifact filename
- preview/download actions
- recent-file integration

#### Clarification block

Display DeerFlow clarification requests prominently instead of as plain text only.

## Input Area

When provider is DeerFlow, extend the existing input area with:

- mode selector
- assistant selector
- model selector
- file upload flow
- optional skill shortcuts

These controls should remain provider-scoped and not alter Claude or Codex flows.

## Settings

Keep one settings surface, but split by provider.

### Common

- UI language
- process panel visibility
- preview/download preferences

### Claude

- existing runtime profile settings

### Codex

- existing runtime profile settings

### DeerFlow

- models
- skills
- agents
- memory
- default mode
- default assistant
- API endpoint settings if configured manually

## Startup and Configuration

Extend CodeRemote config with a DeerFlow section:

- `enabled`
- `baseUrl`
- `gatewayUrl`
- `langgraphUrl`
- optional managed-start settings

CodeRemote one-click scripts remain the top-level entry point.

If managed start is enabled, CodeRemote scripts should bootstrap or start DeerFlow using the local DeerFlow repo and its documented commands.

Note: the confirmed local path is `E:/work/deer-flow`, not `E:/work/deerflow`.

## Error Handling

Introduce DeerFlow-specific error codes:

- `DEERFLOW_API_ERROR`
- `DEERFLOW_STREAM_ERROR`
- `DEERFLOW_THREAD_NOT_FOUND`
- `DEERFLOW_SETTINGS_ERROR`

These errors must not degrade Claude or Codex behavior.

## Delivery Phases

### Phase 1

- provider enum expansion
- DeerFlow bridge
- session create/resume/history/stream
- reconnect resilience
- unified chat integration for text/reasoning

### Phase 2

- uploads
- artifacts
- subtask cards
- clarification rendering
- recent files integration

### Phase 3

- DeerFlow settings surface
- models/skills/agents/memory management
- startup script integration
- mobile polish and regression hardening

## Testing

### Unit

- provider normalization
- DeerFlow thread/session mapping
- SSE to normalized message mapping
- artifact/subtask/upload normalization

### Backend integration

- new DeerFlow session
- resume history
- running state recovery
- settings proxy endpoints

### Frontend integration

- provider switching
- DeerFlow chat rendering
- DeerFlow subtask/artifact display
- DeerFlow settings loading

### Manual

Add DeerFlow cases to `TESTING.md` covering:

- session create/resume
- uploads
- artifacts preview/download
- subtask rendering
- reconnect during running
- settings pages

## Recommendation

Proceed with the hybrid bridge provider design. It preserves the user's desired unified provider experience while avoiding a brittle attempt to force DeerFlow into the same internal semantics as local CLI providers.
