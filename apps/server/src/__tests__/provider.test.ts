import {
  decodeProjectId,
  encodeProjectId,
  isProvider,
  normalizeProvider,
  projectKeyToPath,
  pathToProjectKey
} from '../session/provider';

describe('provider helpers', () => {
  test('pathToProjectKey round trips hyphenated paths', () => {
    const projectPath = 'E:/code-remote-mvp/sub-folder';
    const key = pathToProjectKey(projectPath);

    expect(key).toMatch(/^v2~/);
    expect(projectKeyToPath(key)).toBe(projectPath);
  });

  test('projectKeyToPath keeps legacy ids working', () => {
    expect(projectKeyToPath('E--code-remote-mvp')).toBe('E:/code/remote/mvp');
  });

  test('encode and decode project id preserves provider', () => {
    const projectKey = pathToProjectKey('E:/code-remote-mvp');
    const projectId = encodeProjectId('codex', projectKey);

    expect(projectId).toBe(`codex:${projectKey}`);
    expect(decodeProjectId(projectId)).toEqual({
      provider: 'codex',
      projectKey
    });
  });

  test('decode falls back to default provider for legacy ids', () => {
    expect(decodeProjectId('E--legacy-project')).toEqual({
      provider: 'claude',
      projectKey: 'E--legacy-project'
    });
  });

  test('normalizeProvider defaults invalid values to claude', () => {
    expect(normalizeProvider('codex')).toBe('codex');
    expect(normalizeProvider('nope')).toBe('claude');
    expect(normalizeProvider(undefined)).toBe('claude');
  });

  test('rejects removed provider-prefixed project ids', () => {
    expect(isProvider('deerflow')).toBe(false);
    expect(decodeProjectId('deerflow:v2~abc')).toBeNull();
  });
});
