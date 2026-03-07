import { WebSocket } from 'ws';
import { ClaudeCodeEngine, SessionManager, createMessage, ClaudeMessage } from '../claude';
import { CommandHandler } from './commands';

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
    sendError: (code: string, message: string) => void
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

    // 获取当前会话
    const currentSession = this.sessionManager.getCurrent();
    const isNewSession = !currentSession;

    // 如果没有当前会话，先创建一个临时占位（会在收到 Claude CLI session ID 后更新）
    if (!currentSession) {
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
      // 获取当前会话的 Claude CLI session ID
      const session = this.sessionManager.getCurrent();
      const claudeSessionId = session?.claudeSessionId;

      // 调用 Claude
      const result = await this.engine.sendMessage(
        content,
        messages,
        (chunk, done, thinking) => {
          ws.send(JSON.stringify({
            type: 'claude_stream',
            content: chunk,
            thinking: thinking,
            done,
            timestamp: Date.now()
          }));
        },
        claudeSessionId
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
    action: 'new' | 'resume' | 'list' | 'delete',
    sessionId?: string
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

      case 'resume':
        if (sessionId) {
          const session = this.sessionManager.resume(sessionId);
          if (session) {
            // 转换消息格式：assistant -> model
            const messages = session.messages.map(msg => ({
              ...msg,
              role: msg.role === 'assistant' ? 'model' : msg.role
            }));
            ws.send(JSON.stringify({
              type: 'session_resumed',
              session: {
                id: session.id,
                title: session.title,
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
          const deleted = this.sessionManager.delete(sessionId);
          ws.send(JSON.stringify({
            type: 'session_deleted',
            sessionId,
            success: deleted,
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
