import type { IncomingMessage } from 'http';
import { verifyOrigin } from '../../security/originGuard';

function makeReq(opts: { origin?: string; upgrade?: string }): IncomingMessage {
  const headers: Record<string, string | undefined> = {
    origin: opts.origin,
    upgrade: opts.upgrade
  };
  return { headers } as IncomingMessage;
}

describe('verifyOrigin', () => {
  it('always allows when allowedOrigins is empty (default)', () => {
    const req = makeReq({ origin: 'https://evil.com', upgrade: 'websocket' });
    expect(verifyOrigin(req, { allowedOrigins: [] }).allowed).toBe(true);
  });

  it('rejects websocket upgrades whose origin is not in the allow-list', () => {
    const req = makeReq({ origin: 'https://evil.com', upgrade: 'websocket' });
    const result = verifyOrigin(req, {
      allowedOrigins: ['https://app.example.com']
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/evil\.com/);
  });

  it('rejects websocket upgrades with no origin header', () => {
    const req = makeReq({ upgrade: 'websocket' });
    const result = verifyOrigin(req, {
      allowedOrigins: ['https://app.example.com']
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it('accepts a matching origin (case-insensitive, trailing slash tolerant)', () => {
    const req = makeReq({ origin: 'HTTPS://App.Example.com/', upgrade: 'websocket' });
    const result = verifyOrigin(req, {
      allowedOrigins: ['https://app.example.com']
    });
    expect(result.allowed).toBe(true);
  });

  it('ignores non-websocket requests even when origin is hostile', () => {
    const req = makeReq({ origin: 'https://evil.com' });
    // No `upgrade` header -> treated as a regular HTTP request
    const result = verifyOrigin(req, {
      allowedOrigins: ['https://app.example.com']
    });
    expect(result.allowed).toBe(true);
  });
});
