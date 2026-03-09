import { WebSocket } from 'ws';
import { ClaudeCodeEngine, SessionManager, createMessage, ClaudeMessage, ToolUseEvent, ToolResultEvent } from '../claude';
import { CommandHandler } from './commands';
import { SessionStorage, ProjectInfo } from '../claude/storage';

export class ClaudeHandler {
  private engine: ClaudeCodeEngine;
  private sessionManager: SessionManager;
  private commandHandler: CommandHandler;

  constructor(workspaceRoot?: string) {
    this.engine = new ClaudeCodeEngine();
    this.sessionManager = new SessionManager(workspaceRoot);
    this.commandHandler = new CommandHandler(workspaceRoot);
    console.log(`[ClaudeHandler] Workspace: ${workspaceRoot || process.cwd()}`);
  }

  async handleClaudeMessage(
    ws: WebSocket,
    content: string,
    sendError: (code: string, message: string) => void,
    sessionId?: string,
    projectId?: string
  ): Promise<void> {
    // 检查是否是斜杠命令
    if (content.startsWith('/')) {
      const parsed = this.commandHandler.parseCommand(content);

      if (parsed) {
        // 执行命令
        const result = await this.commandHandler.execute(parsed.type, parsed.args);

        ws.send(JSON.stringify({
          type: 'command_result',
          command: parsed.type,
          success: result.success,
          data: result.data,
          error: result.error,
          timestamp: Date.now()
        }));
        return;
      }

      // 未知的斜杠命令
      ws.send(JSON.stringify({
        type: 'command_error',
        content: `Unknown command: ${content.split(' ')[0]}. Type /help for available commands.`,
        timestamp: Date.now()
      }));
      return;
    }

    // 如果前端传入了 sessionId 和 projectId，先恢复指定项目的会话
    if (sessionId && projectId) {
      console.log(`[ClaudeHandler] Resuming cross-project session: ${sessionId} from project ${projectId}`);
      const crossProjectSession = SessionStorage.loadSessionFromProject(projectId, sessionId);
      if (crossProjectSession) {
        // 使用 SessionStorage 的静态方法加载会话后，设置到 sessionManager
        this.sessionManager.setSessionFromCrossProject(crossProjectSession);
      } else {
        console.log(`[ClaudeHandler] Session ${sessionId} not found in project ${projectId}`);
      }
    } else if (sessionId) {
      // 如果只传入了 sessionId，恢复当前项目的会话
      console.log(`[ClaudeHandler] Resuming session: ${sessionId}, projectId: ${projectId || 'none'}`);
      this.sessionManager.resume(sessionId);
    }

    // 获取当前会话
    const currentSession = this.sessionManager.getCurrent();
    const isNewSession = !currentSession;

    console.log(`[ClaudeHandler] Current session:`, currentSession?.id, 'messages:', currentSession?.messages?.length, 'cwd:', currentSession?.cwd);

    // 如果没有当前会话，先创建一个临时占位（会在收到 Claude CLI session ID 后更新）
    if (!currentSession) {
      console.log(`[ClaudeHandler] No current session, creating temporary...`);
      // 先创建临时会话，但不保存到存储
      this.sessionManager.createTemporary();
    }

    // 创建用户消息
    const userMessage = createMessage('user', content);
    this.sessionManager.addMessage(userMessage);

    // 获取历史消息用于 API 调用
    const messages = this.sessionManager.getMessagesForAPI();

    // 发送开始信号
    ws.send(JSON.stringify({
      type: 'claude_start',
      messageId: userMessage.id,
      timestamp: Date.now()
    }));

    try {
      // 获取当前会话的 Claude CLI session ID 和工作目录
      const session = this.sessionManager.getCurrent();
      const claudeSessionId = session?.claudeSessionId;
      const cwd = session?.cwd;

      // 调用 Claude
      const result = await this.engine.sendMessage(
        content,
        messages,
        (chunk, done, thinking, toolEvent) => {
          if (toolEvent) {
            // 发送工具事件
            const toolData: any = {
              type: 'claude_tool',
              timestamp: Date.now()
            };
            if ('toolName' in toolEvent) {
              toolData.toolName = toolEvent.toolName;
              toolData.toolInput = toolEvent.toolInput;
              toolData.toolUseId = toolEvent.toolUseId;
            } else if ('toolUseId' in toolEvent) {
              toolData.toolUseId = toolEvent.toolUseId;
              toolData.result = toolEvent.result;
              toolData.isError = toolEvent.isError;
            }
            ws.send(JSON.stringify(toolData));
          } else {
            ws.send(JSON.stringify({
              type: 'claude_stream',
              content: chunk,
              thinking: thinking,
              done,
              timestamp: Date.now()
            }));
          }
        },
        claudeSessionId,
        cwd
      );

      // 如果是新会话，使用 Claude CLI 返回的 session ID
      if (isNewSession && result.claudeSessionId) {
        // 更新会话 ID 为 Claude CLI 的 session ID
        this.sessionManager.updateSessionId(result.claudeSessionId);
        console.log(`[ClaudeHandler] Updated session ID to Claude CLI session: ${result.claudeSessionId}`);

        // 通知前端会话 ID 已更新
        ws.send(JSON.stringify({
          type: 'session_id_updated',
          oldSessionId: session?.id,
          newSessionId: result.claudeSessionId,
          title: content.substring(0, 50),
          timestamp: Date.now()
        }));
      } else if (result.claudeSessionId && result.claudeSessionId !== claudeSessionId) {
        // 保存 Claude CLI session ID（用于下次恢复会话）
        this.sessionManager.setClaudeSessionId(result.claudeSessionId);
        console.log(`[ClaudeHandler] Saved Claude CLI session ID: ${result.claudeSessionId}`);
      }

      // 保存助手响应
      const assistantMessage = createMessage('assistant', result.response);
      this.sessionManager.addMessage(assistantMessage);

      // 发送完成信号
      ws.send(JSON.stringify({
        type: 'claude_done',
        messageId: assistantMessage.id,
        sessionId: this.sessionManager.getCurrent()?.id,
        claudeSessionId: result.claudeSessionId,
        timestamp: Date.now()
      }));

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCode = this.getErrorCode(errorMsg);
      sendError(errorCode, errorMsg);
    }
  }

