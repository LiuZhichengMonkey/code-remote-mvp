import fs from 'fs';
import os from 'os';
import path from 'path';
import TOML from '@iarna/toml';
import { Provider } from './session/provider';

export interface RuntimeProfileSummary {
  name: string;
  provider: Provider;
  model: string;
  valueCount: number;
  baseUrl?: string;
  authTokenConfigured: boolean;
  isSaved: boolean;
}

export interface RuntimeProfileListResult {
  provider: Provider;
  profiles: RuntimeProfileSummary[];
  activeProfile: RuntimeProfileSummary | null;
  selectedProfileName: string | null;
}

export interface RuntimeProfileMutationResult {
  provider: Provider;
  activeProfile: RuntimeProfileSummary | null;
  selectedProfileName: string | null;
  message: string;
}

export interface RuntimeProfileInput {
  baseUrl?: string;
  authToken?: string;
  model?: string;
}

const CURRENT_PROFILE_NAME = 'Current configuration';
const DEFAULT_CODEX_MODEL_PROVIDER = 'openai';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ClaudeConfig {
  env?: Record<string, string>;
  model?: string;
  permissions?: {
    defaultMode?: string;
  };
  skipDangerousModePermissionPrompt?: boolean;
  [key: string]: JsonValue | Record<string, string> | { defaultMode?: string } | undefined;
}

