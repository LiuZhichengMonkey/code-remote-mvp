import { CodexSessionStorage } from '../codexStorage';
import { DEFAULT_PROVIDER, Provider, SUPPORTED_PROVIDERS } from '../session/provider';
import { ClaudeMessage, ClaudeSession, SessionInfo, createSession } from './types';
import { SessionStorage } from './storage';

interface ProviderStorage {
  getProjectId(): string;
  load(sessionId: string): ClaudeSession | null;
  loadPaginated(
    sessionId: string,
    limit?: number,
    beforeIndex?: number
  ): { session: ClaudeSession | null; hasMore: boolean; totalMessages: number };
  list(): ClaudeSession[];
  listInfo(): SessionInfo[];
  delete(sessionId: string): boolean;
  rename(sessionId: string, newTitle: string): boolean;
  save?(session: ClaudeSession): void;
}

interface SessionContext {
  cwd?: string;
  projectId?: string;
}

export class SessionManager {
  private storages: Record<Provider, ProviderStorage>;
  private currentSession: ClaudeSession | null = null;
  private sessions: Map<string, ClaudeSession> = new Map();

  constructor(workspaceRoot?: string) {
    this.storages = {
      claude: new SessionStorage(workspaceRoot),
      codex: new CodexSessionStorage(workspaceRoot)
    };
  }

  private getProvidersToTry(provider?: Provider): Provider[] {
    if (provider) {
      return [provider];
    }

    if (this.currentSession) {
      const remaining = SUPPORTED_PROVIDERS.filter(candidate => candidate !== this.currentSession?.provider);
      return [this.currentSession.provider, ...remaining];
    }

    return [...SUPPORTED_PROVIDERS];
  }

  private getCachedOrLoaded(sessionId: string, provider?: Provider): ClaudeSession | null {
    const cached = this.sessions.get(sessionId);
    if (cached && (!provider || cached.provider === provider)) {
      if ((cached as ClaudeSession & { _partial?: boolean })._partial) {
        const canonicalSession = this.storages[cached.provider].load(sessionId);
        if (canonicalSession) {
          if (!canonicalSession.cwd && cached.cwd) {
            canonicalSession.cwd = cached.cwd;
          }
          if (!canonicalSession.projectId && cached.projectId) {
            canonicalSession.projectId = cached.projectId;
          }
          if (!canonicalSession.providerSessionId && cached.providerSessionId) {
            canonicalSession.providerSessionId = cached.providerSessionId;
          }
          if (canonicalSession.provider === 'claude' && cached.claudeSessionId) {
            canonicalSession.claudeSessionId = cached.claudeSessionId;
          }

          this.sessions.set(sessionId, canonicalSession);
          if (this.currentSession?.id === sessionId) {
            this.currentSession = canonicalSession;
          }
          return canonicalSession;
        }
      }

      return cached;
    }

    for (const candidate of this.getProvidersToTry(provider)) {
      const session = this.storages[candidate].load(sessionId);
      if (session) {
        this.sessions.set(sessionId, session);
        return session;
      }
    }

    return null;
  }

  private applySessionContext(session: ClaudeSession, context?: SessionContext): ClaudeSession {
    if (!context) {
      return session;
    }

    if (context.cwd) {
      session.cwd = context.cwd;
    }

    if (context.projectId) {
      session.projectId = context.projectId;
    }

    return session;
  }

  create(title?: string, provider: Provider = DEFAULT_PROVIDER, context?: SessionContext): ClaudeSession {
    const session = this.applySessionContext(createSession(title || 'New Chat', provider), context);
    this.sessions.set(session.id, session);
    this.currentSession = session;
    return session;
  }

  createTemporary(title?: string, provider: Provider = DEFAULT_PROVIDER, context?: SessionContext): ClaudeSession {
    const session = this.applySessionContext(createSession(title || 'New Chat', provider), context);
    this.currentSession = session;
    this.sessions.set(session.id, session);
    return session;
  }

  updateSessionId(newSessionId: string): void {
    if (!this.currentSession) {
      return;
    }

    const provider = this.currentSession.provider;
    const oldId = this.currentSession.id;
    const loadedSession = this.storages[provider].load(newSessionId);

    if (loadedSession) {
      this.currentSession = loadedSession;
      this.sessions.delete(oldId);
      this.sessions.set(newSessionId, loadedSession);
      console.log(`[SessionManager] Loaded ${provider} session: ${newSessionId}`);
      return;
    }

    this.currentSession.id = newSessionId;
    this.currentSession.providerSessionId = newSessionId;
    if (provider === 'claude') {
      this.currentSession.claudeSessionId = newSessionId;
    }

    this.sessions.delete(oldId);
    this.sessions.set(newSessionId, this.currentSession);
  }