  handleSessionAction(
    ws: WebSocket,
    action: 'new' | 'resume' | 'list' | 'delete' | 'list_projects' | 'list_by_project' | 'rename',
    sessionId?: string,
    projectId?: string,
    title?: string
  ): void {
    switch (action) {
      case 'new':
        // 创建临时会话（不保存到存储，等待第一条消息时获取 Claude CLI 的 session ID）
        const newSession = this.sessionManager.createTemporary();
        ws.send(JSON.stringify({
          type: 'session_created',
          session: {
            id: newSession.id,
            title: newSession.title,
            createdAt: newSession.createdAt,
            messageCount: 0,
            isTemporary: true
          },
          timestamp: Date.now()
        }));
        break;

      case 'list':
        const sessions = this.sessionManager.list();
        ws.send(JSON.stringify({
          type: 'session_list',
          sessions,
          timestamp: Date.now()
        }));
        break;

      case 'list_projects':
        // 列出所有项目
        const projects = SessionStorage.listAllProjects();
        ws.send(JSON.stringify({
          type: 'project_list',
          projects,
          timestamp: Date.now()
        }));
        break;

      case 'list_by_project':
        // 列出指定项目的会话
        if (projectId) {
          const projectSessions = SessionStorage.listSessionsByProject(projectId);
          ws.send(JSON.stringify({
            type: 'session_list',
            projectId,
            sessions: projectSessions,
            timestamp: Date.now()
          }));
        }
        break;

      case 'resume':
        if (sessionId) {
          let session;
          if (projectId) {
            // 从指定项目恢复会话
            session = SessionStorage.loadSessionFromProject(projectId, sessionId);
            if (session) {
              // 设置到 sessionManager 以便后续消息处理
              this.sessionManager.setSessionFromCrossProject(session);
            }
          } else {
            // 从当前项目恢复会话
            session = this.sessionManager.resume(sessionId);
          }

          if (session) {
            // 转换消息格式：assistant -> model
            const messages = session.messages.map(msg => ({
              ...msg,
              role: msg.role === 'assistant' ? 'model' : msg.role
            }));
            ws.send(JSON.stringify({
              type: 'session_resumed',
              projectId: projectId,
              session: {
                id: session.id,
                title: session.title,
                summary: session.title, // 添加 summary 字段
                messages,
                createdAt: session.createdAt
              },
              timestamp: Date.now()
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              content: 'Session not found',
              timestamp: Date.now()
            }));
          }
        }
        break;

      case 'delete':
        if (sessionId) {
          let deleted;
          if (projectId) {
            // 从指定项目删除会话
            deleted = SessionStorage.deleteSessionFromProject(projectId, sessionId);
          } else {
            // 从当前项目删除会话
            deleted = this.sessionManager.delete(sessionId);
          }
          ws.send(JSON.stringify({
            type: 'session_deleted',
            sessionId,
            projectId,
            success: deleted,
            timestamp: Date.now()
          }));
        }
        break;

      case 'rename':
        if (sessionId && title) {
          let renamed;
          if (projectId) {
            // 重命名指定项目的会话
            renamed = SessionStorage.renameSessionFromProject(projectId, sessionId, title);
          } else {
            // 重命名当前项目的会话
            renamed = this.sessionManager.rename(sessionId, title);
          }
          ws.send(JSON.stringify({
            type: 'session_renamed',
            sessionId,
            projectId,
            title,
            success: renamed,
            timestamp: Date.now()
          }));
        }
        break;
    }
  }

  private getErrorCode(errorMsg: string): string {
    if (errorMsg.includes('CLI') || errorMsg.includes('claude')) {
      return 'CLI_NOT_FOUND';
    }
    if (errorMsg.includes('API Key') || errorMsg.includes('apiKey')) {
      return 'API_KEY_MISSING';
    }
    if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
      return 'RATE_LIMITED';
    }
    return 'STREAM_ERROR';
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}
