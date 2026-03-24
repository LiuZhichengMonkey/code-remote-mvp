# Test Token Session Isolation Design

Date: 2026-03-24

## Goal

Add a test access mode so users can connect with dedicated test tokens and only access their own test sessions, while the admin token can still access all sessions.

The system must:

- Keep the existing admin token flow unchanged when no test tokens are configured.
- Allow multiple tester identities, each mapped to a different token.
- Isolate tester session history and session operations at the server layer.
- Support both Claude and Codex providers with the same permission model.
- Keep existing historical sessions visible to admin only unless new access metadata exists.

## Approved Access Model

- `server.token` remains the admin token.
- `server.testTokens` is a list of `{ ownerId, token }`.
- Admin token authenticates as `admin`.
- A configured test token authenticates as `tester` with a fixed `ownerId`.
- Sessions created by a tester belong to that tester.
- Admin can view and manage:
  - normal admin sessions
  - all tester sessions
- A tester can only view and manage:
  - their own tester sessions
- Existing sessions without access metadata are treated as admin-only sessions.

## Options Considered

### 1. Server-side ACL plus session access metadata

Chosen.

Add identity at auth time and store session ownership in a sidecar metadata file under the workspace. Enforce filtering and authorization in the server for all history and session actions.

Pros:

- Correct security boundary
- Works for Claude and Codex
- Minimal changes to existing session storage
- Keeps admin full visibility

Cons:

- Requires a new metadata store

### 2. Separate physical storage per tester

Rejected.

This would require broad changes to Claude and Codex session discovery and project aggregation logic and make admin cross-user review harder.

### 3. Frontend-only hiding

Rejected.

This would not provide real access control because the server currently trusts any authenticated client equally.

## Data Model

Add `server.testTokens` to repo config:

```json
{
  "server": {
    "port": 8085,
    "token": "test123",
    "workspaceRoot": ".",
    "testTokens": [
      { "ownerId": "shenghua.yang", "token": "shenghua-token" },
      { "ownerId": "wenlong.fu", "token": "wenlong-token" }
    ]
  }
}
```

Add a workspace-side metadata file:

- `workspaceRoot/.coderemote/session-access.json`

Each record stores:

- `provider`
- `projectId`
- `sessionId`
- `ownerType: "admin" | "tester"`
- `ownerId?`
- `createdAt`
- `updatedAt`

This file is the authorization source for new sessions. Legacy sessions without a record remain admin-only.

## Auth Model

At WebSocket auth time the server resolves the token to an access identity:

- `admin`
- `tester(ownerId)`

The authenticated client context will carry:

- `accessMode`
- `ownerId`
- derived permissions such as:
  - `canViewAllSessions`
  - `canManageSettings`

The `auth_success` payload will expose minimal identity context to the frontend so it can label the mode and hide settings for testers.

## Authorization Rules

Authorization is enforced on the server for:

- session list
- project list
- list by project
- session resume
- load more messages
- delete session
- rename session
- running session reconnect and running-state payloads
- stop requests
- settings access

Rules:

- Admin can access everything.
- Tester can access only sessions with:
  - `ownerType = "tester"`
  - `ownerId = authenticated ownerId`
- Legacy sessions with no metadata are visible only to admin.
- Unauthorized session access returns the same not-found style response as a missing session to avoid leaking session existence.
- Unauthorized settings access returns a clear forbidden-style error because it does not leak session existence.

## Session Ownership Lifecycle

When a tester creates a new session:

- the temporary session is created in memory with tester ownership attached
- once the provider session is materialized and the session has a stable session ID, the metadata file is updated
- if the session ID changes during provider synchronization, the ownership record is updated accordingly

For admin-created sessions:

- new sessions may be recorded as `ownerType = "admin"` for completeness
- legacy sessions without metadata still remain admin-visible by default

## Project List Behavior

Project lists must be filtered after applying session ownership rules.

For testers:

- only projects containing at least one accessible tester session are returned
- `sessionCount` reflects filtered sessions only
- `lastActivity` reflects filtered sessions only

For admin:

- the existing full project list behavior remains available

## Frontend Changes

Keep frontend changes minimal:

- After auth, show tester identity when applicable, such as `Test mode / shenghua.yang`.
- Hide or disable settings for testers because current settings storage is shared/global.
- Keep session list behavior unchanged from the UI perspective; the server will already return filtered results.
- When a tester attempts to open a session they cannot access, show a generic not-found/no-access message.
- Optionally adjust empty-state text for testers to explain that only their test sessions are shown.

## Compatibility

- If `server.testTokens` is missing or empty, behavior remains unchanged.
- No migration script is required.
- Existing old sessions without metadata remain admin-only.
- If `session-access.json` is missing, testers see only newly registered sessions; admin still sees all old sessions.

## Testing Plan

### Unit tests

- token resolution for admin, tester, and invalid token
- session access matching
- filtered session listing
- filtered project listing
- authorization on resume, load more, rename, delete
- legacy session visibility fallback

### Integration tests

- tester A creates Claude session and can only see that session
- tester B creates Codex session and can only see that session
- admin can see both tester sessions and admin sessions
- tester reconnect restores only their running sessions
- tester cannot load another tester’s session
- tester cannot manage shared settings

### Manual tests

- login with admin token and verify full history access
- login with each tester token and verify isolated history
- create Claude and Codex sessions for each tester
- refresh during running sessions and verify isolated recovery
- verify settings are hidden or disabled for testers

## Implementation Plan

1. Extend runtime config parsing to support `server.testTokens`.
2. Add server auth identity resolution and enrich authenticated client state.
3. Implement session access storage under `.coderemote/session-access.json`.
4. Thread access context into session actions and running-session announcements.
5. Filter project and session listings by access context.
6. Restrict tester access to settings APIs.
7. Update the web app to reflect tester mode and hide settings when needed.
8. Add tests for token resolution, access filtering, and restricted operations.
