import fs from 'fs';
import path from 'path';

export interface ProcessPanelPreferences {
  showStatus: boolean;
  showLog: boolean;
  showTool: boolean;
}

export interface UiPreferences {
  processPanel: ProcessPanelPreferences;
  updatedAt: number;
}

const DEFAULT_PROCESS_PANEL_PREFERENCES: ProcessPanelPreferences = {
  showStatus: true,
  showLog: true,
  showTool: true
};

function cloneProcessPanelPreferences(): ProcessPanelPreferences {
  return { ...DEFAULT_PROCESS_PANEL_PREFERENCES };
}

export function createDefaultUiPreferences(updatedAt: number = Date.now()): UiPreferences {
  return {
    processPanel: cloneProcessPanelPreferences(),
    updatedAt
  };
}

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const defaults = createDefaultUiPreferences();
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const processPanel = input.processPanel && typeof input.processPanel === 'object'
    ? input.processPanel as Record<string, unknown>
    : {};

  return {
    processPanel: {
      showStatus: typeof processPanel.showStatus === 'boolean'
        ? processPanel.showStatus
        : defaults.processPanel.showStatus,
      showLog: typeof processPanel.showLog === 'boolean'
        ? processPanel.showLog
        : defaults.processPanel.showLog,
      showTool: typeof processPanel.showTool === 'boolean'
        ? processPanel.showTool
        : defaults.processPanel.showTool
    },
    updatedAt: typeof input.updatedAt === 'number'
      ? input.updatedAt
      : defaults.updatedAt
  };
}

export class UiPreferencesStorage {
  private readonly preferencesFile: string;

  constructor(workspaceRoot?: string) {
    const root = workspaceRoot || process.cwd();
    this.preferencesFile = path.join(root, '.coderemote', 'ui-preferences.json');
  }

  private ensureDirectory(): void {
    const preferencesDir = path.dirname(this.preferencesFile);
    if (!fs.existsSync(preferencesDir)) {
      fs.mkdirSync(preferencesDir, { recursive: true });
    }
  }

  load(): UiPreferences {
    try {
      if (!fs.existsSync(this.preferencesFile)) {
        return createDefaultUiPreferences();
      }

      const content = fs.readFileSync(this.preferencesFile, 'utf-8');
      if (!content.trim()) {
        return createDefaultUiPreferences();
      }

      return normalizeUiPreferences(JSON.parse(content));
    } catch {
      return createDefaultUiPreferences();
    }
  }

  save(preferences: unknown): UiPreferences {
    const input = preferences && typeof preferences === 'object'
      ? preferences as Record<string, unknown>
      : {};
    const normalized = normalizeUiPreferences({
      ...input,
      updatedAt: Date.now()
    });

    this.ensureDirectory();
    fs.writeFileSync(this.preferencesFile, JSON.stringify(normalized, null, 2), 'utf-8');
    return normalized;
  }
}
