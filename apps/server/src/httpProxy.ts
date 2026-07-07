export type ProxyRouteKind = 'api' | 'browser';

export interface ProxyLinkOptions {
  routeKind: ProxyRouteKind;
  token?: string;
}

export type LocalHttpProxyErrorCode =
  | 'PROXY_MISSING_URL'
  | 'PROXY_INVALID_URL'
  | 'PROXY_UNSUPPORTED_PROTOCOL'
  | 'PROXY_FORBIDDEN_HOST';

const ALLOWED_PROXY_HOSTS = new Set(['127.0.0.1', 'localhost']);
const NON_PROXY_SCHEMES = ['about:', 'data:', 'javascript:', 'mailto:', 'tel:'];
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export class LocalHttpProxyError extends Error {
  code: LocalHttpProxyErrorCode;

  constructor(code: LocalHttpProxyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function isAllowedLocalProxyTarget(targetUrl: URL): boolean {
  return targetUrl.protocol === 'http:' && ALLOWED_PROXY_HOSTS.has(targetUrl.hostname);
}

export function assertAllowedLocalProxyTarget(rawUrl?: string | null): URL {
  const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmedUrl) {
    throw new LocalHttpProxyError('PROXY_MISSING_URL', 'Missing url');
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(trimmedUrl);
  } catch {
    throw new LocalHttpProxyError('PROXY_INVALID_URL', 'Invalid url');
  }

  if (targetUrl.protocol !== 'http:') {
    throw new LocalHttpProxyError('PROXY_UNSUPPORTED_PROTOCOL', 'Only http://localhost and http://127.0.0.1 targets are supported');
  }

  if (!ALLOWED_PROXY_HOSTS.has(targetUrl.hostname)) {
    throw new LocalHttpProxyError('PROXY_FORBIDDEN_HOST', 'Only localhost loopback targets are allowed');
  }

  return targetUrl;
}

export function buildProxyRequestPath(targetUrl: URL, options: ProxyLinkOptions): string {
  const urlForQuery = new URL(targetUrl.toString());
  const fragment = urlForQuery.hash;
  urlForQuery.hash = '';

  const searchParams = new URLSearchParams({
    url: urlForQuery.toString()
  });

  if (options.routeKind === 'browser' && options.token) {
    searchParams.set('token', options.token);
  }

  const routePath = options.routeKind === 'browser'
    ? '/proxy/http'
    : '/api/proxy/http';

  return `${routePath}?${searchParams.toString()}${fragment}`;
}

function shouldLeaveLinkUntouched(rawValue: string): boolean {
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized || normalized.startsWith('#')) {
    return true;
  }

  return NON_PROXY_SCHEMES.some(prefix => normalized.startsWith(prefix));
}

function rewriteLinkValue(rawValue: string, baseUrl: URL, options: ProxyLinkOptions): string {
  if (shouldLeaveLinkUntouched(rawValue)) {
    return rawValue;
  }

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(rawValue, baseUrl);
  } catch {
    return rawValue;
  }

  if (!isAllowedLocalProxyTarget(resolvedUrl)) {
    return rawValue;
  }

  return buildProxyRequestPath(resolvedUrl, options);
}

function rewriteQuotedAttributes(
  content: string,
  pattern: RegExp,
  baseUrl: URL,
  options: ProxyLinkOptions
): string {
  return content.replace(pattern, (_match, prefix: string, quote: string, value: string) => (
    `${prefix}${quote}${rewriteLinkValue(value, baseUrl, options)}${quote}`
  ));
}

function rewriteUnquotedAttributes(
  content: string,
  pattern: RegExp,
  baseUrl: URL,
  options: ProxyLinkOptions
): string {
  return content.replace(pattern, (_match, prefix: string, value: string) => (
    `${prefix}${rewriteLinkValue(value, baseUrl, options)}`
  ));
}

function rewriteSrcsetValue(rawValue: string, baseUrl: URL, options: ProxyLinkOptions): string {
  if (/\bdata:/i.test(rawValue)) {
    return rawValue;
  }

  return rawValue.split(',').map((candidate) => {
    const leading = candidate.match(/^\s*/)?.[0] || '';
    const trailing = candidate.match(/\s*$/)?.[0] || '';
    const trimmed = candidate.trim();
    if (!trimmed) {
      return candidate;
    }

    const [url, ...descriptors] = trimmed.split(/\s+/);
    const rewrittenUrl = rewriteLinkValue(url, baseUrl, options);
    return `${leading}${rewrittenUrl}${descriptors.length > 0 ? ` ${descriptors.join(' ')}` : ''}${trailing}`;
  }).join(',');
}

