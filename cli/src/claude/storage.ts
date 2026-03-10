import fs from 'fs';
import path from 'path';
import os from 'os';
import { ClaudeSession, ClaudeMessage, SessionInfo } from './types';

// Claude CLI 的会话目录
const CLAUDE_CLI_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_CLI_DIR, 'projects');

// 项目信息接口
export interface ProjectInfo {
  id: string;           // 目录名: "E--code-remote-mvp"
  displayName: string;  // 可读路径: "E:/code-remote-mvp"
  sessionCount: number;
  lastActivity: number;
}

// 项目路径转 Claude CLI 目录名格式 (E:\code-remote-mvp -> E--code-remote-mvp)
function pathToClaudeDir(projectPath: string): string {
  // 处理 Windows 路径: E:\code-remote-mvp -> E--code-remote-mvp
  // 格式: 驱动器字母 + -- + 路径部分（反斜杠变成破折号）
  const normalized = projectPath.replace(/\\/g, '/');

  // 匹配 Windows 驱动器路径 (E:/path)
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const pathPart = driveMatch[2].replace(/\//g, '-');
    return `${drive}--${pathPart}`;
  }

  // 匹配 Unix 路径 (/home/user/path)
  if (normalized.startsWith('/')) {
    return normalized.substring(1).replace(/\//g, '-');
  }

  // 其他格式：直接替换
  return normalized.replace(/[:/]/g, '-');
}

// Claude CLI 目录名转可读路径 (E--code-remote-mvp -> E:/code-remote-mvp)
function claudeDirToPath(dirName: string): string {
  // 检测驱动器字母 (如 E-- 或 C--)
  const driveMatch = dirName.match(/^([A-Z])--(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1];
    const pathPart = driveMatch[2].replace(/-/g, '/');
    return `${drive}:/${pathPart}`;
  }

  // Unix 路径
  return '/' + dirName.replace(/-/g, '/');
}

// Claude CLI 消息格式
interface ClaudeCLIMessage {
  type: 'user' | 'assistant' | 'summary' | 'queue-operation';
  sessionId: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp: string;
  cwd?: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | Array<{type: string; text?: string; thinking?: string}>;
  };
  summary?: string;
}

export class SessionStorage {
  private projectDir: string;
  private projectPath: string;

