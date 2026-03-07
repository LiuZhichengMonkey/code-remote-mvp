import { WebSocket } from 'ws';
import { ClaudeCodeEngine, SessionManager, createMessage, ClaudeMessage } from '../claude';
import { CommandHandler } from './commands';

export class ClaudeHandler {
  private engine: ClaudeCodeEngine;
  private sessionManager: SessionManager;
  private commandHandler: CommandHandler;

  constructor(workspaceRoot?: string) {
    this.engine = new ClaudeCodeEngine();
    this.sessionManager = new SessionManager();
    this.commandHandler = new CommandHandler(workspaceRoot);
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
      // 调用 Claude
      const response = await this.engine.sendMessage(
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
        }
      );

      // 保存助手响应
      const assistantMessage = createMessage('assistant', response);
      this.sessionManager.addMessage(assistantMessage);

      // 发送完成信号
      ws.send(JSON.stringify({
        type: 'claude_done',
        messageId: assistantMessage.id,
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
        const newSession = this.sessionManager.create();
        ws.send(JSON.stringify({
          type: 'session_created',
          session: {
            id: newSession.id,
            title: newSession.title,
            createdAt: newSession.createdAt,
            messageCount: 0
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
            ws.send(JSON.stringify({
              type: 'session_resumed',
              session: {
                id: session.id,
                title: session.title,
                messages: session.messages
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
