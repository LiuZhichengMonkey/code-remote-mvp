import { ClaudeSession, ClaudeMessage, SessionInfo, createMessage, createSession } from './types';
import { SessionStorage } from './storage';

export class SessionManager {
  private storage: SessionStorage;
  private currentSession: ClaudeSession | null = null;
  private sessions: Map<string, ClaudeSession> = new Map();
  private isTemporarySession: boolean = false;

  constructor(workspaceRoot?: string) {
    this.storage = new SessionStorage(workspaceRoot);
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
    // 不保存到存储 - Claude CLI 会自己管理会话文件
    this.currentSession = session;
    this.isTemporarySession = true; // 标记为临时，等待 Claude CLI session ID
    return session;
  }

  // 创建临时会话（不保存到存储，等待 Claude CLI session ID）
  createTemporary(title?: string): ClaudeSession {
    const sessionTitle = title || 'New Chat';
    const session = createSession(sessionTitle);
    this.currentSession = session;
    this.isTemporarySession = true;
    return session;
  }

  // 更新会话 ID（当 Claude CLI 返回 session ID 时使用）
  updateSessionId(newSessionId: string): void {
    if (!this.currentSession) return;

    const oldId = this.currentSession.id;

    // 从存储加载 Claude CLI 创建的会话
    const claudeSession = this.storage.load(newSessionId);
    if (claudeSession) {
      // 使用 Claude CLI 的会话替换临时会话
      this.currentSession = claudeSession;
      this.sessions.delete(oldId);
      this.sessions.set(newSessionId, claudeSession);
      console.log(`[SessionManager] Loaded Claude CLI session: ${newSessionId}`);
    } else {
      // 如果加载失败，只更新 ID
      this.currentSession.id = newSessionId;
      this.currentSession.claudeSessionId = newSessionId;
      this.sessions.delete(oldId);
      this.sessions.set(newSessionId, this.currentSession);
    }
    this.isTemporarySession = false;
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

  // 分页恢复会话（从后往前加载消息）
  resumePaginated(
    sessionId: string,
    limit: number = 20,
    beforeIndex?: number
  ): { session: ClaudeSession | null; hasMore: boolean; totalMessages: number } {
    const result = this.storage.loadPaginated(sessionId, limit, beforeIndex);
    if (result.session) {
      this.currentSession = result.session;
      this.sessions.set(sessionId, result.session);
    }
    return result;
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
      // 自动创建临时会话
      this.createTemporary();
    }
    if (this.currentSession) {
      this.currentSession.messages.push(message);
      this.currentSession.updatedAt = Date.now();
      // 更新标题（如果是第一条用户消息）
      if (this.currentSession.messages.length === 1 && message.role === 'user') {
        this.currentSession.title = message.content.substring(0, 50);
      }
      // 不保存到存储 - Claude CLI 会自己管理会话文件
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

  rename(sessionId: string, newTitle: string): boolean {
    // 更新内存中的会话标题
    const session = this.sessions.get(sessionId);
    if (session) {
      session.title = newTitle;
    }
    // 更新存储中的标题
    return this.storage.rename(sessionId, newTitle);
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
      // 不保存到存储 - Claude CLI 会自己管理会话文件
    }
  }

  // 设置跨项目会话（从其他项目恢复会话时使用）
  setSessionFromCrossProject(session: ClaudeSession): void {
    this.currentSession = session;
    this.sessions.set(session.id, session);
    this.isTemporarySession = false;
    console.log(`[SessionManager] Set cross-project session: ${session.id}, claudeSessionId: ${session.claudeSessionId}`);
  }
}
