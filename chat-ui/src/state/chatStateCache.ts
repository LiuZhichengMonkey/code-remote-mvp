import { ChatSession, Provider } from '../types';
import { getProviderLabel, RECONNECTING_AFTER_REFRESH_STATUS_LABEL } from '../chatUiShared';

export const RUNNING_SESSIONS_STORAGE_KEY = 'coderemote_running_sessions';
export const ACTIVE_RUNNING_SESSION_STORAGE_KEY = 'coderemote_active_running_session';
export const RECONNECT_PLACEHOLDER_MESSAGE_PREFIX = 'reconnect_';
export const RUNNING_SESSION_REHYDRATION_TIMEOUT_MS = 1500;

export interface RunningSessionCacheEntry {
  sessionId: string;
  title: string;
  projectId?: string;
  provider: Provider;
}

export interface ActiveRunningSessionCacheEntry {
  sessionId: string;
  projectId?: string;
  provider: Provider;
}

export const loadRunningSessionCache = (): RunningSessionCacheEntry[] => {
  try {
    const raw = localStorage.getItem(RUNNING_SESSIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalizedEntries: RunningSessionCacheEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      if (typeof item.sessionId !== 'string' || typeof item.title !== 'string') {
        continue;
      }

      normalizedEntries.push({
        sessionId: item.sessionId,
        title: item.title,
        projectId: typeof item.projectId === 'string' ? item.projectId : undefined,
        provider: item.provider === 'codex' ? 'codex' : 'claude'
      });
    }

    return normalizedEntries;
  } catch {
    return [];
  }
};

export const loadActiveRunningSessionCache = (): ActiveRunningSessionCacheEntry | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_RUNNING_SESSION_STORAGE_KEY);
    if (!raw) {
      const fallbackEntry = loadRunningSessionCache()[0];
      return fallbackEntry
        ? {
            sessionId: fallbackEntry.sessionId,
            projectId: fallbackEntry.projectId,
            provider: fallbackEntry.provider
          }
        : null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sessionId !== 'string') {
      return null;
    }

    return {
      sessionId: parsed.sessionId,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : undefined,
      provider: parsed.provider === 'codex' ? 'codex' : 'claude'
    };
  } catch {
    return null;
  }
};

export const saveRunningSessionCache = (entries: RunningSessionCacheEntry[]): void => {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(RUNNING_SESSIONS_STORAGE_KEY);
      return;
    }

    localStorage.setItem(RUNNING_SESSIONS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage access errors.
  }
};

export const saveActiveRunningSessionCache = (entry: ActiveRunningSessionCacheEntry | null): void => {
  try {
    if (!entry) {
      localStorage.removeItem(ACTIVE_RUNNING_SESSION_STORAGE_KEY);
      return;
    }

    localStorage.setItem(ACTIVE_RUNNING_SESSION_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage access errors.
  }
};

export const cacheRunningSessionEntry = (entry: RunningSessionCacheEntry): void => {
  const nextEntries = loadRunningSessionCache().filter(item => item.sessionId !== entry.sessionId);
  nextEntries.unshift(entry);
  saveRunningSessionCache(nextEntries);
  saveActiveRunningSessionCache({
    sessionId: entry.sessionId,
    projectId: entry.projectId,
    provider: entry.provider
  });
};

export const removeCachedRunningSessionEntry = (sessionId: string): void => {
  const nextEntries = loadRunningSessionCache().filter(entry => entry.sessionId !== sessionId);
  saveRunningSessionCache(nextEntries);

  const activeEntry = loadActiveRunningSessionCache();
  if (activeEntry?.sessionId === sessionId) {
    const nextActiveEntry = nextEntries[0]
      ? {
          sessionId: nextEntries[0].sessionId,
          projectId: nextEntries[0].projectId,
          provider: nextEntries[0].provider
        }
      : null;
    saveActiveRunningSessionCache(nextActiveEntry);
  }
};

export const createReconnectPlaceholderSession = (entry: RunningSessionCacheEntry): ChatSession => {
  const timestamp = Date.now();
  const provider = entry.provider || 'claude';
  const providerLabel = getProviderLabel(provider);

  return {
    id: entry.sessionId,
    title: entry.title,
    createdAt: timestamp,
    provider,
    messages: [{
      id: `${RECONNECT_PLACEHOLDER_MESSAGE_PREFIX}${entry.sessionId}`,
      role: 'model',
      content: `${providerLabel} is still running. Restoring live progress after refresh...`,
      timestamp,
      status: 'sent',
      process: {
        provider,
        state: 'running',
        events: [{
          type: 'status',
          label: RECONNECTING_AFTER_REFRESH_STATUS_LABEL,
          timestamp
        }]
      }
    }]
  };
};