  resume(sessionId: string, provider?: Provider): ClaudeSession | null {
    const session = this.getCachedOrLoaded(sessionId, provider);
    if (session) {
      this.currentSession = session;
    }
    return session;
  }

  resumePaginated(
    sessionId: string,
    limit: number = 20,
    beforeIndex?: number,
    provider?: Provider
  ): { session: ClaudeSession | null; hasMore: boolean; totalMessages: number } {
    const cached = this.sessions.get(sessionId);
    const cachedMatchesProvider = cached && (!provider || cached.provider === provider);
    const cachedIsPartial = cachedMatchesProvider && (cached as ClaudeSession & { _partial?: boolean })._partial;

    if (cachedMatchesProvider && !cachedIsPartial) {
      this.currentSession = cached;

      const totalMessages = cached.messages.length;
      const endIndex = beforeIndex !== undefined
        ? Math.max(0, totalMessages - beforeIndex)
        : totalMessages;
      const startIndex = Math.max(0, endIndex - limit);

      return {
        session: {
          ...cached,
          messages: cached.messages.slice(startIndex, endIndex)
        },
        hasMore: startIndex > 0,
        totalMessages
      };
    }

    const providersToTry = cachedMatchesProvider && cached
      ? [cached.provider]
      : this.getProvidersToTry(provider);

    for (const candidate of providersToTry) {
      const result = this.storages[candidate].loadPaginated(sessionId, limit, beforeIndex);
      if (result.session) {
        this.sessions.set(sessionId, result.session);
        this.currentSession = result.session;
        return result;
      }
    }

    return { session: null, hasMore: false, totalMessages: 0 };
  }

  resumeLatest(provider?: Provider): ClaudeSession | null {
    const summaries = this.list(provider);
    const latest = summaries[0];
    if (!latest) {
      return null;
    }

    const session = this.getCachedOrLoaded(latest.id, latest.provider);
    if (session) {
      this.currentSession = session;
    }
    return session;
  }

  addMessage(message: ClaudeMessage): void {
    if (!this.currentSession) {
      this.createTemporary();
    }

    if (!this.currentSession) {
      return;
    }

    this.currentSession.messages.push(message);
    this.currentSession.updatedAt = Date.now();

    if (this.currentSession.messages.length === 1 && message.role === 'user') {
      this.currentSession.title = message.content.substring(0, 50);
    }
  }

  addMessageToSession(sessionId: string, message: ClaudeMessage, provider?: Provider): ClaudeSession | null {
    const session = this.getCachedOrLoaded(sessionId, provider);
    if (!session) {
      return null;
    }

    session.messages.push(message);
    session.updatedAt = Date.now();

    if (session.messages.length === 1 && message.role === 'user') {
      session.title = message.content.substring(0, 50);
    }

    if (this.currentSession?.id === session.id) {
      this.currentSession = session;
    }

    return session;
  }

  getCurrent(): ClaudeSession | null {
    return this.currentSession;
  }

  get(sessionId: string, provider?: Provider): ClaudeSession | null {
    return this.getCachedOrLoaded(sessionId, provider);
  }

  getMessagesForSession(sessionId: string, provider?: Provider): ClaudeMessage[] {
    const session = this.getCachedOrLoaded(sessionId, provider);
    return session ? [...session.messages] : [];
  }

  list(provider?: Provider): SessionInfo[] {
    const sessions = provider
      ? this.storages[provider].listInfo()
      : SUPPORTED_PROVIDERS.flatMap(candidate => this.storages[candidate].listInfo());

    return sessions.sort((a, b) => (b.lastActivity || b.createdAt) - (a.lastActivity || a.createdAt));
  }

  getStorage(provider?: Provider): ProviderStorage {
    const effectiveProvider = provider || this.currentSession?.provider || DEFAULT_PROVIDER;
    return this.storages[effectiveProvider];
  }

  getStorageByProvider(provider: Provider): ProviderStorage {
    return this.storages[provider];
  }

  getProjectId(provider: Provider): string {
    return this.storages[provider].getProjectId();
  }

  delete(sessionId: string, provider?: Provider): boolean {
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }

    const cached = this.sessions.get(sessionId);
    const providersToTry = provider ? [provider] : cached ? [cached.provider] : SUPPORTED_PROVIDERS;

    for (const candidate of providersToTry) {
      if (this.storages[candidate].delete(sessionId)) {
        this.sessions.delete(sessionId);
        return true;
      }
    }

