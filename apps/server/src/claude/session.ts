import { CodexSessionStorage } from '../codexStorage';
import { DEFAULT_PROVIDER, Provider, SUPPORTED_PROVIDERS } from '../session/provider';
import { ClaudeMessage, ClaudeSession, SessionInfo, createSession } from './types';
import { SessionStorage } from './storage';

type ProviderStorage = SessionStorage | CodexSessionStorage;

export class SessionManager {
  private storages: Record<Provider, ProviderStorage>;
  private currentSession: ClaudeSession | null = null;
  private sessions: Map<string, ClaudeSession> = new Map();

  constructor(workspaceRoot?: string) {
    this.storages = {
      claude: new SessionStorage(workspaceRoot),
      codex: new CodexSessionStorage(workspaceRoot)
    };
    this.loadAllSessions();
  }

  private loadAllSessions(): void {
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const session of this.storages[provider].list()) {
        this.sessions.set(session.id, session);
      }
    }
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

  create(title?: string, provider: Provider = DEFAULT_PROVIDER): ClaudeSession {
    const session = createSession(title || 'New Chat', provider);
    this.sessions.set(session.id, session);
    this.currentSession = session;
    return session;
  }

  createTemporary(title?: string, provider: Provider = DEFAULT_PROVIDER): ClaudeSession {
    const session = createSession(title || 'New Chat', provider);
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
    for (const candidate of this.getProvidersToTry(provider)) {
      const result = this.storages[candidate].loadPaginated(sessionId, limit, beforeIndex);
      if (result.session) {
        this.currentSession = result.session;
        this.sessions.set(sessionId, result.session);
        return result;
      }
    }

    return { session: null, hasMore: false, totalMessages: 0 };
  }

  resumeLatest(provider?: Provider): ClaudeSession | null {
    const sessions = provider
      ? this.storages[provider].list()
      : SUPPORTED_PROVIDERS.flatMap(candidate => this.storages[candidate].list());

    const latest = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    if (latest) {
      this.currentSession = latest;
      this.sessions.set(latest.id, latest);
    }
    return latest;
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

  getCurrent(): ClaudeSession | null {
    return this.currentSession;
  }

  get(sessionId: string, provider?: Provider): ClaudeSession | null {
    return this.getCachedOrLoaded(sessionId, provider);
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

  setSessionFromCrossProject(session: ClaudeSession): void {
    this.currentSession = session;
    this.sessions.set(session.id, session);
    console.log(`[SessionManager] Set cross-project session: ${session.id}, provider: ${session.provider}`);
  }
}
