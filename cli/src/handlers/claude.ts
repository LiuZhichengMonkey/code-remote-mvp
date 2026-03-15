import { WebSocket } from 'ws';
import { ClaudeCodeEngine, SessionManager, createMessage, ClaudeMessage, ToolUseEvent, ToolResultEvent, ClaudeSession, LogMessage } from '../claude';
import { CommandHandler } from './commands';
import { SessionStorage, ProjectInfo } from '../claude/storage';
import { parseAgentMentions, hasAgentMention, listAvailableAgents, loadAgentContext, AgentContext } from '../agent';

/** 单个会话的运行状态 */
interface SessionRunState {
  sessionId: string;
  engine: ClaudeCodeEngine;
  ws: WebSocket;
  sessionManager: SessionManager;
  isRunning: boolean;
  /** 累积的消息内容（用于后台会话） */
  accumulatedContent: string;
  accumulatedThinking: string;
}

export class ClaudeHandler {
  private engine: ClaudeCodeEngine;
  private sessionManager: SessionManager;
  private commandHandler: CommandHandler;
  private workspaceRoot?: string;

  /** 多会话并发运行状态 - 支持多个会话同时运行 */
  private runningSessions: Map<string, SessionRunState> = new Map();

  /** 当前活跃的会话 ID（前端正在查看的会话） */
  private activeSessionId: string | null = null;

  /** 兼容旧接口：获取第一个运行中的会话 */
  private runningState: {
    sessionId: string | null;
    ws: WebSocket | null;
    isRunning: boolean;
  } = {
    sessionId: null,
    ws: null,
    isRunning: false
  };

  constructor(workspaceRoot?: string) {
    this.engine = new ClaudeCodeEngine();
    this.sessionManager = new SessionManager(workspaceRoot);
    this.commandHandler = new CommandHandler(workspaceRoot);
    this.workspaceRoot = workspaceRoot;
    console.log(`[ClaudeHandler] Workspace: ${workspaceRoot || process.cwd()}`);
  }

  /**
   * 检查是否有任何运行中的进程
   */
  isRunning(): boolean {
    return this.runningSessions.size > 0 || this.engine.isRunning();
  }

  /**
   * 清理无效的运行状态（进程已结束但状态残留）
   * 在客户端重连时调用，检查进程是否真的还活着
   */
  cleanupStaleSessions(): void {
    const staleSessions: string[] = [];
    for (const [sessionId, state] of this.runningSessions) {
      // 检查 engine 的进程是否真的还在运行
      if (state.isRunning && !state.engine.isRunning()) {
        staleSessions.push(sessionId);
      }
    }
    for (const sessionId of staleSessions) {
      console.log(`[ClaudeHandler] Cleaning up stale session: ${sessionId}`);
      this.runningSessions.delete(sessionId);
    }
    // 同时清理兼容状态
    if (this.runningState.isRunning && !this.engine.isRunning()) {
      const hasRunningSession = Array.from(this.runningSessions.values()).some(s => s.isRunning);
      if (!hasRunningSession) {
        this.runningState = { sessionId: null, ws: null, isRunning: false };
      }
    }
  }

  /**
   * 检查指定会话是否在运行
   */
  isSessionRunning(sessionId: string): boolean {
    const state = this.runningSessions.get(sessionId);
    return state?.isRunning ?? false;
  }

