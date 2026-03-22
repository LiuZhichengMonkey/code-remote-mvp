# Chat UI State And Message Router Refactor Design

## Goal

Refactor the chat UI so Claude and Codex sessions behave consistently across:

- running state
- history/sidebar rendering
- provider binding
- refresh/reconnect recovery
- process panel visibility

The current UI keeps the same concepts in multiple local states and updates them from several code paths. That makes refresh, session switching, and provider alignment fragile. This refactor centralizes chat session state, routes server messages through one path, and splits major UI areas into focused components without changing the backend protocol.

## Scope

This refactor applies to the frontend in `chat-ui` only.

- Keep existing Claude/Codex backend protocol.
- Keep provider fixed at session creation.
- Keep current user-facing features working.
- Allow modest interaction/layout cleanup where it improves clarity or mobile usability.

## Problems

### 1. State is duplicated

The current UI stores overlapping chat data in:

- `sessions`
- `projectSessions`
- `runningSessions`
- `runningSessionsInfo`
- `completedSessions`
- `currentSessionId`
- `currentProjectId`
- localStorage running-session cache

Those copies are updated independently in many places, which causes drift.

### 2. WebSocket handling is fragmented

`App.tsx` processes the main socket stream while `useDiscussion.ts` also attaches socket listeners. This splits ownership of server events and makes ordering/recovery harder to reason about.

### 3. App.tsx is too large

Rendering, settings, websocket lifecycle, state transitions, and utility helpers are all mixed in one file. That slows safe iteration and makes regressions harder to isolate.

### 4. Key flows lack regression coverage

Critical behavior such as refresh recovery, provider alignment, and running-session transitions is mostly protected by manual testing only.

## Recommended Approach

Use a centralized reducer-driven chat state with a single server-message routing layer.

### Architecture

- Add a focused chat state module for session/history/running/provider data.
- Route websocket messages through one message-router function.
- Keep connection/settings/discussion side effects in hooks, but push session mutations through reducer actions.
- Split large visual sections into components.

## Data Model

Introduce a chat state module with:

- session collections
- project session collections
- current session/project selection
- running session registry
- completed session registry
- project list
- pagination metadata

Provider is stored on sessions and resolved from session state rather than a parallel display-only source.

## Cache Strategy

Keep only two persisted cache entries:

- running session entries
- active running session

Refresh behavior:

1. bootstrap minimal placeholder state from cache
2. reconnect websocket
3. request `resume` and `session_focus`
4. merge confirmed server running sessions
5. remove stale local running sessions after timeout

## Message Routing

Create a single routing layer for websocket events.

Examples:

- `project_list`
- `session_list`
- `session_resumed`
- `session_id_updated`
- `session_deleted`
- `running_sessions`
- `session_running`
- `claude_start`
- `claude_stream`
- `claude_tool`
- `claude_done`
- `claude_error`
- `stopped`
- `discussion_*`

The router converts server payloads into reducer-friendly transitions and keeps ordering rules in one place.

## UI Split

Planned component split:

- `components/chat/ChatBubble.tsx`
- `components/chat/MessageList.tsx`
- `components/chat/ChatViewport.tsx`
- `components/chat/InputArea.tsx`
- `components/chat/ProcessPanel.tsx`
- `components/chat/ScrollIndex.tsx`
- `components/chat/RunningSessionsStrip.tsx`
- `components/sidebar/HistorySidebar.tsx`
- `components/settings/ConnectionSettingsPanel.tsx`

## Interaction Changes

- Sidebar shows a dedicated `Running Now` section above project history.
- Current provider badge always follows the active session provider.
- Running-session recovery always has a visible placeholder in the main viewport.
- Settings layout is grouped by connection, runtime profiles, and process panel options.
- Mobile scrolling and sidebar transitions stay usable during long sessions.

## Testing

Add reducer/router tests for:

- session id migration while running
- running session completion/error/stop cleanup
- reconnect bootstrap preserving local placeholder until confirmation
- provider alignment when switching Claude/Codex sessions
- representative websocket event sequences

Retain current pure-function tests for UI preferences and runtime profiles.

## Non-Goals

- No backend protocol redesign
- No new frontend state library
- No full virtualization pass in this refactor
- No broad visual redesign beyond usability-oriented cleanup

## Implementation Order

1. Extract chat state/cache modules
2. Extract message rendering components
3. Move session/running mutations into reducer actions
4. Introduce websocket message router
5. Remove duplicate discussion socket handling
6. Add reducer/router regression tests
7. Rebuild and manually verify refresh/provider/history flows
