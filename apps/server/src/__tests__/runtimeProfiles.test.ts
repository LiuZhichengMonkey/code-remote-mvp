import fs from 'fs';
import os from 'os';
import path from 'path';
import TOML from '@iarna/toml';
import {
  listRuntimeProfiles,
  saveRuntimeProfile,
  switchRuntimeProfile
} from '../runtimeProfiles';

describe('runtimeProfiles', () => {
  let tempHome: string;
  let homedirSpy: jest.SpiedFunction<typeof os.homedir>;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-runtime-profiles-'));
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tempHome);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  test('lists Claude profiles and detects the active matching profile', () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    const profileOne = {
      env: {
        ANTHROPIC_BASE_URL: 'https://claude.example.com',
        ANTHROPIC_AUTH_TOKEN: 'claude-token',
        ANTHROPIC_MODEL: 'claude-sonnet-4'
      },
      model: 'claude-sonnet-4'
    };
    const profileTwo = {
      env: {
        ANTHROPIC_BASE_URL: 'https://claude-2.example.com',
        ANTHROPIC_AUTH_TOKEN: 'claude-token-2',
        ANTHROPIC_MODEL: 'claude-opus-4'
      },
      model: 'claude-opus-4'
    };

    fs.writeFileSync(path.join(claudeDir, 'settings_key1.json'), JSON.stringify(profileOne, null, 2), 'utf-8');
    fs.writeFileSync(path.join(claudeDir, 'settings_key2.json'), JSON.stringify(profileTwo, null, 2), 'utf-8');
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(profileOne, null, 2), 'utf-8');

    const result = listRuntimeProfiles('claude');

    expect(result.provider).toBe('claude');
    expect(result.profiles).toHaveLength(2);
    expect(result.selectedProfileName).toBe('settings_key1');
    expect(result.activeProfile).toEqual(expect.objectContaining({
      provider: 'claude',
      model: 'claude-sonnet-4',
      baseUrl: 'https://claude.example.com',
      authTokenConfigured: true,
      isSaved: false
    }));
  });

  test('saves Claude manual overrides using provider-agnostic input fields', () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://old.example.com',
        ANTHROPIC_AUTH_TOKEN: 'old-token',
        ANTHROPIC_MODEL: 'old-model'
      }
    }, null, 2), 'utf-8');

    const result = saveRuntimeProfile('claude', {
      baseUrl: 'https://new.example.com',
      authToken: 'new-token',
      model: 'claude-sonnet-4.5'
    });

    const saved = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));

    expect(saved.env).toEqual(expect.objectContaining({
      ANTHROPIC_BASE_URL: 'https://new.example.com',
      ANTHROPIC_AUTH_TOKEN: 'new-token',
      ANTHROPIC_MODEL: 'claude-sonnet-4.5'
    }));
    expect(saved.model).toBe('claude-sonnet-4.5');
    expect(saved.permissions.defaultMode).toBe('bypassPermissions');
    expect(result.message).toContain('Restart Claude Code');
    expect(fs.existsSync(path.join(claudeDir, 'settings.json.backup'))).toBe(true);
  });

  test('switches Codex profiles by copying config and auth files', () => {
    const codexDir = path.join(tempHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });

    fs.writeFileSync(path.join(codexDir, 'config.toml'), TOML.stringify({
      model_provider: 'openai',
      model: 'gpt-4.1'
    } as never), 'utf-8');
    fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({
      OPENAI_API_KEY: 'old-key'
    }, null, 2), 'utf-8');

    fs.writeFileSync(path.join(codexDir, 'config_key1.toml'), TOML.stringify({
      model_provider: '30api',
      model: 'gpt-5.4',
      model_providers: {
        '30api': {
          base_url: 'https://api.558669.xyz/v1'
        }
      }
    } as never), 'utf-8');
    fs.writeFileSync(path.join(codexDir, 'auth_key1.json'), JSON.stringify({
      OPENAI_API_KEY: 'new-key'
    }, null, 2), 'utf-8');

    const result = switchRuntimeProfile('codex', 'config_key1');
    const savedConfig = TOML.parse(fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf-8')) as any;
    const savedAuth = JSON.parse(fs.readFileSync(path.join(codexDir, 'auth.json'), 'utf-8'));

    expect(savedConfig.model_provider).toBe('30api');
    expect(savedConfig.model).toBe('gpt-5.4');
    expect(savedConfig.model_providers['30api'].base_url).toBe('https://api.558669.xyz/v1');
    expect(savedAuth.OPENAI_API_KEY).toBe('new-key');
    expect(result.selectedProfileName).toBe('config_key1');
    expect(result.message).toContain('Restart Codex CLI');
    expect(fs.existsSync(path.join(codexDir, 'config.toml.bak'))).toBe(true);
    expect(fs.existsSync(path.join(codexDir, 'auth.json.bak'))).toBe(true);
  });

  test('saves Codex manual overrides while preserving unrelated config sections', () => {
    const codexDir = path.join(tempHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });

    fs.writeFileSync(path.join(codexDir, 'config.toml'), TOML.stringify({
      model_provider: '30api',
      model: 'gpt-5.4',
      model_providers: {
        '30api': {
          base_url: 'https://old.example.com/v1',
          wire_api: 'responses'
        }
      },
      windows: {
        sandbox: 'elevated'
      }
    } as never), 'utf-8');
    fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({
      OPENAI_API_KEY: 'old-key'
    }, null, 2), 'utf-8');

    const result = saveRuntimeProfile('codex', {
      baseUrl: 'https://new.example.com/v1',
      authToken: 'new-key',
      model: 'gpt-5.5'
    });

    const savedConfig = TOML.parse(fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf-8')) as any;
    const savedAuth = JSON.parse(fs.readFileSync(path.join(codexDir, 'auth.json'), 'utf-8'));

    expect(savedConfig.model).toBe('gpt-5.5');
    expect(savedConfig.model_providers['30api'].base_url).toBe('https://new.example.com/v1');
    expect(savedConfig.model_providers['30api'].wire_api).toBe('responses');
    expect(savedConfig.windows.sandbox).toBe('elevated');
    expect(savedAuth.OPENAI_API_KEY).toBe('new-key');
    expect(result.activeProfile).toEqual(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5.5',
      baseUrl: 'https://new.example.com/v1',
      authTokenConfigured: true
    }));
  });

  test('lists Codex current configuration even when no saved profiles exist', () => {
    const codexDir = path.join(tempHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });

    fs.writeFileSync(path.join(codexDir, 'config.toml'), TOML.stringify({
      model_provider: '30api',
      model: 'gpt-5.4',
      model_providers: {
        '30api': {
          base_url: 'https://api.558669.xyz/v1'
        }
      }
    } as never), 'utf-8');
    fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({
      OPENAI_API_KEY: 'current-key'
    }, null, 2), 'utf-8');

    const result = listRuntimeProfiles('codex');

    expect(result.provider).toBe('codex');
    expect(result.profiles).toEqual([]);
    expect(result.selectedProfileName).toBeNull();
    expect(result.activeProfile).toEqual(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5.4',
      baseUrl: 'https://api.558669.xyz/v1',
      authTokenConfigured: true,
      isSaved: false
    }));
  });
});
