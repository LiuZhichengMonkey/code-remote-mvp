import {
  assertAllowedLocalProxyTarget,
  buildProxyRequestPath,
  LocalHttpProxyError,
  rewriteCssForProxy,
  rewriteHtmlForProxy,
  rewriteProxyLocation
} from '../httpProxy';

describe('httpProxy helpers', () => {
  test('accepts localhost and loopback http targets only', () => {
    expect(assertAllowedLocalProxyTarget('http://127.0.0.1:3000/').toString()).toBe('http://127.0.0.1:3000/');
    expect(assertAllowedLocalProxyTarget('http://localhost:8080/test').toString()).toBe('http://localhost:8080/test');

    expect(() => assertAllowedLocalProxyTarget('https://127.0.0.1:3000/')).toThrow(LocalHttpProxyError);
    expect(() => assertAllowedLocalProxyTarget('http://192.168.0.2:3000/')).toThrow(LocalHttpProxyError);
  });

  test('builds browser proxy links and preserves fragments', () => {
    const targetUrl = new URL('http://127.0.0.1:3000/page?q=1#section-2');

    expect(buildProxyRequestPath(targetUrl, {
      routeKind: 'browser',
      token: 'test123'
    })).toBe('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fpage%3Fq%3D1&token=test123#section-2');
  });

  test('rewrites local redirects back through the proxy', () => {
    const location = rewriteProxyLocation('/next?step=2', new URL('http://127.0.0.1:3000/start'), {
      routeKind: 'browser',
      token: 'test123'
    });

    expect(location).toBe('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fnext%3Fstep%3D2&token=test123');
  });

  test('rewrites html resource links and keeps external links unchanged', () => {
    const html = [
      '<html><head>',
      '<link rel="stylesheet" href="/assets/app.css">',
      '<style>.hero{background-image:url("../img/hero.png")}</style>',
      '</head><body>',
      '<a href="/docs/intro.html">Docs</a>',
      '<img src="images/logo.png">',
      '<picture><source srcset="images/logo-small.png 1x, /images/logo-large.png 2x"></picture>',
      '<div style="background-image:url(\'./images/card.png\')"></div>',
      '<script src="http://127.0.0.1:3000/app.js"></script>',
      '<a href="https://example.com/docs">External</a>',
      '</body></html>'
    ].join('');

    const rewritten = rewriteHtmlForProxy(html, new URL('http://127.0.0.1:3000/guide/index.html'), {
      routeKind: 'browser',
      token: 'test123'
    });

    expect(rewritten).toContain('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fassets%2Fapp.css&token=test123');
    expect(rewritten).toContain('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fdocs%2Fintro.html&token=test123');
    expect(rewritten).toContain('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fguide%2Fimages%2Flogo.png&token=test123');
    expect(rewritten).toContain('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fguide%2Fimages%2Flogo-small.png&token=test123 1x');
    expect(rewritten).toContain('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fimages%2Flogo-large.png&token=test123 2x');
    expect(rewritten).toContain('url(\'/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fguide%2Fimages%2Fcard.png&token=test123\')');
    expect(rewritten).toContain('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fapp.js&token=test123');
    expect(rewritten).toContain('/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fimg%2Fhero.png&token=test123');
    expect(rewritten).toContain('https://example.com/docs');
  });

  test('rewrites css url and import directives', () => {
    const css = [
      '@import "./base.css";',
      '.hero { background-image: url("../img/hero.png"); }',
      '.logo { mask-image: url(/icons/logo.svg); }',
      '.inline { background-image: url("data:image/png;base64,abc"); }'
    ].join('\n');

    const rewritten = rewriteCssForProxy(css, new URL('http://127.0.0.1:3000/styles/main.css'), {
      routeKind: 'browser',
      token: 'test123'
    });

    expect(rewritten).toContain('@import url("/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fstyles%2Fbase.css&token=test123")');
    expect(rewritten).toContain('url("/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Fimg%2Fhero.png&token=test123")');
    expect(rewritten).toContain('url(/proxy/http?url=http%3A%2F%2F127.0.0.1%3A3000%2Ficons%2Flogo.svg&token=test123)');
    expect(rewritten).toContain('data:image/png;base64,abc');
  });
});