  constructor(projectPath?: string) {
    // 自动检测项目路径：使用当前工作目录
    this.projectPath = projectPath || process.cwd();
    const dirName = pathToClaudeDir(this.projectPath);
    this.projectDir = path.join(CLAUDE_PROJECTS_DIR, dirName);
    console.log(`[SessionStorage] Project path: ${this.projectPath}`);
    console.log(`[SessionStorage] Claude dir: ${this.projectDir}`);
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(CLAUDE_CLI_DIR)) {
      fs.mkdirSync(CLAUDE_CLI_DIR, { recursive: true });
    }
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      fs.mkdirSync(CLAUDE_PROJECTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.projectDir)) {
      fs.mkdirSync(this.projectDir, { recursive: true });
    }
  }

  // 解析 Claude CLI 的 JSONL 文件
  private parseSessionFile(filePath: string): ClaudeSession | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      let sessionId = '';
      let title = 'New Chat';
      const messages: ClaudeMessage[] = [];
      const messageMap = new Map<string, ClaudeMessage>();
      let createdAt = Date.now();
      let updatedAt = Date.now();
      let cwd = '';
      let claudeSessionId = '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const entry: any = JSON.parse(line);

          // 获取 session ID (CodeRemote 内部)
          if (entry.sessionId && !sessionId) {
            sessionId = entry.sessionId;
          }

          // 获取 Claude CLI 的 session_id (用于恢复会话)
          // 注意：实际字段是 sessionId（驼峰）而不是 session_id（下划线）
          if (entry.sessionId && !claudeSessionId) {
            claudeSessionId = entry.sessionId;
          }

          // 获取工作目录
          if (entry.cwd && !cwd) {
            cwd = entry.cwd;
          }

          // 获取时间戳
          const entryTime = new Date(entry.timestamp).getTime();
          if (entryTime < createdAt) {
            createdAt = entryTime;
          }
          if (entryTime > updatedAt) {
            updatedAt = entryTime;
          }

          // 跳过 queue-operation 类型（包含 task-notification 等系统消息）
          if (entry.type === 'queue-operation') {
            continue;
          }

          // 处理用户消息
          if (entry.type === 'user' && entry.message) {
            // 跳过 tool_result 消息（工具调用结果不是用户真正输入的内容）
            if (Array.isArray(entry.message.content)) {
              const isToolResult = entry.message.content.some(
                (block: {type?: string}) => block.type === 'tool_result'
              );
              if (isToolResult) {
                continue; // 跳过这条消息
              }
            }

            const msg: ClaudeMessage = {
              id: entry.uuid || `user-${Date.now()}`,
              role: 'user',
              content: typeof entry.message.content === 'string'
                ? entry.message.content
                : (entry.message.content as Array<{text?: string}>).map((c: {text?: string}) => c.text || '').join(''),
              timestamp: entryTime
            };
            messageMap.set(msg.id, msg);
            messages.push(msg);

            // 第一条用户消息作为标题（只有在没有 summary 的情况下）
            if (messages.length === 1 && title === 'New Chat') {
              title = msg.content.substring(0, 50);
            }
          }

          // 处理助手消息 - 需要根据 parentUuid 合并同一回复
          if (entry.type === 'assistant' && entry.message) {
            const parentUuid = entry.parentUuid;
            const messageId = entry.message?.id;

            let content = '';
            let thinking = '';

            if (typeof entry.message.content === 'string') {
              content = entry.message.content;
            } else {
              for (const block of entry.message.content) {
                if (block.type === 'text' && block.text) {
                  content += block.text;
                }
                if (block.type === 'thinking' && block.thinking) {
                  thinking += block.thinking;
                }
              }
            }

            // 根据 parentUuid 合并同一回复的多个部分
            const mergeKey = parentUuid || messageId || entry.uuid;

            if (mergeKey && !messages.find(m => m.id === entry.uuid)) {
              // 检查是否已存在同一条消息
              const existingIdx = messages.findIndex(m =>
                m.id === entry.uuid ||
                (m as any).mergeKey === mergeKey
              );

              if (existingIdx === -1) {
                // 新消息
                // 跳过空消息
                if (!content && !thinking) {
                  continue;
                }

                const msg: ClaudeMessage = {
                  id: entry.uuid || `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: thinking ? `<thinking>${thinking}</thinking>${content}` : content,
                  timestamp: entryTime,
                  mergeKey // 标记用于合并
                } as any;
                messageMap.set(msg.id, msg);
                messages.push(msg);
              } else {
                // 已有消息，合并内容
                const existing = messages[existingIdx];
                const existingContent = existing.content || '';
                const newContent = thinking ? `<thinking>${thinking}</thinking>${content}` : content;

                if (content && !existingContent.includes(content)) {
                  // 追加 text 内容
                  if (existingContent.includes('<thinking>')) {
                    // 在 </thinking> 之后插入 text
                    const insertPos = existingContent.indexOf('</thinking>') + '</thinking>'.length;
                    existing.content = existingContent.slice(0, insertPos) + content + existingContent.slice(insertPos);
                  } else {
                    existing.content = existingContent + content;
                  }
                }
                if (thinking && !existingContent.includes(thinking)) {
                  // 更新 thinking
                  if (existingContent.includes('<thinking>')) {
                    const start = existingContent.indexOf('<thinking>') + '<thinking>'.length;
                    const end = existingContent.indexOf('</thinking>');
                    existing.content = existingContent.slice(0, start) + thinking + existingContent.slice(end);
                  } else {
                    existing.content = `<thinking>${thinking}</thinking>${existingContent}`;
                  }
                }
              }
            } else {
              // 没有 merge key，直接添加
              if (!content && !thinking) {
                continue;
              }

              const msg: ClaudeMessage = {
                id: entry.uuid || `assistant-${Date.now()}`,
                role: 'assistant',
                content: thinking ? `<thinking>${thinking}</thinking>${content}` : content,
                timestamp: entryTime
              };
              messageMap.set(msg.id, msg);
              messages.push(msg);
            }
          }

          // 处理 summary (标题)
          if (entry.type === 'summary' && entry.summary) {
            title = entry.summary;
          }
        } catch (e) {
          // 忽略解析错误的行
        }
      }

      if (!sessionId) {
        return null;
      }

      return {
        id: sessionId,
        title,
        createdAt,
        updatedAt,
        messages,
        claudeSessionId: claudeSessionId || undefined,
        cwd: cwd || undefined
      };
    } catch (error) {
      console.error(`Failed to parse session ${filePath}:`, error);
      return null;
    }
  }

  // 将 CodeRemote 会话写入 Claude CLI 格式
  private writeToClaudeFormat(session: ClaudeSession): void {
    console.log(`[SessionStorage] WARNING: writeToClaudeFormat called for ${session.id} - This should not happen!`);
    console.trace('[SessionStorage] Call stack:');
    const filePath = path.join(this.projectDir, `${session.id}.jsonl`);
    const lines: string[] = [];

    for (const msg of session.messages) {
      const timestamp = new Date(msg.timestamp).toISOString();

      if (msg.role === 'user') {
        lines.push(JSON.stringify({
          type: 'user',
          sessionId: session.id,
          uuid: msg.id,
          parentUuid: null,
          timestamp,
          message: {
            role: 'user',
            content: msg.content
          },
          cwd: this.projectPath,
          userType: 'external'
        }));
      } else {
        // 解析 thinking 标签
        let thinking = '';
        let content = msg.content;

        const thinkMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
        if (thinkMatch) {
          thinking = thinkMatch[1];
          content = content.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
        }

        // 先写 thinking
        if (thinking) {
          lines.push(JSON.stringify({
            type: 'assistant',
            sessionId: session.id,
            uuid: `${msg.id}-thinking`,
            parentUuid: msg.id,
            timestamp,
            message: {
              role: 'assistant',
              content: [{
                type: 'thinking',
                thinking
              }]
            },
            cwd: this.projectPath,
            userType: 'external'
          }));
        }

        // 再写内容
        if (content) {
          lines.push(JSON.stringify({
            type: 'assistant',
            sessionId: session.id,
            uuid: msg.id,
            parentUuid: thinking ? `${msg.id}-thinking` : null,
            timestamp,
            message: {
              role: 'assistant',
              content: [{
                type: 'text',
                text: content
              }]
            },
            cwd: this.projectPath,
            userType: 'external'
          }));
        }
      }
    }

    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  }

  save(session: ClaudeSession): void {
    // 禁用写入 - Claude CLI 会自己管理会话文件
    // 只保留 updatedAt 更新（内存中）
    session.updatedAt = Date.now();
    console.log(`[SessionStorage] Save skipped (Claude CLI manages sessions): ${session.id}`);
  }

  load(sessionId: string): ClaudeSession | null {
    const filePath = path.join(this.projectDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return this.parseSessionFile(filePath);
  }

  // 分页加载会话消息（从后往前加载）
  loadPaginated(sessionId: string, limit: number = 20, beforeIndex?: number): {
    session: ClaudeSession | null;
    hasMore: boolean;
    totalMessages: number;
  } {
    const filePath = path.join(this.projectDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) {
      return { session: null, hasMore: false, totalMessages: 0 };
    }

    const fullSession = this.parseSessionFile(filePath);
    if (!fullSession) {
      return { session: null, hasMore: false, totalMessages: 0 };
    }

    // 先过滤掉包含 task-notification 的消息
    const filteredMessages = fullSession.messages.filter((msg: ClaudeMessage) => {
      if (msg.content && msg.content.includes('<task-notification>')) {
        return false;
      }
      return true;
    });

    const totalMessages = filteredMessages.length;

    // 计算要加载的消息范围（从后往前加载）
    // beforeIndex 表示当前已经加载了多少条消息（从最新往回算）
    // 例如：总共有 100 条，已加载 20 条，要加载再之前的 20 条
    // 则 endIndex = 100 - 20 = 80, startIndex = 80 - 20 = 60
    let endIndex: number;
    let startIndex: number;

    if (beforeIndex !== undefined) {
      // 从已加载的消息之前继续加载
      endIndex = totalMessages - beforeIndex;
      startIndex = Math.max(0, endIndex - limit);
    } else {
      // 首次加载，加载最后 limit 条消息
      endIndex = totalMessages;
      startIndex = Math.max(0, endIndex - limit);
    }

    // 切片获取消息
    const messages = filteredMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      session: {
        ...fullSession,
        messages,
        // 标记这是部分加载的会话
        _partial: true,
        _totalMessages: totalMessages
      } as any,
      hasMore,
      totalMessages
    };
  }

  list(): ClaudeSession[] {
    if (!fs.existsSync(this.projectDir)) {
      return [];
    }

    const files = fs.readdirSync(this.projectDir)
      .filter(f => f.endsWith('.jsonl'));

    const sessions = files.map(f => {
      const filePath = path.join(this.projectDir, f);
      return this.parseSessionFile(filePath);
    }).filter((s): s is ClaudeSession => s !== null && s.messages.length > 0);

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
    const filePath = path.join(this.projectDir, `${sessionId}.jsonl`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  rename(sessionId: string, newTitle: string): boolean {
    const filePath = path.join(this.projectDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      // 读取现有内容
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      // 查找并更新 summary 行（如果存在），或添加新的 summary 行
      let hasSummary = false;
      const updatedLines = lines.map(line => {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'summary') {
            hasSummary = true;
            return JSON.stringify({ ...entry, summary: newTitle });
          }
        } catch {
          // 忽略解析错误
        }
        return line;
      });

      // 如果没有 summary 行，在文件开头添加一个
      if (!hasSummary) {
        const summaryEntry = {
          type: 'summary',
          summary: newTitle,
          sessionId: sessionId,
          timestamp: new Date().toISOString()
        };
        updatedLines.unshift(JSON.stringify(summaryEntry));
      }

      // 写回文件
      fs.writeFileSync(filePath, updatedLines.join('\n') + '\n', 'utf-8');
      console.log(`[SessionStorage] Renamed session ${sessionId} to "${newTitle}"`);
      return true;
    } catch (error) {
      console.error(`[SessionStorage] Failed to rename session ${sessionId}:`, error);
      return false;
    }
  }

  getLatest(): ClaudeSession | null {
    const sessions = this.list();
    return sessions.length > 0 ? sessions[0] : null;
  }

  exists(sessionId: string): boolean {
    return fs.existsSync(path.join(this.projectDir, `${sessionId}.jsonl`));
  }

  private getFilePath(sessionId: string): string {
    return path.join(this.projectDir, `${sessionId}.jsonl`);
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

  // ===== Static methods for multi-project support =====

  /**
   * 列出所有项目
   */
  static listAllProjects(): ProjectInfo[] {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      return [];
    }

    const projects: ProjectInfo[] = [];
    const entries = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectId = entry.name;
      const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);

      try {
        const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
        let lastActivity = 0;

        for (const file of files) {
          const filePath = path.join(projectDir, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs > lastActivity) {
            lastActivity = stat.mtimeMs;
          }
        }

        projects.push({
          id: projectId,
          displayName: claudeDirToPath(projectId),
          sessionCount: files.length,
          lastActivity
        });
      } catch (err) {
        console.error(`Error reading project ${projectId}:`, err);
      }
    }

    // 按最后活动时间排序（最新的在前）
    return projects.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /**
   * 列出指定项目的会话信息
   */
  static listSessionsByProject(projectId: string): SessionInfo[] {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);

    if (!fs.existsSync(projectDir)) {
      return [];
    }

    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      const filePath = path.join(projectDir, file);
      const sessionId = file.replace('.jsonl', '');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        let title = 'New Chat';
        let createdAt = Date.now();
        let messageCount = 0;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);

            if (entry.timestamp) {
              const entryTime = new Date(entry.timestamp).getTime();
              if (entryTime < createdAt) {
                createdAt = entryTime;
              }
            }

            // summary 优先级最高，先处理
            if (entry.type === 'summary' && entry.summary) {
              title = entry.summary;
            }

            if (entry.type === 'user' && entry.message) {
              messageCount++;
              // 只有在没有 summary 的情况下，才用第一条消息内容作为标题
              if (messageCount === 1 && title === 'New Chat' && entry.message.content) {
                title = typeof entry.message.content === 'string'
                  ? entry.message.content.substring(0, 50)
                  : 'New Chat';
              }
            }

            if (entry.type === 'assistant') {
              messageCount++;
            }
          } catch {
            // 忽略解析错误
          }
        }

        // Only include sessions with at least one message
        if (messageCount > 0) {
          sessions.push({
            id: sessionId,
            title,
            createdAt,
            messageCount
          });
        }
      } catch (err) {
        console.error(`Error reading session ${file}:`, err);
      }
    }

    // 按创建时间排序（最新的在前）
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 加载指定项目的会话内容
   */
  static loadSessionFromProject(projectId: string, sessionId: string): ClaudeSession | null {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);
    const storage = new SessionStorage(claudeDirToPath(projectId));
    storage.projectDir = projectDir;
    return storage.load(sessionId);
  }

  /**
   * 分页加载指定项目的会话内容（从后往前）
   */
  static loadSessionFromProjectPaginated(
    projectId: string,
    sessionId: string,
    limit: number = 20,
    beforeIndex?: number
  ): { session: ClaudeSession | null; hasMore: boolean; totalMessages: number } {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);
    const storage = new SessionStorage(claudeDirToPath(projectId));
    storage.projectDir = projectDir;
    return storage.loadPaginated(sessionId, limit, beforeIndex);
  }

  /**
   * 删除指定项目的会话
   */
  static deleteSessionFromProject(projectId: string, sessionId: string): boolean {
    const filePath = path.join(CLAUDE_PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /**
   * 重命名指定项目的会话
   */
  static renameSessionFromProject(projectId: string, sessionId: string, newTitle: string): boolean {
    const filePath = path.join(CLAUDE_PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      let hasSummary = false;
      const updatedLines = lines.map(line => {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'summary') {
            hasSummary = true;
            return JSON.stringify({ ...entry, summary: newTitle });
          }
        } catch {
          // 忽略解析错误
        }
        return line;
      });

      if (!hasSummary) {
        const summaryEntry = {
          type: 'summary',
          summary: newTitle,
          sessionId: sessionId,
          timestamp: new Date().toISOString()
        };
        updatedLines.unshift(JSON.stringify(summaryEntry));
      }

      fs.writeFileSync(filePath, updatedLines.join('\n') + '\n', 'utf-8');
      console.log(`[SessionStorage] Renamed session ${sessionId} in project ${projectId} to "${newTitle}"`);
      return true;
    } catch (error) {
      console.error(`[SessionStorage] Failed to rename session ${sessionId}:`, error);
      return false;
    }
  }
}
