import { describe, expect, it } from 'vitest';
import {
  applyRuntimeProfileError,
  applyRuntimeProfileList,
  applyRuntimeProfileMutation,
  createRuntimeProfilesState
} from './runtimeProfiles';

describe('runtimeProfiles helpers', () => {
  it('normalizes list payloads into provider state', () => {
    const initialState = createRuntimeProfilesState().codex;

    const nextState = applyRuntimeProfileList(initialState, {
      settings: [
        {
          name: 'config_key1',
          provider: 'codex',
          model: 'gpt-5.4',
          valueCount: 3,
          baseUrl: 'https://api.example.com/v1',
          authTokenConfigured: true,
          isSaved: true
        }
      ],
      activeProfile: {
        name: 'Current configuration',
        provider: 'codex',
        model: 'gpt-5.4',
        valueCount: 3,
        baseUrl: 'https://api.example.com/v1',
        authTokenConfigured: true,
        isSaved: false
      },
      selectedProfileName: 'config_key1'
    }, 'codex');

    expect(nextState.loaded).toBe(true);
    expect(nextState.loading).toBe(false);
    expect(nextState.selectedProfileName).toBe('config_key1');
    expect(nextState.activeProfile?.provider).toBe('codex');
    expect(nextState.settingsList).toHaveLength(1);
  });

  it('resets editing state after a successful mutation', () => {
    const initialState = {
      ...createRuntimeProfilesState().claude,
      isEditing: true,
      editForm: {
        baseUrl: 'https://stale.example.com',
        authToken: 'secret',
        model: 'old-model'
      }
    };

    const nextState = applyRuntimeProfileMutation(initialState, {
      settingsName: 'settings_key2',
      activeProfile: {
        name: 'Current configuration',
        provider: 'claude',
        model: 'claude-sonnet-4',
        valueCount: 3,
        baseUrl: 'https://anthropic.example.com',
        authTokenConfigured: true,
        isSaved: false
      }
    }, 'claude');

    expect(nextState.isEditing).toBe(false);
    expect(nextState.selectedProfileName).toBe('settings_key2');
    expect(nextState.editForm).toEqual({
      baseUrl: 'https://anthropic.example.com',
      authToken: '',
      model: 'claude-sonnet-4'
    });
  });

  it('stores runtime profile errors without discarding loaded data', () => {
    const initialState = {
      ...createRuntimeProfilesState().claude,
      loaded: true
    };

    const nextState = applyRuntimeProfileError(initialState, 'boom');

    expect(nextState.loaded).toBe(true);
    expect(nextState.loading).toBe(false);
    expect(nextState.errorMessage).toBe('boom');
  });

  it('keeps the active profile visible when Codex has no saved profiles', () => {
    const initialState = createRuntimeProfilesState().codex;

    const nextState = applyRuntimeProfileList(initialState, {
      settings: [],
      activeProfile: {
        name: 'Current configuration',
        provider: 'codex',
        model: 'gpt-5.4',
        valueCount: 3,
        baseUrl: 'https://api.558669.xyz/v1',
        authTokenConfigured: true,
        isSaved: false
      },
      selectedProfileName: null
    }, 'codex');

    expect(nextState.loaded).toBe(true);
    expect(nextState.settingsList).toEqual([]);
    expect(nextState.selectedProfileName).toBe('');
    expect(nextState.activeProfile).toEqual(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5.4',
      baseUrl: 'https://api.558669.xyz/v1',
      authTokenConfigured: true,
      isSaved: false
    }));
    expect(nextState.editForm).toEqual({
      baseUrl: 'https://api.558669.xyz/v1',
      authToken: '',
      model: 'gpt-5.4'
    });
  });
});
