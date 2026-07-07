export type Provider = 'claude' | 'codex';

export const DEFAULT_PROVIDER: Provider = 'claude';
export const SUPPORTED_PROVIDERS: Provider[] = ['claude', 'codex'];

export interface ProviderProjectRef {
  provider: Provider;
  projectKey: string;
}

const PROJECT_KEY_PREFIX = 'v2~';

function encodeProjectPath(projectPath: string): string {
  return Buffer.from(projectPath, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeProjectPath(encodedPath: string): string | null {
  try {
    const base64 = encodedPath.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    return Buffer.from(base64 + padding, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function isProvider(value: string | undefined | null): value is Provider {
  return value === 'claude' || value === 'codex';
}

export function normalizeProvider(value: string | undefined | null): Provider {
  return isProvider(value) ? value : DEFAULT_PROVIDER;
}

export function pathToProjectKey(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/');
  return `${PROJECT_KEY_PREFIX}${encodeProjectPath(normalized)}`;
}

export function projectKeyToPath(projectKey: string): string {
  if (projectKey.startsWith(PROJECT_KEY_PREFIX)) {
    const decodedPath = decodeProjectPath(projectKey.substring(PROJECT_KEY_PREFIX.length));
    if (decodedPath !== null) {
      return decodedPath;
    }
  }

  const driveMatch = projectKey.match(/^([A-Z])--(.*)$/);

  if (driveMatch) {
    const drive = driveMatch[1];
    const pathPart = driveMatch[2].replace(/-/g, '/');
    return `${drive}:/${pathPart}`;
  }

  return '/' + projectKey.replace(/-/g, '/');
}

export function encodeProjectId(provider: Provider, projectKey: string): string {
  return `${provider}:${projectKey}`;
}

export function decodeProjectId(projectId: string | undefined | null): ProviderProjectRef | null {
  if (!projectId) {
    return null;
  }

  const separatorIndex = projectId.indexOf(':');
  if (separatorIndex === -1) {
    return {
      provider: DEFAULT_PROVIDER,
      projectKey: projectId
    };
  }

  const provider = normalizeProvider(projectId.substring(0, separatorIndex));
  const projectKey = projectId.substring(separatorIndex + 1);

  if (!isProvider(projectId.substring(0, separatorIndex)) || !projectKey) {
    return null;
  }

  return {
    provider,
    projectKey
  };
}
