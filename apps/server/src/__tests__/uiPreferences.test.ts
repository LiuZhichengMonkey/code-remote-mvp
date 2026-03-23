import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  UiPreferencesStorage,
  createDefaultUiPreferences,
  normalizeUiPreferences
} from '../uiPreferences';

describe('UiPreferencesStorage', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-preferences-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(workspaceRoot)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('returns defaults when preferences file does not exist', () => {
    const storage = new UiPreferencesStorage(workspaceRoot);
    const preferences = storage.load();

    expect(preferences.processPanel).toEqual(createDefaultUiPreferences(preferences.updatedAt).processPanel);
  });

  test('returns defaults when preferences file contains invalid json', () => {
    const preferencesFile = path.join(workspaceRoot, '.coderemote', 'ui-preferences.json');
    fs.mkdirSync(path.dirname(preferencesFile), { recursive: true });
    fs.writeFileSync(preferencesFile, '{invalid-json', 'utf-8');

    const storage = new UiPreferencesStorage(workspaceRoot);
    const preferences = storage.load();

    expect(preferences.processPanel).toEqual({
      showStatus: true,
      showLog: true,
      showTool: true
    });
  });

  test('saves and reloads normalized preferences', () => {
    const storage = new UiPreferencesStorage(workspaceRoot);
    const saved = storage.save({
      processPanel: {
        showStatus: false,
        showLog: true,
        showTool: false
      }
    });
    const reloaded = storage.load();

    expect(saved.processPanel).toEqual({
      showStatus: false,
      showLog: true,
      showTool: false
    });
    expect(reloaded).toEqual(saved);
  });

  test('fills missing fields during normalization', () => {
    const normalized = normalizeUiPreferences({
      processPanel: {
        showLog: false
      }
    });

    expect(normalized.processPanel).toEqual({
      showStatus: true,
      showLog: false,
      showTool: true
    });
  });
});