    return false;
  }

  rename(sessionId: string, newTitle: string, provider?: Provider): boolean {
    const cached = this.sessions.get(sessionId);
    if (cached) {
      cached.title = newTitle;
    }

    const providersToTry = provider ? [provider] : cached ? [cached.provider] : SUPPORTED_PROVIDERS;
    for (const candidate of providersToTry) {
      if (this.storages[candidate].rename(sessionId, newTitle)) {
        return true;
      }
    }

    return false;
  }

  clearCurrent(): void {
    this.currentSession = null;
  }

  saveSession(session: ClaudeSession): ClaudeSession {
    this.sessions.set(session.id, session);
    this.currentSession = session;
    this.storages[session.provider].save?.(session);
    return session;
  }

  getMessagesForAPI(): ClaudeMessage[] {
    return this.currentSession ? [...this.currentSession.messages] : [];
  }

  setProviderSessionId(providerSessionId: string): void {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.providerSessionId = providerSessionId;
    if (this.currentSession.provider === 'claude') {
      this.currentSession.claudeSessionId = providerSessionId;
    }
  }

  setClaudeSessionId(claudeSessionId: string): void {
    this.setProviderSessionId(claudeSessionId);
  }

  setProviderSessionIdForSession(sessionId: string, providerSessionId: string, provider?: Provider): ClaudeSession | null {
    const session = this.getCachedOrLoaded(sessionId, provider);
    if (!session) {
      return null;
    }

    session.providerSessionId = providerSessionId;
    if (session.provider === 'claude') {
      session.claudeSessionId = providerSessionId;
    }

    if (this.currentSession?.id === session.id) {
      this.currentSession = session;
    }

    return session;
  }

  refreshSessionForSession(sessionId: string, provider?: Provider, sourceSessionId?: string): ClaudeSession | null {
    const cached = this.sessions.get(sessionId) || null;
    const effectiveProvider = provider || cached?.provider || DEFAULT_PROVIDER;
    const lookupIds = [sourceSessionId, sessionId].filter((value, index, values) => (
      typeof value === 'string' && values.indexOf(value) === index
    )) as string[];

    for (const lookupId of lookupIds) {
      const loadedSession = this.storages[effectiveProvider].load(lookupId);
      if (!loadedSession) {
        continue;
      }

      if (cached) {
        if (!loadedSession.cwd && cached.cwd) {
          loadedSession.cwd = cached.cwd;
        }
        if (!loadedSession.projectId && cached.projectId) {
          loadedSession.projectId = cached.projectId;
        }
      }

      if (sourceSessionId) {
        loadedSession.providerSessionId = sourceSessionId;
        if (loadedSession.provider === 'claude') {
          loadedSession.claudeSessionId = sourceSessionId;
        }
      }

      if (loadedSession.id !== sessionId) {
        this.sessions.delete(loadedSession.id);
        loadedSession.id = sessionId;
      }

      if (lookupId !== sessionId) {
        this.sessions.delete(lookupId);
      }

      this.sessions.set(sessionId, loadedSession);

      if (this.currentSession?.id === sessionId || this.currentSession?.id === lookupId) {
        this.currentSession = loadedSession;
      }

      return loadedSession;
    }

    return null;
  }

  updateSessionIdForSession(sessionId: string, newSessionId: string, provider?: Provider): ClaudeSession | null {
    const session = this.getCachedOrLoaded(sessionId, provider);
    if (!session) {
      return null;
    }

    const effectiveProvider = provider || session.provider;
    const loadedSession = this.storages[effectiveProvider].load(newSessionId);
    if (loadedSession) {
      if (!loadedSession.cwd && session.cwd) {
        loadedSession.cwd = session.cwd;
      }
      if (!loadedSession.projectId && session.projectId) {
        loadedSession.projectId = session.projectId;
      }

      this.sessions.delete(sessionId);
      this.sessions.set(newSessionId, loadedSession);

      if (this.currentSession?.id === sessionId || this.currentSession?.id === newSessionId) {
        this.currentSession = loadedSession;
      }

      return loadedSession;
    }

    this.sessions.delete(sessionId);
    session.id = newSessionId;
    session.providerSessionId = newSessionId;
    if (session.provider === 'claude') {
      session.claudeSessionId = newSessionId;
    }
    this.sessions.set(newSessionId, session);

    if (this.currentSession?.id === sessionId) {
      this.currentSession = session;
    }

    return session;
  }

  setSessionFromCrossProject(session: ClaudeSession): void {
    this.currentSession = session;
    this.sessions.set(session.id, session);
    console.log(`[SessionManager] Set cross-project session: ${session.id}, provider: ${session.provider}`);
  }
}
