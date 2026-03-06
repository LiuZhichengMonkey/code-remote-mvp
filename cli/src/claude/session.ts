import { ClaudeSession, ClaudeMessage, SessionInfo, createMessage, createSession } from './types';
import { SessionStorage } from './storage';

export class SessionManager {
  private storage: SessionStorage;
  private currentSession: ClaudeSession | null = null;
  private sessions: Map<string, ClaudeSession> = new Map();

  constructor() {
    this.storage = new SessionStorage();
    this.loadAllSessions();
  }

  private loadAllSessions(): void {
    const sessions = this.storage.list();
    for (const session of sessions) {
      this.sessions.set(session.id, session);
    }
  }

  create(title?: string): ClaudeSession {
    const sessionTitle = title || 'New Chat';
    const session = createSession(sessionTitle);
    this.sessions.set(session.id, session);
    this.storage.save(session);
    this.currentSession = session;
    return session;
  }

  resume(sessionId: string): ClaudeSession | null {
    // 先检查内存中的缓存
    let session = this.sessions.get(sessionId) || null;
    if (!session) {
      // 从存储加载
      session = this.storage.load(sessionId);
      if (session) {
        this.sessions.set(sessionId, session);
      }
    }
    if (session) {
      this.currentSession = session;
    }
    return session;
  }

  resumeLatest(): ClaudeSession | null {
    const latest = this.storage.getLatest();
    if (latest) {
      this.currentSession = latest;
      this.sessions.set(latest.id, latest);
    }
    return latest;
  }

  addMessage(message: ClaudeMessage): void {
    if (!this.currentSession) {
      // 自动创建新会话
      const title = message.content.substring(0, 50);
      this.create(title);
    }
    if (this.currentSession) {
      this.currentSession.messages.push(message);
      this.currentSession.updatedAt = Date.now();
      // 更新标题（如果是第一条用户消息）
      if (this.currentSession.messages.length === 1 && message.role === 'user') {
        this.currentSession.title = message.content.substring(0, 50);
      }
      this.storage.save(this.currentSession);
    }
  }

  getCurrent(): ClaudeSession | null {
    return this.currentSession;
  }

  get(sessionId: string): ClaudeSession | null {
    return this.sessions.get(sessionId) || this.storage.load(sessionId);
  }

  list(): SessionInfo[] {
    return this.storage.listInfo();
  }

  delete(sessionId: string): boolean {
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
    this.sessions.delete(sessionId);
    return this.storage.delete(sessionId);
  }

  clearCurrent(): void {
    this.currentSession = null;
  }

  // 获取当前会话的消息历史（用于 API 调用）
  getMessagesForAPI(): ClaudeMessage[] {
    if (!this.currentSession) {
      return [];
    }
    return [...this.currentSession.messages];
  }

  // 更新会话的 Claude CLI session ID
  setClaudeSessionId(claudeSessionId: string): void {
    if (this.currentSession) {
      this.currentSession.claudeSessionId = claudeSessionId;
      this.storage.save(this.currentSession);
    }
  }
}
