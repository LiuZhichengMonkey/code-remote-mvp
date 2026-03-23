export type Provider = 'claude' | 'codex';

export const DEFAULT_PROVIDER: Provider = 'claude';
export const SUPPORTED_PROVIDERS: Provider[] = ['claude', 'codex'];

export interface ProviderProjectRef {
  provider: Provider;
  projectKey: string;
}

export function isProvider(value: string | undefined | null): value is Provider {
  return value === 'claude' || value === 'codex';
}

export function normalizeProvider(value: string | undefined | null): Provider {
  return isProvider(value) ? value : DEFAULT_PROVIDER;
}

export function pathToProjectKey(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);

  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const pathPart = driveMatch[2].replace(/\//g, '-');
    return `${drive}--${pathPart}`;
  }

  if (normalized.startsWith('/')) {
    return normalized.substring(1).replace(/\//g, '-');
  }

  return normalized.replace(/[:/]/g, '-');
}

export function projectKeyToPath(projectKey: string): string {
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

  if (!projectKey) {
    return null;
  }

  return {
    provider,
    projectKey
  };
}
