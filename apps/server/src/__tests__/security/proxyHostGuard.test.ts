import { isLoopbackHost, assertLoopbackHost, ProxyHostGuardError } from '../../security/proxyHostGuard';

describe('isLoopbackHost', () => {
  it('accepts localhost', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('LocalHost')).toBe(true);
  });

  it('accepts the full IPv4 loopback range 127.0.0.0/8', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.255.255.254')).toBe(true);
  });

  it('accepts IPv6 loopback ::1', () => {
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
  });

  it('rejects 0.0.0.0', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });

  it('rejects link-local 169.254.x.x', () => {
    expect(isLoopbackHost('169.254.169.254')).toBe(false); // AWS metadata
  });

  it('rejects RFC1918 private ranges', () => {
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
    expect(isLoopbackHost('172.16.0.1')).toBe(false);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
  });

  it('rejects CGN 100.64.0.0/10', () => {
    expect(isLoopbackHost('100.64.0.1')).toBe(false);
  });

  it('rejects public IPs', () => {
    expect(isLoopbackHost('8.8.8.8')).toBe(false);
    expect(isLoopbackHost('1.1.1.1')).toBe(false);
  });

  it('rejects IPv6 ULA fc00::/7 and link-local fe80::/10', () => {
    expect(isLoopbackHost('fc00::1')).toBe(false);
    expect(isLoopbackHost('fd00::1')).toBe(false);
    expect(isLoopbackHost('fe80::1')).toBe(false);
  });

  it('rejects IPv6 multicast ff00::/8', () => {
    expect(isLoopbackHost('ff02::1')).toBe(false);
  });

  it('rejects arbitrary hostnames (no DNS resolution)', () => {
    expect(isLoopbackHost('attacker.example.com')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
  });

  it('rejects empty strings and malformed inputs', () => {
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost('127.0.0')).toBe(false);
    expect(isLoopbackHost('999.0.0.1')).toBe(false);
  });
});

describe('assertLoopbackHost', () => {
  it('does not throw for loopback targets', () => {
    expect(() => assertLoopbackHost('127.0.0.1')).not.toThrow();
    expect(() => assertLoopbackHost('localhost')).not.toThrow();
  });

  it('throws ProxyHostGuardError for non-loopback targets', () => {
    expect(() => assertLoopbackHost('8.8.8.8')).toThrow(ProxyHostGuardError);
  });
});
