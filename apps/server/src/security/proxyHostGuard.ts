import net from 'net';

const ALLOWED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

function isPrivateIpv4OctetRange(value: number, lower: number, upper: number): boolean {
  return value >= lower && value <= upper;
}

/**
 * Check whether an IPv4 octet is part of a forbidden range:
 * - 0.0.0.0/8       (this network)
 * - 169.254.0.0/16   (link-local)
 * - 10.0.0.0/8       (private)
 * - 172.16.0.0/12    (private)
 * - 192.168.0.0/16   (private)
 * - 100.64.0.0/10    (CGN)
 * - 192.0.0.0/24     (IETF protocol assignments)
 * - 192.0.2.0/24     (TEST-NET-1)
 * - 198.18.0.0/15    (benchmarking)
 * - 198.51.100.0/24  (TEST-NET-2)
 * - 203.0.113.0/24   (TEST-NET-3)
 * - 224.0.0.0/4      (multicast)
 * - 240.0.0.0/4      (reserved)
 */
function isForbiddenIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return true; // malformed
  }
  const octets = parts.map(part => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
  });
  if (octets.some(o => o === null)) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return true;
  if (a === 127) return false; // 127.0.0.0/8 — loopback, allowed
  if (a === 169 && b === 254) return true;
  if (a === 10) return true;
  if (a === 172 && isPrivateIpv4OctetRange(b, 16, 31)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && isPrivateIpv4OctetRange(b, 64, 127)) return true;
  if (a === 192 && b === 0 && octets[2] === 0) return true;
  if (a === 192 && b === 0 && octets[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (isPrivateIpv4OctetRange(a, 224, 255)) return true;

  return false;
}

/**
 * Decide whether the given hostname is a safe loopback target.
 *
 * Allowed: `localhost`, `127.0.0.0/8`, `::1/128`.
 * Rejected: every other IP (including `0.0.0.0`, link-local, private
 * networks, ULA, multicast, reserved ranges) and unresolvable names.
 */
export function isLoopbackHost(hostname: string): boolean {
  if (!hostname) {
    return false;
  }

  const lower = hostname.toLowerCase();
  if (ALLOWED_HOSTNAMES.has(lower)) {
    return true;
  }

  // Reject obvious IPv6 zones / brackets early.
  const stripped = lower.replace(/^\[|\]$/g, '');

  // IPv6: must be a loopback address. We accept `::1` only.
  if (stripped.includes(':')) {
    if (stripped === '::1') {
      return true;
    }
    // Reject ULA (fc00::/7), link-local (fe80::/10), multicast (ff00::/8),
    // and everything else.
    if (stripped.startsWith('fc') || stripped.startsWith('fd')) return false;
    if (stripped.startsWith('fe8') || stripped.startsWith('fe9')
        || stripped.startsWith('fea') || stripped.startsWith('feb')) return false;
    if (stripped.startsWith('ff')) return false;
    return false;
  }

  // IPv4 — fast path for the loopback range.
  if (stripped.startsWith('127.') && net.isIPv4(stripped)) {
    return true;
  }

  if (net.isIPv4(stripped)) {
    return !isForbiddenIpv4(stripped);
  }

  // Not an IP literal — refuse to resolve. Loopback must be specified
  // numerically (or as `localhost`) to avoid DNS-rebinding attacks.
  return false;
}

/**
 * Throwing variant for use at API boundaries.
 */
export class ProxyHostGuardError extends Error {
  code: 'PROXY_FORBIDDEN_HOST' = 'PROXY_FORBIDDEN_HOST';
  constructor(message: string) {
    super(message);
  }
}

export function assertLoopbackHost(hostname: string): void {
  if (!isLoopbackHost(hostname)) {
    throw new ProxyHostGuardError(
      `Only loopback targets are allowed (got "${hostname}")`
    );
  }
}
