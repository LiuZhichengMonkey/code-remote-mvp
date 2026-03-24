import fs from 'fs';
import path from 'path';
import { normalizeTestTokenConfigs, TestTokenConfig } from './accessControl';

export interface ProviderBootstrapConfig {
  enabled: boolean;
  cliCommand: string;
  baseUrl?: string;
  authToken?: string;
  model?: string;
}

export interface RepoRuntimeConfig {
  server: {
    port: number;
    token: string;
    workspaceRoot: string;
    testTokens: TestTokenConfig[];
  };
  ui: {
    openBrowserOnStart: boolean;
  };
  tunnel: {
    mode: string;
    ngrokPath?: string;
    customPublicWsUrl?: string;
  };
  providers: {
    claude: ProviderBootstrapConfig;
    codex: ProviderBootstrapConfig;
  };
  paths: {
    logsDir: string;
    uploadsDir: string;
  };
  autostart: {
    taskName: string;
    openBrowserOnLogin: boolean;
    startMinimized: boolean;
  };
}

const DEFAULT_PROVIDER_CONFIG: ProviderBootstrapConfig = {
  enabled: true,
  cliCommand: '',
  baseUrl: '',
  authToken: '',
  model: ''
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeProviderConfig(value: unknown): ProviderBootstrapConfig {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PROVIDER_CONFIG };
  }

  const input = value as Record<string, unknown>;
  return {
    enabled: asBoolean(input.enabled, DEFAULT_PROVIDER_CONFIG.enabled),
    cliCommand: asString(input.cliCommand, DEFAULT_PROVIDER_CONFIG.cliCommand),
    baseUrl: asString(input.baseUrl),
    authToken: asString(input.authToken),
    model: asString(input.model)
  };
}

export function loadRepoRuntimeConfig(filePath: string): RepoRuntimeConfig {
  const resolvedPath = path.resolve(filePath);
  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = JSON.parse(stripBom(raw)) as Record<string, unknown>;

  const server = parsed.server && typeof parsed.server === 'object'
    ? parsed.server as Record<string, unknown>
    : {};
  const ui = parsed.ui && typeof parsed.ui === 'object'
    ? parsed.ui as Record<string, unknown>
    : {};
  const tunnel = parsed.tunnel && typeof parsed.tunnel === 'object'
    ? parsed.tunnel as Record<string, unknown>
    : {};
  const providers = parsed.providers && typeof parsed.providers === 'object'
    ? parsed.providers as Record<string, unknown>
    : {};
  const paths = parsed.paths && typeof parsed.paths === 'object'
    ? parsed.paths as Record<string, unknown>
    : {};
  const autostart = parsed.autostart && typeof parsed.autostart === 'object'
    ? parsed.autostart as Record<string, unknown>
    : {};

  return {
    server: {
      port: asNumber(server.port, 8085),
      token: asString(server.token, ''),
      workspaceRoot: asString(server.workspaceRoot, ''),
      testTokens: normalizeTestTokenConfigs(server.testTokens)
    },
    ui: {
      openBrowserOnStart: asBoolean(ui.openBrowserOnStart, true)
    },
    tunnel: {
      mode: asString(tunnel.mode, 'disabled'),
      ngrokPath: asString(tunnel.ngrokPath),
      customPublicWsUrl: asString(tunnel.customPublicWsUrl)
    },
    providers: {
      claude: normalizeProviderConfig(providers.claude),
      codex: normalizeProviderConfig(providers.codex)
    },
    paths: {
      logsDir: asString(paths.logsDir, './runtime/logs'),
      uploadsDir: asString(paths.uploadsDir, './runtime/uploads')
    },
    autostart: {
      taskName: asString(autostart.taskName, 'CodeRemote'),
      openBrowserOnLogin: asBoolean(autostart.openBrowserOnLogin, false),
      startMinimized: asBoolean(autostart.startMinimized, true)
    }
  };
}
