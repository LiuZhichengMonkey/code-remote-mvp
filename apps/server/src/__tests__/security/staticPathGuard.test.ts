import path from 'path';
import { safeJoinStatic } from '../../security/staticPathGuard';

describe('safeJoinStatic', () => {
  const root = path.resolve('/var/www/static');

  it('returns the root for the index request', () => {
    expect(safeJoinStatic(root, '/')).toBe(root);
    expect(safeJoinStatic(root, '')).toBeNull();
  });

  it('resolves nested file paths inside the root', () => {
    const expected = path.resolve(root, 'assets/app.js');
    expect(safeJoinStatic(root, '/assets/app.js')).toBe(expected);
  });

  it('accepts Windows-style backslashes on the input side', () => {
    const expected = path.resolve(root, 'assets/app.js');
    expect(safeJoinStatic(root, '\\assets\\app.js')).toBe(expected);
  });

  it('rejects path traversal via ".."', () => {
    expect(safeJoinStatic(root, '/../package.json')).toBeNull();
    expect(safeJoinStatic(root, '/assets/../../etc/passwd')).toBeNull();
  });

  it('rejects absolute Windows paths mixed into the request', () => {
    expect(safeJoinStatic(root, '/C:/Windows/System32/cmd.exe')).toBeNull();
  });

  it('rejects NUL byte injection', () => {
    expect(safeJoinStatic(root, '/foo\0bar.js')).toBeNull();
  });

  it('rejects when the static root is empty', () => {
    expect(safeJoinStatic('', '/foo.js')).toBeNull();
  });

  it('rejects when the request path is non-string or empty', () => {
    expect(safeJoinStatic(root, null)).toBeNull();
    expect(safeJoinStatic(root, undefined)).toBeNull();
  });
});
