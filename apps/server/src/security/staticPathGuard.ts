import path from 'path';

/**
 * Resolve a request path against a static root and reject path traversal.
 *
 * Returns the safe absolute path on success, or `null` when:
 * - The request path is empty
 * - The request path contains NUL bytes
 * - The request path tries to escape the root (e.g. `..`, absolute paths,
 *   symlink-resolved paths that fall outside the root)
 *
 * Behaviour notes:
 * - On Windows the result is normalised via `path.resolve`; both `\` and `/`
 *   separators in the input are accepted.
 * - The comparison uses `path.relative` to detect escape; a relative value
 *   starting with `..` or being absolute is considered escape.
 * - This function does NOT touch the filesystem; callers may follow up with
 *   `existsSync`/`statSync` to verify the file is present.
 */
export function safeJoinStatic(
  staticRoot: string,
  requestPath: string | null | undefined
): string | null {
  if (!staticRoot) {
    return null;
  }

  if (typeof requestPath !== 'string' || requestPath.length === 0) {
    return null;
  }

  // Reject NUL bytes — they can truncate paths in low-level C calls.
  if (requestPath.indexOf('\0') !== -1) {
    return null;
  }

  // Normalize the request path. Allow both `/` and `\` as separators so that
  // Windows-style backslashes don't slip past. Treat the root `/` as index.html.
  const normalizedRequest = requestPath.replace(/\\/g, '/');

  // Strip the leading slash so `path.resolve(staticRoot, '/foo')` doesn't
  // discard the root.
  const stripped = normalizedRequest.replace(/^\/+/, '');

  // Allow the explicit root.
  if (stripped === '' || stripped === '/') {
    return staticRoot;
  }

  const resolvedRoot = path.resolve(staticRoot);
  const resolvedTarget = path.resolve(resolvedRoot, stripped);

  // Verify the target is contained inside the root.
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === '') {
    return resolvedRoot;
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolvedTarget;
}
