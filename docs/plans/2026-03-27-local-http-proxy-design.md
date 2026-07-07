# Local HTTP Proxy Design

Date: 2026-03-27

## Goal

Allow a phone browser to view a locally running website on the desktop machine through the existing CodeRemote server and tunnel.

The first version must:

- Reuse the existing CodeRemote HTTP server and ngrok domain.
- Proxy only local desktop targets such as `http://127.0.0.1:3000/`.
- Support ordinary page browsing and static assets.
- Keep the existing token-based access control boundary.
- Avoid turning CodeRemote into a general-purpose open proxy.

The first version does not need to support:

- WebSocket proxying
- Server-Sent Events
- HMR / Vite / Next.js dev runtime behavior
- `POST` form submission
- upload or download streaming optimization

## Approved Approach

Add a small HTTP reverse proxy inside `apps/server` with two entry points:

- `GET /api/proxy/http?url=http://127.0.0.1:3000/`
- `GET /proxy/http?url=http://127.0.0.1:3000/&token=test123`

`/api/proxy/http` is for programmatic access and keeps the existing `Authorization: Bearer <token>` model.

`/proxy/http` is for direct browser access and accepts `token` as a query parameter so a mobile browser can open the proxied page without custom headers.

## Options Considered

### 1. Integrate local HTTP proxy into the existing server

Chosen.

Pros:

- Reuses the existing tunnel and auth model
- No extra tunnel or port exposure is required
- Keeps the feature under the same remote domain
- Works for simple local websites immediately

Cons:

- Requires careful header filtering and URL rewriting
- Does not fully support complex app runtimes in the first version

### 2. Open a separate tunnel for the target site

Rejected for this task.

Pros:

- Minimal implementation complexity

Cons:

- Creates a second public entrypoint
- Does not leverage CodeRemote itself
- Harder to manage consistently from the existing product

### 3. Full dev-proxy compatibility with HMR and WebSocket forwarding

Rejected for the first version.

Pros:

- Better support for modern frontend dev servers

Cons:

- Much larger implementation scope
- Requires WebSocket upgrade forwarding and more aggressive content rewriting

## Access Model

The proxy will accept any valid existing CodeRemote token:

- admin token
- configured tester token

Rules:

- `/api/proxy/http` requires `Authorization: Bearer <token>`
- `/proxy/http` requires `token=<token>` in the query string
- invalid or missing token returns `401`

This keeps proxy access aligned with the current authentication model and avoids introducing a second credential system.

## Target Restrictions

To prevent open-proxy behavior, the first version only allows:

- `http://127.0.0.1:<port>/...`
- `http://localhost:<port>/...`

Rejected targets:

- any non-HTTP protocol
- HTTPS targets
- private LAN IPs other than loopback
- arbitrary public hosts

This keeps the feature focused on “view a local site from the phone” and avoids exposing arbitrary internal or external destinations through the CodeRemote server.

## Request Handling

Supported methods:

- `GET`
- `HEAD`

Unsupported methods:

- `POST`
- `PUT`
- `PATCH`
- `DELETE`

The server will:

1. Validate auth.
2. Validate the target URL.
3. Fetch the local target from the desktop machine.
4. Return the upstream status code.
5. Forward a filtered subset of response headers.
6. Rewrite redirect and document links when required.

## Response Forwarding

For non-HTML and non-CSS responses:

- stream the response body back to the client
- preserve the upstream status code
- preserve useful response headers where safe

Hop-by-hop or connection-level headers must not be forwarded, including:

- `connection`
- `keep-alive`
- `transfer-encoding`
- `upgrade`
- `proxy-authenticate`
- `proxy-authorization`
- `te`
- `trailer`

The proxy should also avoid blindly forwarding stale `content-length` and `content-encoding` values after body rewriting.

## URL Rewriting

Because the phone browser is loading content from the CodeRemote domain rather than from `127.0.0.1`, some links must be rewritten.

### Redirects

If the target returns a `Location` header:

- resolve it relative to the current target URL
- if the resolved URL is still an allowed local target, rewrite it back into the proxy route
- preserve the browser-mode `token` query parameter for `/proxy/http`

### HTML Documents

For `text/html` responses, minimally rewrite:

- `a[href]`
- `img[src]`
- `script[src]`
- `link[href]`
- inline `<style>` blocks

Only links that resolve back to allowed local targets are rewritten. External public links remain unchanged.

### CSS

For `text/css` responses, rewrite:

- `url(...)`
- `@import`

This is needed because relative CSS asset URLs would otherwise resolve against the CodeRemote proxy path instead of the original local site path.

## Errors

Expected error mapping:

- `400` missing `url`
- `400` invalid URL
- `403` disallowed target host or protocol
- `405` unsupported method
- `502` local target connection failure
- `504` target timeout

Error bodies should be short and machine-readable for the API route. The direct browser route may reuse the same JSON response for simplicity.

## Testing Plan

### Unit tests

- loopback target validation
- proxy URL generation for browser and API routes
- `Location` rewrite behavior
- HTML attribute rewrite behavior
- CSS rewrite behavior

### Manual tests

1. Run a simple local HTTP site on port `3000`.
2. Open:
   - `http://localhost:8085/proxy/http?url=http://127.0.0.1:3000/&token=test123`
3. Confirm the page loads through CodeRemote locally.
4. Open:
   - `https://acropetal-nonfalteringly-ruben.ngrok-free.dev/proxy/http?url=http://127.0.0.1:3000/&token=test123`
5. Confirm the same page loads from the phone browser.
6. Confirm relative CSS, images, scripts, and page links still resolve.

## Implementation Plan

1. Add a dedicated proxy helper module for URL validation and content rewriting.
2. Add `/api/proxy/http` and `/proxy/http` routing in the server.
3. Extend HTTP auth parsing to optionally accept query-token auth for browser proxy mode only.
4. Forward local HTTP responses with filtered headers and timeout handling.
5. Rewrite HTML, CSS, and redirect targets for allowed local URLs.
6. Add unit tests for rewrite and validation helpers.
7. Validate locally and through the ngrok domain.
