import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheRunningSessionEntry,
  createReconnectPlaceholderSession,
  loadActiveRunningSessionCache,
  loadRunningSessionCache,
  removeCachedRunningSessionEntry,
  saveActiveRunningSessionCache,
  saveRunningSessionCache
} from './chatStateCache';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('chatStateCache helpers', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true
    });
  });

  it('stores and removes running session entries while keeping active pointer aligned', () => {
    cacheRunningSessionEntry({
      sessionId: 's1',
      title: 'First',
      provider: 'claude'
    });
    cacheRunningSessionEntry({
      sessionId: 's2',
      title: 'Second',
      provider: 'codex',
      projectId: 'p2'
    });

    expect(loadRunningSessionCache().map(entry => entry.sessionId)).toEqual(['s2', 's1']);
    expect(loadActiveRunningSessionCache()).toEqual({
      sessionId: 's2',
      projectId: 'p2',
      provider: 'codex'
    });

    removeCachedRunningSessionEntry('s2');

    expect(loadRunningSessionCache().map(entry => entry.sessionId)).toEqual(['s1']);
    expect(loadActiveRunningSessionCache()).toEqual({
      sessionId: 's1',
      projectId: undefined,
      provider: 'claude'
    });
  });

  it('falls back to the first running session when active entry is missing', () => {
    saveRunningSessionCache([{
      sessionId: 'fallback-session',
      title: 'Fallback',
      provider: 'claude'
    }]);
    saveActiveRunningSessionCache(null);

    expect(loadActiveRunningSessionCache()).toEqual({
      sessionId: 'fallback-session',
      projectId: undefined,
      provider: 'claude'
    });
  });

  it('creates a reconnect placeholder with visible running process metadata', () => {
    const placeholder = createReconnectPlaceholderSession({
      sessionId: 'restore-1',
      title: 'Restore me',
      provider: 'codex'
    });

    expect(placeholder.provider).toBe('codex');
    expect(placeholder.messages[0].content).toContain('Codex is still running');
    expect(placeholder.messages[0].process?.state).toBe('running');
  });
});
