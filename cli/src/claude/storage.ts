import fs from 'fs';
import path from 'path';
import { ClaudeSession, SessionInfo } from './types';

const DEFAULT_SESSIONS_DIR = 'E:/CodeRemote/Sessions';

export class SessionStorage {
  private sessionsDir: string;

  constructor(dir: string = DEFAULT_SESSIONS_DIR) {
    this.sessionsDir = dir;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      console.log(`Created sessions directory: ${this.sessionsDir}`);
    }
  }

  save(session: ClaudeSession): void {
    const filePath = this.getFilePath(session.id);
    session.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  load(sessionId: string): ClaudeSession | null {
    const filePath = this.getFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ClaudeSession;
    } catch (error) {
      console.error(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  list(): ClaudeSession[] {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }
    const files = fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.json'));

    const sessions = files.map(f => {
      try {
        const content = fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8');
        return JSON.parse(content) as ClaudeSession;
      } catch {
        return null;
      }
    }).filter((s): s is ClaudeSession => s !== null);

    // 按更新时间倒序排列
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listInfo(): SessionInfo[] {
    return this.list().map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s.messages.length
    }));
  }

  delete(sessionId: string): boolean {
    const filePath = this.getFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  getLatest(): ClaudeSession | null {
    const sessions = this.list();
    return sessions.length > 0 ? sessions[0] : null;
  }

  exists(sessionId: string): boolean {
    return fs.existsSync(this.getFilePath(sessionId));
  }

  private getFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  // 清理过期会话
  cleanup(maxAge: number): number {
    const now = Date.now();
    const sessions = this.list();
    let deleted = 0;

    for (const session of sessions) {
      if (now - session.updatedAt > maxAge) {
        this.delete(session.id);
        deleted++;
      }
    }

    return deleted;
  }
}