  /**
   * 获取运行中的会话 ID（返回第一个）
   */
  getRunningSessionId(): string | null {
    for (const [sessionId, state] of this.runningSessions) {
      if (state.isRunning) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * 获取所有运行中的会话 ID
   */
  getAllRunningSessionIds(): string[] {
    const ids: string[] = [];
    for (const [sessionId, state] of this.runningSessions) {
      if (state.isRunning) {
        ids.push(sessionId);
      }
    }
    return ids;
  }

  /**
   * 设置当前活跃的会话（前端正在查看的会话）
   */
  setActiveSession(sessionId: string | null): void {
    console.log(`[ClaudeHandler] Setting active session: ${sessionId}`);
    this.activeSessionId = sessionId;

    // 如果切回的会话正在运行且有待发送的累积内容，立即发送
    if (sessionId && this.runningSessions.has(sessionId)) {
      const state = this.runningSessions.get(sessionId);
      if (state && state.ws && state.ws.readyState === 1 && (state.accumulatedContent || state.accumulatedThinking)) {
        console.log(`[ClaudeHandler] Flushing accumulated content for active session: ${sessionId}, content length: ${state.accumulatedContent.length}`);
        // 发送累积的内容，带上 replace 标志让前端替换而不是追加
        state.ws.send(JSON.stringify({
          type: 'claude_stream',
          content: state.accumulatedContent,
          thinking: state.accumulatedThinking,
          done: false,
          replace: true,  // 标志：替换前端最后一条消息的内容
          sessionId: sessionId,
          timestamp: Date.now()
        }));
        // 清空累积内容
        state.accumulatedContent = '';
        state.accumulatedThinking = '';
      }
    }
  }

  /**
   * 获取当前活跃的会话 ID
   */
  getActiveSession(): string | null {
    return this.activeSessionId;
  }

  /**
   * 检查指定会话是否是活跃会话
   */
  isActiveSession(sessionId: string): boolean {
    return this.activeSessionId === sessionId;
  }

  /**
   * 更新运行中会话的 WebSocket（用于重连）
   */
  updateRunningWebSocket(ws: WebSocket): boolean {
    // 更新所有运行中会话的 WebSocket
    let updated = false;
    for (const [sessionId, state] of this.runningSessions) {
      if (state.isRunning) {
        console.log(`[ClaudeHandler] Updating WebSocket for running session: ${sessionId}`);
        state.ws = ws;
        updated = true;
      }
    }

    // 兼容旧接口
    if (this.runningState.isRunning && this.runningState.sessionId) {
      this.runningState.ws = ws;
      return true;
    }
    return updated;
  }

  /**
   * 更新指定会话的 WebSocket
   */
  updateSessionWebSocket(sessionId: string, ws: WebSocket): boolean {
    const state = this.runningSessions.get(sessionId);
    if (state) {
      state.ws = ws;
      return true;
    }
    return false;
  }

  /**
   * 停止特定会话
   */
  stopSession(sessionId: string): boolean {
    const state = this.runningSessions.get(sessionId);
    if (state) {
      console.log(`[ClaudeHandler] Stopping session: ${sessionId}`);
      state.engine.stop();
      state.isRunning = false;
      this.runningSessions.delete(sessionId);

      // 更新兼容状态
      if (this.runningState.sessionId === sessionId) {
        this.runningState = { sessionId: null, ws: null, isRunning: false };
      }
      return true;
    }
    return false;
  }

  // 停止所有运行的 Claude CLI 进程
  stop(): boolean {
    console.log('[ClaudeHandler] Stopping all Claude CLI processes...');
    let stopped = false;
    for (const [sessionId, state] of this.runningSessions) {
      state.engine.stop();
      state.isRunning = false;
      stopped = true;
    }
    this.runningSessions.clear();
    this.runningState = { sessionId: null, ws: null, isRunning: false };
    return stopped || this.engine.stop();
  }

  async handleClaudeMessage(
    ws: WebSocket,
    content: string,
    sendError: (code: string, message: string) => void,
    sessionId?: string,
    projectId?: string,
    attachments?: Array<{
      id: string;
      name: string;
      type: string;
      data: string;
    }>
  ): Promise<void> {
    // 获取目标会话 ID
    const targetSessionId = sessionId || this.sessionManager.getCurrent()?.id;

    // 检查目标会话是否已在运行
    if (targetSessionId && this.isSessionRunning(targetSessionId)) {
      console.log(`[ClaudeHandler] Session ${targetSessionId} is already running, cannot send new message`);
      sendError('SESSION_BUSY', '当前会话正在处理中，请等待完成或停止后再发送新消息');
      return;
    }

    // 检查是否是斜杠命令
    if (content.startsWith('/')) {
      const parsed = this.commandHandler.parseCommand(content);

      if (parsed) {
        // 执行已知的系统命令
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

      // 未知的斜杠命令 - 可能是 skill，继续发送给 Claude CLI
      console.log(`[ClaudeHandler] Unknown slash command, treating as skill: ${content.split(' ')[0]}`);
    }

    // 解析 @agent 语法
    let agentInfo: { host: string | null; experts: string[] } = { host: null, experts: [] };
    let hostAgentContext: AgentContext | null = null;

    if (hasAgentMention(content)) {
      const parsed = parseAgentMentions(content);
      console.log(`[ClaudeHandler] parseAgentMentions result:`, JSON.stringify(parsed));
      agentInfo = { host: parsed.hostAgent, experts: parsed.expertAgents };

      if (parsed.hostAgent) {
        console.log(`[ClaudeHandler] Agent mentioned: @${parsed.hostAgent}`, parsed.expertAgents.length > 0 ? `+ experts: ${parsed.expertAgents.join(', ')}` : '');

        // 加载 agent 上下文（用于前端通知和 agent 配置）
        hostAgentContext = loadAgentContext(parsed.hostAgent, this.workspaceRoot);

        if (hostAgentContext) {
          // 使用清理后的消息（移除 @agent 标记）
          content = parsed.cleanMessage;

          // 通知前端 subagent 即将启动
          ws.send(JSON.stringify({
            type: 'subagent_start',
            agentName: hostAgentContext.config.name,
            agentDescription: hostAgentContext.config.description,
            message: content,
            timestamp: Date.now()
          }));

          console.log(`[ClaudeHandler] Triggering subagent: ${hostAgentContext.config.name}`);
        } else {
          console.warn(`[ClaudeHandler] Agent not found: ${parsed.hostAgent}`);
          // 列出可用 agent
          const available = listAvailableAgents(this.workspaceRoot);
          if (available.length > 0) {
            ws.send(JSON.stringify({
              type: 'agent_not_found',
              requestedAgent: parsed.hostAgent,
              availableAgents: available,
              timestamp: Date.now()
            }));
          }
        }
      }
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
    const session = this.sessionManager.getCurrent();
    const isNewSession = !session;

    console.log(`[ClaudeHandler] Current session:`, session?.id, 'messages:', session?.messages?.length, 'cwd:', session?.cwd);

    // 如果没有当前会话，先创建一个临时占位（会在收到 Claude CLI session ID 后更新）
    if (!session) {
      console.log(`[ClaudeHandler] No current session, creating temporary...`);
      // 先创建临时会话，但不保存到存储
      this.sessionManager.createTemporary();
    }

    // 处理附件中的图片（保存到临时文件并在消息中引用）
    let imagePaths: string[] = [];
    if (attachments && attachments.length > 0) {
      console.log(`[ClaudeHandler] Processing ${attachments.length} image attachments`);
      const fs = require('fs');
      const path = require('path');

      // 获取工作目录
      const session = this.sessionManager.getCurrent();
      const cwd = session?.cwd || process.cwd();

      // 创建临时图片目录
      const tempImageDir = path.join(cwd, '.claude', 'temp_images');
      if (!fs.existsSync(tempImageDir)) {
        fs.mkdirSync(tempImageDir, { recursive: true });
      }

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        // 解码 base64
        const buffer = Buffer.from(att.data, 'base64');
        // 生成文件名 - 从 mime type 提取扩展名
        const mimeType = att.type || 'application/octet-stream';
        const ext = mimeType.split('/')[1] || 'bin';
        const fileName = `uploaded_file_${Date.now()}_${i}.${ext}`;
        const filePath = path.join(tempImageDir, fileName);

        // 保存文件
        fs.writeFileSync(filePath, buffer);
        console.log(`[ClaudeHandler] Saved file to: ${filePath}, type: ${mimeType}`);
        imagePaths.push(filePath);
      }

      // 在消息内容前添加文件路径说明（使用完整路径并明确告诉 Claude 读取）
      // 注意：Windows 命令行中换行符会导致参数解析问题，所以用空格替代
      const fileDescription = imagePaths.map(p =>
        `【用户上传的文件】 文件路径: ${p} 请使用 Read 工具读取此文件内容进行分析。`
      ).join(' ');

      content = `${fileDescription} 用户说: ${content}`;
      console.log(`[ClaudeHandler] Added ${imagePaths.length} file references`);
    }

    // 创建用户消息（保留图片路径信息）
    const userMessage = createMessage('user', content);
    this.sessionManager.addMessage(userMessage);

    // 获取历史消息用于 API 调用
    const messages = this.sessionManager.getMessagesForAPI();

    // 获取当前会话信息（再次获取，因为可能已更新）
    const sessionInfo = this.sessionManager.getCurrent();
    // 使用前端传入的 targetSessionId 或从 sessionManager 获取的 ID
    // 这样确保与前端期望的 sessionId 一致
    const currentSessionId = targetSessionId || sessionInfo?.id || `temp-${Date.now()}`;
    console.log(`[ClaudeHandler] Using sessionId: ${currentSessionId} (targetSessionId: ${targetSessionId}, sessionInfo?.id: ${sessionInfo?.id})`);

    // 为每个会话创建独立的运行状态
    let sessionState = this.runningSessions.get(currentSessionId);
    if (!sessionState) {
      sessionState = {
        sessionId: currentSessionId,
        engine: new ClaudeCodeEngine(),
        ws: ws,
        sessionManager: this.sessionManager,
        isRunning: false,
        accumulatedContent: '',
        accumulatedThinking: ''
      };
      this.runningSessions.set(currentSessionId, sessionState);
      console.log(`[ClaudeHandler] Created new session state for ${currentSessionId}`);
    } else {
      console.log(`[ClaudeHandler] Reusing existing session state for ${currentSessionId}, updating ws`);
    }
    sessionState.ws = ws;
    sessionState.isRunning = true;
    // 重置累积内容
    sessionState.accumulatedContent = '';
    sessionState.accumulatedThinking = '';

    // 如果没有活跃会话，将当前会话设为活跃
    if (!this.activeSessionId) {
      this.activeSessionId = currentSessionId;
      console.log(`[ClaudeHandler] Set active session to: ${currentSessionId}`);
    }

    // 更新兼容状态（用于重连等旧逻辑）
    this.runningState = {
      sessionId: currentSessionId,
      ws: ws,
      isRunning: true
    };

    // 保存 sessionId 到局部常量，确保闭包中不会改变
    const sessionIdForCallbacks = currentSessionId;

    // 发送开始信号
    ws.send(JSON.stringify({
      type: 'claude_start',
      messageId: userMessage.id,
      sessionId: currentSessionId,
      timestamp: Date.now()
    }));

    try {
      // 获取当前会话的 Claude CLI session ID 和工作目录
      const session = this.sessionManager.getCurrent();
      const claudeSessionId = session?.claudeSessionId;
      const cwd = session?.cwd;

      // 使用会话独立的 engine
      const sessionEngine = sessionState.engine;

      // 调用 Claude
      const result = await sessionEngine.sendMessage(
        content,
        messages,
        (chunk, done, thinking, toolEvent) => {
          // 使用会话独立的 WebSocket
          const state = this.runningSessions.get(sessionIdForCallbacks);
          const currentWs = state?.ws;
          if (!currentWs || currentWs.readyState !== 1) return;

          // 检查当前会话是否是活跃会话（前端正在查看的）
          const isActive = this.isActiveSession(sessionIdForCallbacks);

          if (toolEvent) {
            // 工具事件：活跃会话直接发送，后台会话也发送（保持工具可见性）
            const toolData: any = {
              type: 'claude_tool',
              sessionId: sessionIdForCallbacks,
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
            currentWs.send(JSON.stringify(toolData));
          } else {
            // 内容流：活跃会话直接发送，后台会话累积内容
            if (isActive) {
              // 活跃会话：直接发送 + 清空累积内容
              currentWs.send(JSON.stringify({
                type: 'claude_stream',
                content: chunk,
                thinking: thinking,
                done,
                sessionId: sessionIdForCallbacks,
                timestamp: Date.now()
              }));
              // 清空累积内容（如果有的话）
              if (state) {
                state.accumulatedContent = '';
                state.accumulatedThinking = '';
              }
            } else {
              // 后台会话：累积内容
              if (state) {
                if (chunk) state.accumulatedContent += chunk;
                if (thinking) state.accumulatedThinking += thinking;

                // done 时发送完整内容，带上 replace 标志
                if (done) {
                  console.log(`[ClaudeHandler] Background session ${sessionIdForCallbacks} completed, sending accumulated content with replace flag`);
                  currentWs.send(JSON.stringify({
                    type: 'claude_stream',
                    content: state.accumulatedContent,
                    thinking: state.accumulatedThinking,
                    done: true,
                    replace: true,  // 标志：替换前端最后一条消息的内容
                    sessionId: sessionIdForCallbacks,
                    timestamp: Date.now()
                  }));
                  state.accumulatedContent = '';
                  state.accumulatedThinking = '';
                }
              }
            }
          }
        },
        (log: LogMessage) => {
          // 使用会话独立的 WebSocket
          const state = this.runningSessions.get(sessionIdForCallbacks);
          const currentWs = state?.ws;
          if (!currentWs || currentWs.readyState !== 1) return;

          // 日志只发送给活跃会话
          if (this.isActiveSession(sessionIdForCallbacks)) {
            currentWs.send(JSON.stringify({
              type: 'claude_log',
              level: log.level,
              message: log.message,
              sessionId: sessionIdForCallbacks,
              timestamp: log.timestamp
            }));
          }
        },
        claudeSessionId,
        cwd,
        hostAgentContext ? {
          name: hostAgentContext.config.name,
          description: hostAgentContext.config.description,
          systemPrompt: hostAgentContext.config.systemPrompt,
          tools: hostAgentContext.config.tools
        } : null
      );

      // 如果是新会话，使用 Claude CLI 返回的 session ID
      if (isNewSession && result.claudeSessionId) {
        // 更新会话 ID 为 Claude CLI 的 session ID
        this.sessionManager.updateSessionId(result.claudeSessionId);
        console.log(`[ClaudeHandler] Updated session ID to Claude CLI session: ${result.claudeSessionId}`);

        // 只有当会话标题是默认值时才用消息内容更新标题
        const sessionForTitle = this.sessionManager.getCurrent();
        const shouldUpdateTitle = !sessionForTitle?.title || sessionForTitle.title === 'New Chat';
        const newTitle = shouldUpdateTitle ? content.substring(0, 50) : sessionForTitle?.title;

        // 通知前端会话 ID 已更新
        const state = this.runningSessions.get(sessionIdForCallbacks);
        const currentWs = state?.ws;
        if (currentWs && currentWs.readyState === 1) {
          currentWs.send(JSON.stringify({
            type: 'session_id_updated',
            oldSessionId: session?.id,
            newSessionId: result.claudeSessionId,
            title: newTitle,
            sessionId: sessionIdForCallbacks,
            timestamp: Date.now()
          }));
        }
      } else if (result.claudeSessionId && result.claudeSessionId !== claudeSessionId) {
        // 保存 Claude CLI session ID（用于下次恢复会话）
        this.sessionManager.setClaudeSessionId(result.claudeSessionId);
        console.log(`[ClaudeHandler] Saved Claude CLI session ID: ${result.claudeSessionId}`);
      }

      // 保存助手响应
      const assistantMessage = createMessage('assistant', result.response);
      this.sessionManager.addMessage(assistantMessage);

      // 发送完成信号
      const state = this.runningSessions.get(sessionIdForCallbacks);
      const currentWs = state?.ws;
      console.log(`[ClaudeHandler] Sending claude_done for session ${sessionIdForCallbacks}, ws exists: ${!!currentWs}, ws ready: ${currentWs?.readyState}`);
      if (currentWs && currentWs.readyState === 1) {
        currentWs.send(JSON.stringify({
          type: 'claude_done',
          messageId: assistantMessage.id,
          sessionId: sessionIdForCallbacks,  // Use the actual session ID
          claudeSessionId: result.claudeSessionId,
          timestamp: Date.now()
        }));
        console.log(`[ClaudeHandler] claude_done sent for session ${sessionIdForCallbacks}`);
      } else {
        console.warn(`[ClaudeHandler] Cannot send claude_done for session ${sessionIdForCallbacks}: ws=${!!currentWs}, ready=${currentWs?.readyState}`);
      }

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCode = this.getErrorCode(errorMsg);
      sendError(errorCode, errorMsg);
    } finally {
      // 清除当前会话的运行状态
      const state = this.runningSessions.get(sessionIdForCallbacks);
      if (state) {
        state.isRunning = false;
        // 从 Map 中删除，表示会话已完成
        this.runningSessions.delete(sessionIdForCallbacks);
        console.log(`[ClaudeHandler] Session ${sessionIdForCallbacks} finished, removed from running sessions`);
      }

      // 更新兼容状态
      if (this.runningState.sessionId === sessionIdForCallbacks) {
        this.runningState.isRunning = false;
        this.runningState.sessionId = null;
      }
    }
  }

  handleSessionAction(
    ws: WebSocket,
    action: 'new' | 'resume' | 'list' | 'delete' | 'list_projects' | 'list_by_project' | 'rename' | 'load_more',
    sessionId?: string,
    projectId?: string,
    title?: string,
    limit?: number,
    beforeIndex?: number
  ): void {
    switch (action) {
      case 'new':
        // 创建临时会话（不保存到存储，等待第一条消息时获取 Claude CLI 的 session ID）
        const newSession = this.sessionManager.createTemporary(title);
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
        // 列出指定项目的会话（加载全部）
        if (projectId) {
          const sessionLimit = limit || 1000;  // 默认加载全部会话
          const projectSessions = SessionStorage.listSessionsByProject(projectId, sessionLimit);
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
          // 默认加载最后 3 条消息
          const loadLimit = limit || 3;
          let result: { session: ClaudeSession | null; hasMore: boolean; totalMessages: number };

          if (projectId) {
            // 从指定项目恢复会话（分页）
            result = SessionStorage.loadSessionFromProjectPaginated(projectId, sessionId, loadLimit);
            if (result.session) {
              this.sessionManager.setSessionFromCrossProject(result.session);
            }
          } else {
            // 从当前项目恢复会话（分页）
            result = this.sessionManager.resumePaginated(sessionId, loadLimit);
          }

          if (result.session) {
            // 转换消息格式：assistant -> model
            const messages = result.session.messages.map((msg: ClaudeMessage) => ({
              ...msg,
              role: msg.role === 'assistant' ? 'model' : msg.role
            }));
            ws.send(JSON.stringify({
              type: 'session_resumed',
              projectId: projectId,
              session: {
                id: result.session!.id,
                title: result.session!.title,
                summary: result.session!.title,
                messages,
                createdAt: result.session!.createdAt
              },
              hasMore: result.hasMore,
              totalMessages: result.totalMessages,
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

      case 'load_more':
        // 加载更多历史消息
        console.log(`[LoadMore] sessionId: ${sessionId}, limit: ${limit || 20}, beforeIndex: ${beforeIndex}`);
        if (sessionId) {
          const loadLimit = limit || 20;
          let result: { session: ClaudeSession | null; hasMore: boolean; totalMessages: number };

          if (projectId) {
            result = SessionStorage.loadSessionFromProjectPaginated(projectId, sessionId, loadLimit, beforeIndex);
          } else {
            result = this.sessionManager.resumePaginated(sessionId, loadLimit, beforeIndex);
          }

          console.log(`[LoadMore] result: hasMore=${result.hasMore}, totalMessages=${result.totalMessages}, messagesLoaded=${result.session?.messages.length}`);
          if (result.session) {
            const messages = result.session.messages.map((msg: ClaudeMessage) => ({
              ...msg,
              role: msg.role === 'assistant' ? 'model' : msg.role
            }));
            ws.send(JSON.stringify({
              type: 'messages_loaded',
              sessionId,
              projectId,
              messages,
              hasMore: result.hasMore,
              totalMessages: result.totalMessages,
              timestamp: Date.now()
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              content: 'Failed to load more messages',
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