interface CodexConfig {
  model?: string;
  model_provider?: string;
  model_providers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

interface CodexAuthConfig {
  OPENAI_API_KEY?: string;
  [key: string]: unknown;
}

function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

function getCodexDir(): string {
  return path.join(os.homedir(), '.codex');
}

function readUtf8IfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

function ensureDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeBackupIfExists(filePath: string, backupFilePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  ensureDirectory(backupFilePath);
  fs.writeFileSync(backupFilePath, fs.readFileSync(filePath, 'utf-8'), 'utf-8');
}

function countConfiguredValues(summary: Pick<RuntimeProfileSummary, 'baseUrl' | 'model' | 'authTokenConfigured'>): number {
  let count = 0;
  if (summary.baseUrl) {
    count += 1;
  }
  if (summary.model) {
    count += 1;
  }
  if (summary.authTokenConfigured) {
    count += 1;
  }
  return count;
}

function sameSummary(a: RuntimeProfileSummary | null, b: RuntimeProfileSummary | null): boolean {
  if (!a || !b) {
    return false;
  }

  return a.provider === b.provider
    && a.baseUrl === b.baseUrl
    && a.model === b.model
    && a.authTokenConfigured === b.authTokenConfigured;
}

function parseJsonObject<T>(content: string | null, fallback: T): T {
  if (!content) {
    return fallback;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

function parseClaudeConfig(content: string | null): ClaudeConfig {
  return parseJsonObject<ClaudeConfig>(content, {});
}

function summarizeClaudeConfig(content: string | null, name: string, isSaved: boolean): RuntimeProfileSummary | null {
  if (!content) {
    return null;
  }

  const config = parseClaudeConfig(content);
  const env = config.env || {};
  const model = (env.ANTHROPIC_MODEL || config.model || '').trim();
  const baseUrl = (env.ANTHROPIC_BASE_URL || '').trim() || undefined;
  const authTokenConfigured = Boolean((env.ANTHROPIC_AUTH_TOKEN || '').trim());

  const summary: RuntimeProfileSummary = {
    name,
    provider: 'claude',
    model,
    baseUrl,
    authTokenConfigured,
    isSaved,
    valueCount: 0
  };
  summary.valueCount = countConfiguredValues(summary);
  return summary;
}

function sanitizeString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildClaudeConfig(currentContent: string | null, input: RuntimeProfileInput): ClaudeConfig {
  const currentConfig = parseClaudeConfig(currentContent);
  const env = {
    ...(currentConfig.env || {})
  };

  const nextBaseUrl = sanitizeString(input.baseUrl) ?? sanitizeString(env.ANTHROPIC_BASE_URL);
  const nextAuthToken = sanitizeString(input.authToken) ?? sanitizeString(env.ANTHROPIC_AUTH_TOKEN);
  const nextModel = sanitizeString(input.model) ?? sanitizeString(env.ANTHROPIC_MODEL) ?? sanitizeString(currentConfig.model);

  if (nextBaseUrl) {
    env.ANTHROPIC_BASE_URL = nextBaseUrl;
  }
  if (nextAuthToken) {
    env.ANTHROPIC_AUTH_TOKEN = nextAuthToken;
  }
  if (nextModel) {
    env.ANTHROPIC_MODEL = nextModel;
  }

  const nextConfig: ClaudeConfig = {
    ...currentConfig,
    env,
    permissions: {
      ...(currentConfig.permissions || {}),
      defaultMode: 'bypassPermissions'
    },
    skipDangerousModePermissionPrompt: true
  };

  if (nextModel) {
    nextConfig.model = nextModel;
  } else {
    delete nextConfig.model;
  }

  return nextConfig;
}

function parseCodexConfig(content: string | null): CodexConfig {
  if (!content) {
    return {};
  }

  try {
    return TOML.parse(content) as unknown as CodexConfig;
  } catch {
    return {};
  }
}

function parseCodexAuth(content: string | null): CodexAuthConfig {
  return parseJsonObject<CodexAuthConfig>(content, {});
}

function getCodexProviderName(config: CodexConfig): string {
  return typeof config.model_provider === 'string' && config.model_provider.trim()
    ? config.model_provider.trim()
    : DEFAULT_CODEX_MODEL_PROVIDER;
}

function getCodexProviderConfig(config: CodexConfig): Record<string, unknown> {
  const providerName = getCodexProviderName(config);
  const providers = config.model_providers && typeof config.model_providers === 'object'
    ? config.model_providers
    : {};

  const providerConfig = providers[providerName];
  return providerConfig && typeof providerConfig === 'object'
    ? providerConfig
    : {};
}

function summarizeCodexConfig(
  configContent: string | null,
  authContent: string | null,
  name: string,
  isSaved: boolean
): RuntimeProfileSummary | null {
  if (!configContent && !authContent) {
    return null;
  }

  const config = parseCodexConfig(configContent);
  const auth = parseCodexAuth(authContent);
  const providerConfig = getCodexProviderConfig(config);

  const summary: RuntimeProfileSummary = {
    name,
    provider: 'codex',
    model: typeof config.model === 'string' ? config.model.trim() : '',
    baseUrl: typeof providerConfig.base_url === 'string' ? providerConfig.base_url.trim() || undefined : undefined,
    authTokenConfigured: Boolean(typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim()),
    isSaved,
    valueCount: 0
  };
  summary.valueCount = countConfiguredValues(summary);
  return summary;
}

function buildCodexConfig(currentContent: string | null, input: RuntimeProfileInput): CodexConfig {
  const currentConfig = parseCodexConfig(currentContent);
  const providerName = getCodexProviderName(currentConfig);
  const providers = currentConfig.model_providers && typeof currentConfig.model_providers === 'object'
    ? { ...currentConfig.model_providers }
    : {};
  const currentProviderConfig = getCodexProviderConfig(currentConfig);

  const nextBaseUrl = sanitizeString(input.baseUrl)
    ?? (typeof currentProviderConfig.base_url === 'string' ? currentProviderConfig.base_url.trim() || undefined : undefined);
  const nextModel = sanitizeString(input.model)
    ?? (typeof currentConfig.model === 'string' ? currentConfig.model.trim() || undefined : undefined);

  const nextProviderConfig: Record<string, unknown> = {
    ...currentProviderConfig
  };

  if (nextBaseUrl) {
    nextProviderConfig.base_url = nextBaseUrl;
  }

  providers[providerName] = nextProviderConfig;

  const nextConfig: CodexConfig = {
    ...currentConfig,
    model_provider: providerName,
    model_providers: providers
  };

  if (nextModel) {
    nextConfig.model = nextModel;
  }

  return nextConfig;
}

function buildCodexAuth(currentContent: string | null, input: RuntimeProfileInput): CodexAuthConfig {
  const currentAuth = parseCodexAuth(currentContent);
  const nextAuthToken = sanitizeString(input.authToken)
    ?? (typeof currentAuth.OPENAI_API_KEY === 'string' ? currentAuth.OPENAI_API_KEY.trim() || undefined : undefined);

  return nextAuthToken
    ? { ...currentAuth, OPENAI_API_KEY: nextAuthToken }
    : currentAuth;
}

function getCodexAuthProfilePath(settingsName: string): string {
  const suffix = settingsName.startsWith('config_')
    ? settingsName.substring('config_'.length)
    : settingsName;
  return path.join(getCodexDir(), `auth_${suffix}.json`);
}

function createListResult(
  provider: Provider,
  profiles: RuntimeProfileSummary[],
  activeProfile: RuntimeProfileSummary | null
): RuntimeProfileListResult {
  const matchedProfile = activeProfile
    ? profiles.find(profile => sameSummary(profile, activeProfile))
    : undefined;

  return {
    provider,
    profiles,
    activeProfile,
    selectedProfileName: matchedProfile?.name || null
  };
}

function getSavedClaudeProfiles(): RuntimeProfileSummary[] {
  const claudeDir = getClaudeDir();
  if (!fs.existsSync(claudeDir)) {
    return [];
  }

  return fs.readdirSync(claudeDir)
    .filter(file => file.startsWith('settings_key') && file.endsWith('.json'))
    .map(file => summarizeClaudeConfig(readUtf8IfExists(path.join(claudeDir, file)), file.replace(/\.json$/i, ''), true))
    .filter((profile): profile is RuntimeProfileSummary => profile !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getSavedCodexProfiles(): RuntimeProfileSummary[] {
  const codexDir = getCodexDir();
  if (!fs.existsSync(codexDir)) {
    return [];
  }

  return fs.readdirSync(codexDir)
    .filter(file => file.startsWith('config_key') && file.endsWith('.toml'))
    .map(file => {
      const name = file.replace(/\.toml$/i, '');
      const configContent = readUtf8IfExists(path.join(codexDir, file));
      const authContent = readUtf8IfExists(getCodexAuthProfilePath(name));
      return summarizeCodexConfig(configContent, authContent, name, true);
    })
    .filter((profile): profile is RuntimeProfileSummary => profile !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listRuntimeProfiles(provider: Provider): RuntimeProfileListResult {
  if (provider === 'codex') {
    const codexDir = getCodexDir();
    const profiles = getSavedCodexProfiles();
    const activeProfile = summarizeCodexConfig(
      readUtf8IfExists(path.join(codexDir, 'config.toml')),
      readUtf8IfExists(path.join(codexDir, 'auth.json')),
      CURRENT_PROFILE_NAME,
      false
    );
    return createListResult(provider, profiles, activeProfile);
  }

  const claudeDir = getClaudeDir();
  const profiles = getSavedClaudeProfiles();
  const activeProfile = summarizeClaudeConfig(
    readUtf8IfExists(path.join(claudeDir, 'settings.json')),
    CURRENT_PROFILE_NAME,
    false
  );
  return createListResult(provider, profiles, activeProfile);
}

export function switchRuntimeProfile(provider: Provider, settingsName: string): RuntimeProfileMutationResult {
  if (!settingsName) {
    throw new Error('Missing settingsName');
  }

  if (provider === 'codex') {
    const codexDir = getCodexDir();
    const sourcePath = path.join(codexDir, `${settingsName}.toml`);
    const targetPath = path.join(codexDir, 'config.toml');
    const authSourcePath = getCodexAuthProfilePath(settingsName);
    const authTargetPath = path.join(codexDir, 'auth.json');

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Settings file not found: ${settingsName}`);
    }

    writeBackupIfExists(targetPath, `${targetPath}.bak`);
    ensureDirectory(targetPath);
    fs.writeFileSync(targetPath, fs.readFileSync(sourcePath, 'utf-8'), 'utf-8');

    if (fs.existsSync(authSourcePath)) {
      writeBackupIfExists(authTargetPath, `${authTargetPath}.bak`);
      ensureDirectory(authTargetPath);
      fs.writeFileSync(authTargetPath, fs.readFileSync(authSourcePath, 'utf-8'), 'utf-8');
    }

    const activeProfile = summarizeCodexConfig(
      readUtf8IfExists(targetPath),
      readUtf8IfExists(authTargetPath),
      CURRENT_PROFILE_NAME,
      false
    );

    return {
      provider,
      activeProfile,
      selectedProfileName: settingsName,
      message: `Profile switched to ${settingsName}. Restart Codex CLI to apply the new configuration.`
    };
  }

  const claudeDir = getClaudeDir();
  const sourcePath = path.join(claudeDir, `${settingsName}.json`);
  const targetPath = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Settings file not found: ${settingsName}`);
  }

  writeBackupIfExists(targetPath, path.join(claudeDir, 'settings.json.backup'));
  ensureDirectory(targetPath);
  fs.writeFileSync(targetPath, fs.readFileSync(sourcePath, 'utf-8'), 'utf-8');

  const activeProfile = summarizeClaudeConfig(readUtf8IfExists(targetPath), CURRENT_PROFILE_NAME, false);
  return {
    provider,
    activeProfile,
    selectedProfileName: settingsName,
    message: `Profile switched to ${settingsName}. Restart Claude Code to apply the new configuration.`
  };
}

export function saveRuntimeProfile(provider: Provider, input: RuntimeProfileInput): RuntimeProfileMutationResult {
  if (provider === 'codex') {
    const codexDir = getCodexDir();
    const configPath = path.join(codexDir, 'config.toml');
    const authPath = path.join(codexDir, 'auth.json');

    writeBackupIfExists(configPath, `${configPath}.bak`);
    writeBackupIfExists(authPath, `${authPath}.bak`);

    const nextConfig = buildCodexConfig(readUtf8IfExists(configPath), input);
    const nextAuth = buildCodexAuth(readUtf8IfExists(authPath), input);

    ensureDirectory(configPath);
    fs.writeFileSync(configPath, TOML.stringify(nextConfig as never), 'utf-8');

    ensureDirectory(authPath);
    fs.writeFileSync(authPath, JSON.stringify(nextAuth, null, 2), 'utf-8');

    const activeProfile = summarizeCodexConfig(
      readUtf8IfExists(configPath),
      readUtf8IfExists(authPath),
      CURRENT_PROFILE_NAME,
      false
    );

    return {
      provider,
      activeProfile,
      selectedProfileName: null,
      message: 'Profile saved. Restart Codex CLI to apply the new configuration.'
    };
  }

  const claudeDir = getClaudeDir();
  const targetPath = path.join(claudeDir, 'settings.json');
  writeBackupIfExists(targetPath, path.join(claudeDir, 'settings.json.backup'));

  const nextConfig = buildClaudeConfig(readUtf8IfExists(targetPath), input);
  ensureDirectory(targetPath);
  fs.writeFileSync(targetPath, JSON.stringify(nextConfig, null, 2), 'utf-8');

  const activeProfile = summarizeClaudeConfig(readUtf8IfExists(targetPath), CURRENT_PROFILE_NAME, false);
  return {
    provider,
    activeProfile,
    selectedProfileName: null,
    message: 'Profile saved. Restart Claude Code to apply the new configuration.'
  };
}
