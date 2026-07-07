import type { IncomingMessage } from 'http';

export interface OriginGuardOptions {
  /**
   * Whitelist of allowed `Origin` header values. When the list is empty the
   * guard is a no-op (this is the default — the mobile app and CLI clients
   * do not always send an Origin header).
   *
   * Values are matched case-insensitively and ignore trailing `/`.
   */
  allowedOrigins: string[];
}

export interface OriginGuardResult {
  allowed: boolean;
  reason?: string;
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers.upgrade;
  if (typeof upgrade !== 'string') {
    return false;
  }
  return upgrade.toLowerCase() === 'websocket';
}

/**
 * Decide whether the incoming request's `Origin` header is allowed.
 *
 * Behaviour:
 * - If `allowedOrigins` is empty the guard always allows. This is the
 *   default so existing local/mobile deployments are not broken.
 * - If `allowedOrigins` is non-empty, an `Origin` header is required and
 *   must appear in the whitelist.
 * - Non-WebSocket requests (e.g. regular HTTP to /api/...) are always
 *   allowed here. The token-based access control layer handles auth.
 */
export function verifyOrigin(
  req: IncomingMessage,
  options: OriginGuardOptions
): OriginGuardResult {
  if (options.allowedOrigins.length === 0) {
    return { allowed: true };
  }

  // Only WebSocket upgrade requests are subject to Origin enforcement.
  if (!isWebSocketUpgrade(req)) {
    return { allowed: true };
  }

  const rawOrigin = req.headers.origin;
  if (!rawOrigin || typeof rawOrigin !== 'string') {
    return { allowed: false, reason: 'Missing Origin header' };
  }

  const normalized = normalizeOrigin(rawOrigin);
  const whitelist = new Set(options.allowedOrigins.map(normalizeOrigin));

  if (!whitelist.has(normalized)) {
    return { allowed: false, reason: `Origin ${rawOrigin} not in allow-list` };
  }

  return { allowed: true };
}