function rewriteSrcsetAttributes(content: string, baseUrl: URL, options: ProxyLinkOptions): string {
  return content.replace(
    /(<(?:img|source)\b[^>]*?\bsrcset\s*=\s*)(["'])([^"']+)\2/gi,
    (_match, prefix: string, quote: string, value: string) => (
      `${prefix}${quote}${rewriteSrcsetValue(value, baseUrl, options)}${quote}`
    )
  );
}

function rewriteStyleAttributes(content: string, baseUrl: URL, options: ProxyLinkOptions): string {
  return content.replace(
    /(\bstyle\s*=\s*)(["'])([\s\S]*?)\2/gi,
    (_match, prefix: string, quote: string, value: string) => (
      `${prefix}${quote}${rewriteCssForProxy(value, baseUrl, options)}${quote}`
    )
  );
}

export function rewriteCssForProxy(
  css: string,
  baseUrl: URL,
  options: ProxyLinkOptions
): string {
  const rewrittenUrls = css.replace(
    /url\(\s*(?:(['"])(.*?)\1|([^'")\s][^)]*))\s*\)/gi,
    (_match, quotedValueDelimiter: string | undefined, quotedValue: string | undefined, unquotedValue: string | undefined) => {
      const rawValue = (quotedValueDelimiter ? quotedValue : unquotedValue) || '';
      const rewrittenValue = rewriteLinkValue(rawValue, baseUrl, options);
      if (quotedValueDelimiter) {
        return `url(${quotedValueDelimiter}${rewrittenValue}${quotedValueDelimiter})`;
      }

      return `url(${rewrittenValue})`;
    }
  );

  return rewrittenUrls
    .replace(
      /@import\s+(?:url\(\s*)?(['"])(.*?)\1\s*\)?/gi,
      (_match, quote: string, value: string) => `@import url(${quote}${rewriteLinkValue(value, baseUrl, options)}${quote})`
    )
    .replace(
      /@import\s+url\(\s*([^'")\s][^)]*)\s*\)/gi,
      (_match, value: string) => `@import url(${rewriteLinkValue(value, baseUrl, options)})`
    );
}

export function rewriteHtmlForProxy(
  html: string,
  baseUrl: URL,
  options: ProxyLinkOptions
): string {
  const rewritePatterns = [
    /(<(?:a|img|source|script|link)\b[^>]*?\b(?:href|src)\s*=\s*)(["'])([^"']+)\2/gi,
    /(<(?:a|img|source|script|link)\b[^>]*?\b(?:href|src)\s*=\s*)([^"'`\s>]+)/gi
  ] as const;

  let rewrittenHtml = rewriteQuotedAttributes(html, rewritePatterns[0], baseUrl, options);
  rewrittenHtml = rewriteUnquotedAttributes(rewrittenHtml, rewritePatterns[1], baseUrl, options);
  rewrittenHtml = rewriteSrcsetAttributes(rewrittenHtml, baseUrl, options);
  rewrittenHtml = rewriteStyleAttributes(rewrittenHtml, baseUrl, options);

  return rewrittenHtml.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (_match, attributes: string, cssContent: string) => (
      `<style${attributes}>${rewriteCssForProxy(cssContent, baseUrl, options)}</style>`
    )
  );
}

export function rewriteProxyLocation(
  rawLocation: string,
  baseUrl: URL,
  options: ProxyLinkOptions
): string {
  return rewriteLinkValue(rawLocation, baseUrl, options);
}

export function filterProxyResponseHeaders(
  responseHeaders: Headers,
  options?: {
    rewrittenLocation?: string;
  }
): Record<string, string | string[]> {
  const filteredHeaders: Record<string, string | string[]> = {};

  for (const [headerName, headerValue] of responseHeaders.entries()) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (
      HOP_BY_HOP_RESPONSE_HEADERS.has(normalizedHeaderName)
      || normalizedHeaderName === 'location'
      || normalizedHeaderName === 'set-cookie'
    ) {
      continue;
    }

    filteredHeaders[headerName] = headerValue;
  }

  if (options?.rewrittenLocation) {
    filteredHeaders.Location = options.rewrittenLocation;
  }

  const getSetCookie = (responseHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = typeof getSetCookie === 'function'
    ? getSetCookie.call(responseHeaders)
    : [];
  if (setCookies.length > 0) {
    filteredHeaders['Set-Cookie'] = setCookies;
  }

  return filteredHeaders;
}
