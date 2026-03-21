import {
  decodeProjectId,
  encodeProjectId,
  normalizeProvider,
  projectKeyToPath,
  pathToProjectKey
} from '../session/provider';

describe('provider helpers', () => {
  test('pathToProjectKey preserves the current workspace key format', () => {
    const projectPath = 'E:/code-remote-mvp';
    expect(pathToProjectKey(projectPath)).toBe('E--code-remote-mvp');
  });

  test('projectKeyToPath round trips clean paths without literal hyphens', () => {
    const projectPath = 'E:/coderemote/mvp';
    const key = pathToProjectKey(projectPath);

    expect(key).toBe('E--coderemote-mvp');
    expect(projectKeyToPath(key)).toBe(projectPath);
  });

  test('encode and decode project id preserves provider', () => {
    const projectId = encodeProjectId('codex', 'E--code-remote-mvp');

    expect(projectId).toBe('codex:E--code-remote-mvp');
    expect(decodeProjectId(projectId)).toEqual({
      provider: 'codex',
      projectKey: 'E--code-remote-mvp'
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
});
