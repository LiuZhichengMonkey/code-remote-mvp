import { MessageProcess, ProcessPanelPreferences, UiPreferences } from './types';

export const DEFAULT_PROCESS_PANEL_PREFERENCES: ProcessPanelPreferences = {
  showStatus: true,
  showLog: true,
  showTool: true
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  processPanel: DEFAULT_PROCESS_PANEL_PREFERENCES,
  updatedAt: 0
};

export const normalizeProcessPanelPreferences = (
  value?: Partial<ProcessPanelPreferences> | null
): ProcessPanelPreferences => ({
  showStatus: value?.showStatus ?? DEFAULT_PROCESS_PANEL_PREFERENCES.showStatus,
  showLog: value?.showLog ?? DEFAULT_PROCESS_PANEL_PREFERENCES.showLog,
  showTool: value?.showTool ?? DEFAULT_PROCESS_PANEL_PREFERENCES.showTool
});

export const normalizeUiPreferences = (value?: UiPreferences | null): UiPreferences => ({
  processPanel: normalizeProcessPanelPreferences(value?.processPanel),
  updatedAt: typeof value?.updatedAt === 'number' ? value.updatedAt : 0
});

export const filterProcessForDisplay = (
  process: MessageProcess | undefined,
  preferences: ProcessPanelPreferences
): MessageProcess | undefined => {
  if (!process || process.events.length === 0) {
    return undefined;
  }

  const visibleEvents = process.events.filter(event => {
    switch (event.type) {
      case 'status':
        return preferences.showStatus;
      case 'log':
        return preferences.showLog;
      case 'tool_use':
      case 'tool_result':
        return preferences.showTool;
      default:
        return true;
    }
  });

  if (visibleEvents.length === 0) {
    return undefined;
  }

  return {
    ...process,
    events: visibleEvents
  };
};
