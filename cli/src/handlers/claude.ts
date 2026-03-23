import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import {
  ClaudeCodeEngine,
  ClaudeMessage,
  ClaudeSession,
  LogMessage,
  SessionInfo,
  SessionManager,
  ToolResultEvent,
  ToolUseEvent,
  createMessage,
  getProviderSessionId
} from '../claude';
import { SessionStorage } from '../claude/storage';
import { CodexCodeEngine } from '../codex';
import { CodexProjectInfo, CodexSessionStorage } from '../codexStorage';
import { parseAgentMentions, hasAgentMention, listAvailableAgents, loadAgentContext, AgentContext } from '../agent';
import { CommandHandler } from './commands';
import { DEFAULT_PROVIDER, Provider, decodeProjectId, encodeProjectId } from '../session/provider';

interface ProviderProjectInfo {
  id: string;
  rawId: string;
  provider: Provider;
  displayName: string;
  sessionCount: number;
  lastActivity: number;
}

interface ProviderEngine {
  stop(): boolean;
  isRunning(): boolean;
  sendMessage(
    message: string,
    messages: ClaudeMessage[],
    onChunk: (content: string, done: boolean, thinking?: string, toolEvent?: ToolUseEvent | ToolResultEvent) => void,
    onLog: (log: LogMessage) => void,
    providerSessionId?: string,
    cwd?: string,
    agentConfig?: { name: string; description?: string; systemPrompt?: string; tools?: string[] } | null,
    imagePaths?: string[]
  ): Promise<{ response: string; claudeSessionId?: string; providerSessionId?: string }>;
}

interface SessionRunState {
  sessionId: string;
  provider: Provider;
  engine: ProviderEngine;
  ws: WebSocket;
  isRunning: boolean;
  accumulatedContent: string;
  accumulatedThinking: string;
  bufferedLogs: LogMessage[];
}

export class ClaudeHandler {
  private sessionManager: SessionManager;
  private commandHandler: CommandHandler;
  private workspaceRoot?: string;
  private runningSessions: Map<string, SessionRunState> = new Map();
  private activeSessionId: string | null = null;
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
    this.sessionManager = new SessionManager(workspaceRoot);
    this.commandHandler = new CommandHandler(workspaceRoot);
    this.workspaceRoot = workspaceRoot;
    console.log(`[ClaudeHandler] Workspace: ${workspaceRoot || process.cwd()}`);
  }

  private createEngine(provider: Provider): ProviderEngine {
    return provider === 'codex' ? new CodexCodeEngine() : new ClaudeCodeEngine();
  }

  private normalizeProviderError(
    errorMessage: string,
    provider: Provider
  ): { code: string; message: string } {
    const normalized = errorMessage.trim();
    const lower = normalized.toLowerCase();
    const providerLabel = provider === 'codex' ? 'Codex' : 'Claude';

    if (
      lower.includes('stream disconnected before completion')
      || lower.includes('error decoding response body')
      || lower.includes('transport error')
      || lower.includes('network error')
    ) {
      return {
        code: 'STREAM_ERROR',
        message: `${providerLabel} upstream stream disconnected. This usually indicates the configured API proxy or network interrupted the response. Original error: ${normalized}`
      };
    }

    if (
      lower.includes('session not found')
      || lower.includes('no session found')
      || lower.includes('could not find session')
    ) {
      return {
        code: 'SESSION_NOT_FOUND',
        message: normalized
      };
    }

    return {
      code: this.getErrorCode(normalized),
      message: normalized
    };
  }

  private flushBufferedState(sessionId: string, state: SessionRunState): void {
    if (!state.ws || state.ws.readyState !== 1) {
      return;
    }

    for (const log of state.bufferedLogs) {
      state.ws.send(JSON.stringify({
        type: 'claude_log',
        level: log.level,
        message: log.message,
        sessionId,
        provider: state.provider,
        timestamp: log.timestamp
      }));
    }
    state.bufferedLogs = [];

    if (!state.accumulatedContent && !state.accumulatedThinking) {
      return;
    }

    state.ws.send(JSON.stringify({
      type: 'claude_stream',
      content: state.accumulatedContent,
      thinking: state.accumulatedThinking,
      done: false,
      replace: true,
      sessionId,
      provider: state.provider,
      timestamp: Date.now()
    }));

    state.accumulatedContent = '';
    state.accumulatedThinking = '';
  }

  private getProjectIdForSession(session: ClaudeSession): string | undefined {
    const rawProjectId = session.projectId || this.sessionManager.getProjectId(session.provider);
    return rawProjectId ? encodeProjectId(session.provider, rawProjectId) : undefined;
  }

  private resolveProvider(sessionId?: string, projectId?: string, provider?: Provider): Provider {
    if (sessionId) {
      const existingSession = this.sessionManager.get(sessionId);
      if (existingSession) {
        return existingSession.provider;
      }
    }

    const projectRef = decodeProjectId(projectId);
    if (projectRef) {
      return projectRef.provider;
    }

    return provider || DEFAULT_PROVIDER;
  }

  private loadCrossProjectSession(provider: Provider, rawProjectId: string, sessionId: string): ClaudeSession | null {
    return provider === 'codex'
      ? CodexSessionStorage.loadSessionFromProject(rawProjectId, sessionId)
      : SessionStorage.loadSessionFromProject(rawProjectId, sessionId);
  }

  private loadCrossProjectSessionPaginated(
    provider: Provider,
    rawProjectId: string,
    sessionId: string,
    limit: number,
    beforeIndex?: number
  ): { session: ClaudeSession | null; hasMore: boolean; totalMessages: number } {
    return provider === 'codex'
      ? CodexSessionStorage.loadSessionFromProjectPaginated(rawProjectId, sessionId, limit, beforeIndex)
      : SessionStorage.loadSessionFromProjectPaginated(rawProjectId, sessionId, limit, beforeIndex);
  }

  private deleteCrossProjectSession(provider: Provider, rawProjectId: string, sessionId: string): boolean {
    return provider === 'codex'
      ? CodexSessionStorage.deleteSessionFromProject(rawProjectId, sessionId)
      : SessionStorage.deleteSessionFromProject(rawProjectId, sessionId);
  }

  private renameCrossProjectSession(provider: Provider, rawProjectId: string, sessionId: string, newTitle: string): boolean {
    return provider === 'codex'
      ? CodexSessionStorage.renameSessionFromProject(rawProjectId, sessionId, newTitle)
      : SessionStorage.renameSessionFromProject(rawProjectId, sessionId, newTitle);
  }

  private listAllProjects(): ProviderProjectInfo[] {
    const claudeProjects: ProviderProjectInfo[] = SessionStorage.listAllProjects().map(project => ({
      id: encodeProjectId('claude', project.id),
      rawId: project.id,
      provider: 'claude',
      displayName: project.displayName,
      sessionCount: project.sessionCount,
      lastActivity: project.lastActivity
    }));

    const codexProjects: ProviderProjectInfo[] = CodexSessionStorage.listAllProjects().map((project: CodexProjectInfo) => ({
      id: encodeProjectId('codex', project.id),
      rawId: project.id,
      provider: 'codex',
      displayName: project.displayName,
      sessionCount: project.sessionCount,
      lastActivity: project.lastActivity
    }));

    return [...claudeProjects, ...codexProjects].sort((a, b) => b.lastActivity - a.lastActivity);
  }

  private listSessionsByProject(projectId: string, limit: number = 1000): SessionInfo[] {
    const projectRef = decodeProjectId(projectId);
    if (!projectRef) {
      return [];
    }

    const sessions = projectRef.provider === 'codex'
      ? CodexSessionStorage.listSessionsByProject(projectRef.projectKey, limit)
      : SessionStorage.listSessionsByProject(projectRef.projectKey, limit);

    return sessions.map(session => ({
      ...session,
      provider: projectRef.provider,
      projectId: encodeProjectId(projectRef.provider, projectRef.projectKey)
    }));
  }

  isRunning(): boolean {
    return Array.from(this.runningSessions.values()).some(state => state.isRunning || state.engine.isRunning());
  }

  cleanupStaleSessions(): void {
    const staleSessions: string[] = [];

    for (const [sessionId, state] of this.runningSessions) {
      if (state.isRunning && !state.engine.isRunning()) {
        staleSessions.push(sessionId);
      }
    }

    for (const sessionId of staleSessions) {
      console.log(`[ClaudeHandler] Cleaning up stale session: ${sessionId}`);
      this.runningSessions.delete(sessionId);
    }

    const hasRunningSession = Array.from(this.runningSessions.values()).some(state => state.isRunning);
    if (!hasRunningSession) {
      this.runningState = { sessionId: null, ws: null, isRunning: false };
    }
  }

  isSessionRunning(sessionId: string): boolean {
    return this.runningSessions.get(sessionId)?.isRunning ?? false;
  }

  getRunningSessionId(): string | null {
    for (const [sessionId, state] of this.runningSessions) {
      if (state.isRunning) {
        return sessionId;
      }
    }

    return null;
  }

  getAllRunningSessionIds(): string[] {
    return Array.from(this.runningSessions.entries())
      .filter(([, state]) => state.isRunning)
      .map(([sessionId]) => sessionId);
  }

  getRunningSessionSummaries(): Array<{ sessionId: string; title: string; projectId?: string; provider: Provider }> {
    return Array.from(this.runningSessions.entries())
      .filter(([, state]) => state.isRunning)
      .map(([sessionId, state]) => {
        const session = this.sessionManager.get(sessionId, state.provider);
        return {
          sessionId,
          title: session?.title || sessionId.substring(0, 12),
          projectId: session ? this.getProjectIdForSession(session) : undefined,
          provider: session?.provider || state.provider
        };
      });
  }

  setActiveSession(sessionId: string | null): void {
    console.log(`[ClaudeHandler] Setting active session: ${sessionId}`);
    this.activeSessionId = sessionId;

    if (!sessionId || !this.runningSessions.has(sessionId)) {
      return;
    }

    const state = this.runningSessions.get(sessionId);
    if (!state || !state.ws || state.ws.readyState !== 1) {
      return;
    }

    this.flushBufferedState(sessionId, state);
  }

  getActiveSession(): string | null {
    return this.activeSessionId;
  }

  isActiveSession(sessionId: string): boolean {
    return this.activeSessionId === sessionId;
  }

  updateRunningWebSocket(ws: WebSocket): boolean {
    let updated = false;

    for (const [sessionId, state] of this.runningSessions) {
      if (state.isRunning) {
        state.ws = ws;
        if (this.activeSessionId === sessionId) {
          this.flushBufferedState(sessionId, state);
        }
        updated = true;
      }
    }

    if (updated && this.runningState.isRunning) {
      this.runningState.ws = ws;
    }

    return updated;
  }

  updateSessionWebSocket(sessionId: string, ws: WebSocket): boolean {
    const state = this.runningSessions.get(sessionId);
    if (!state) {
      return false;
    }

    state.ws = ws;
    return true;
  }

  stopSession(sessionId: string): boolean {
    const state = this.runningSessions.get(sessionId);
    if (!state) {
      return false;
    }

    console.log(`[ClaudeHandler] Stopping session: ${sessionId}`);
    state.engine.stop();
    state.isRunning = false;
    this.runningSessions.delete(sessionId);

    if (this.runningState.sessionId === sessionId) {
      this.runningState = { sessionId: null, ws: null, isRunning: false };
    }

    return true;
  }

  stop(): boolean {
    console.log('[ClaudeHandler] Stopping all provider processes...');
    let stopped = false;

    for (const [, state] of this.runningSessions) {
      state.engine.stop();
      state.isRunning = false;
      stopped = true;
    }

    this.runningSessions.clear();
    this.runningState = { sessionId: null, ws: null, isRunning: false };
    return stopped;
  }

  async handleClaudeMessage(
    ws: WebSocket,
    originalContent: string,
    sendError: (code: string, message: string) => void,
    sessionId?: string,
    projectId?: string,
    attachments?: Array<{
      id: string;
      name: string;
      type: string;
      data: string;
    }>,
    provider?: Provider
  ): Promise<void> {
    const targetSessionId = sessionId || this.sessionManager.getCurrent()?.id;
    const requestedProvider = this.resolveProvider(sessionId, projectId, provider);

    if (targetSessionId && this.isSessionRunning(targetSessionId)) {
      sendError('SESSION_BUSY', 'Current session is already processing a request');
      return;
    }

    if (originalContent.startsWith('/')) {
      const parsed = this.commandHandler.parseCommand(originalContent);
      if (parsed) {
        const result = await this.commandHandler.execute(parsed.type, parsed.args);
        ws.send(JSON.stringify({
          type: 'command_result',
          command: parsed.type,
          success: result.success,
          data: result.data,
          error: result.error,
          sessionId,
          provider: requestedProvider,
          timestamp: Date.now()
        }));
        return;
      }
    }

    let content = originalContent;
    let agentConfig: AgentContext | null = null;

    if (hasAgentMention(content)) {
      const parsed = parseAgentMentions(content);
      if (parsed.hostAgent) {
        agentConfig = loadAgentContext(parsed.hostAgent, this.workspaceRoot);
        if (agentConfig) {
          content = parsed.cleanMessage;
          ws.send(JSON.stringify({
            type: 'subagent_start',
            agentName: agentConfig.config.name,
            agentDescription: agentConfig.config.description,
            message: content,
            provider: requestedProvider,
            timestamp: Date.now()
          }));
        } else {
          const available = listAvailableAgents(this.workspaceRoot);
          if (available.length > 0) {
            ws.send(JSON.stringify({
              type: 'agent_not_found',
              requestedAgent: parsed.hostAgent,
              availableAgents: available,
              provider: requestedProvider,
              timestamp: Date.now()
            }));
          }
        }
      }
    }

    if (sessionId && projectId) {
      const projectRef = decodeProjectId(projectId);
      if (projectRef) {
        const crossProjectSession = this.loadCrossProjectSession(projectRef.provider, projectRef.projectKey, sessionId);
        if (crossProjectSession) {
          this.sessionManager.setSessionFromCrossProject(crossProjectSession);
        }
      }
    } else if (sessionId) {
      this.sessionManager.resume(sessionId, requestedProvider);
    }

    if (!this.sessionManager.getCurrent()) {
      this.sessionManager.createTemporary(undefined, requestedProvider);
    }

    const sessionBeforePrompt = this.sessionManager.getCurrent();
    const providerForRun = sessionBeforePrompt?.provider || requestedProvider;
    const cwd = sessionBeforePrompt?.cwd || this.workspaceRoot || process.cwd();

    let promptToSend = content;
    let promptToStore = content;
    let imagePaths: string[] = [];

    if (attachments && attachments.length > 0) {
      const tempImageDir = path.join(cwd, '.coderemote', 'temp_images');
      if (!fs.existsSync(tempImageDir)) {
        fs.mkdirSync(tempImageDir, { recursive: true });
      }

      imagePaths = attachments.map((attachment, index) => {
        const buffer = Buffer.from(attachment.data, 'base64');
        const ext = (attachment.type || 'application/octet-stream').split('/')[1] || 'bin';
        const fileName = `uploaded_file_${Date.now()}_${index}.${ext}`;
        const filePath = path.join(tempImageDir, fileName);
        fs.writeFileSync(filePath, buffer);
        return filePath;
      });

      if (providerForRun === 'claude') {
        const fileDescription = imagePaths
          .map(filePath => `User uploaded file path: ${filePath}. Please read the file directly if needed.`)
          .join(' ');
        promptToSend = `${fileDescription} User message: ${content}`;
        promptToStore = promptToSend;
      }
    }

    const userMessage = createMessage('user', promptToStore);
    this.sessionManager.addMessage(userMessage);

    const messages = this.sessionManager.getMessagesForAPI();
    const sessionInfo = this.sessionManager.getCurrent();
    const currentSessionId = targetSessionId || sessionInfo?.id || `temp-${Date.now()}`;

    let sessionState = this.runningSessions.get(currentSessionId);
    if (!sessionState) {
        sessionState = {
          sessionId: currentSessionId,
          provider: providerForRun,
          engine: this.createEngine(providerForRun),
          ws,
          isRunning: false,
          accumulatedContent: '',
          accumulatedThinking: '',
          bufferedLogs: []
        };
        this.runningSessions.set(currentSessionId, sessionState);
      }

    sessionState.provider = providerForRun;
    sessionState.ws = ws;
    sessionState.isRunning = true;
    sessionState.accumulatedContent = '';
    sessionState.accumulatedThinking = '';
    sessionState.bufferedLogs = [];

    if (!this.activeSessionId) {
      this.activeSessionId = currentSessionId;
    }

    this.runningState = {
      sessionId: currentSessionId,
      ws,
      isRunning: true
    };

    const sessionIdForCallbacks = currentSessionId;
    ws.send(JSON.stringify({
      type: 'claude_start',
      messageId: userMessage.id,
      sessionId: currentSessionId,
      provider: providerForRun,
      timestamp: Date.now()
    }));

    try {
      const currentSession = this.sessionManager.getCurrent();
      const providerSessionId = currentSession ? getProviderSessionId(currentSession) : undefined;
      const sessionCwd = currentSession?.cwd || cwd;

      const result = await sessionState.engine.sendMessage(
        promptToSend,
        messages,
        (chunk, done, thinking, toolEvent) => {
          const state = this.runningSessions.get(sessionIdForCallbacks);
          const currentWs = state?.ws;
          if (!state || !currentWs || currentWs.readyState !== 1) {
            return;
          }

          const isActive = this.isActiveSession(sessionIdForCallbacks);

          if (toolEvent) {
            const toolData: any = {
              type: 'claude_tool',
              sessionId: sessionIdForCallbacks,
              provider: state.provider,
              timestamp: Date.now()
            };

            if ('toolName' in toolEvent) {
              toolData.toolName = toolEvent.toolName;
              toolData.toolInput = toolEvent.toolInput;
              toolData.toolUseId = toolEvent.toolUseId;
            } else {
              toolData.toolUseId = toolEvent.toolUseId;
              toolData.result = toolEvent.result;
              toolData.isError = toolEvent.isError;
            }

            currentWs.send(JSON.stringify(toolData));
            return;
          }

          if (isActive) {
            currentWs.send(JSON.stringify({
              type: 'claude_stream',
              content: chunk,
              thinking,
              done,
              sessionId: sessionIdForCallbacks,
              provider: state.provider,
              timestamp: Date.now()
            }));
            state.accumulatedContent = '';
            state.accumulatedThinking = '';
            return;
          }

          if (chunk) {
            state.accumulatedContent += chunk;
          }
          if (thinking) {
            state.accumulatedThinking += thinking;
          }

          if (done) {
            currentWs.send(JSON.stringify({
              type: 'claude_stream',
              content: state.accumulatedContent,
              thinking: state.accumulatedThinking,
              done: true,
              replace: true,
              sessionId: sessionIdForCallbacks,
              provider: state.provider,
              timestamp: Date.now()
            }));
            state.accumulatedContent = '';
            state.accumulatedThinking = '';
          }
        },
        (log: LogMessage) => {
          const state = this.runningSessions.get(sessionIdForCallbacks);
          const currentWs = state?.ws;
          if (!state || !currentWs || currentWs.readyState !== 1) {
            return;
          }

          if (!this.isActiveSession(sessionIdForCallbacks)) {
            state.bufferedLogs.push(log);
            return;
          }

          currentWs.send(JSON.stringify({
            type: 'claude_log',
            level: log.level,
            message: log.message,
            sessionId: sessionIdForCallbacks,
            provider: state.provider,
            timestamp: log.timestamp
          }));
        },
        providerSessionId,
        sessionCwd,
        agentConfig ? {
          name: agentConfig.config.name,
          description: agentConfig.config.description,
          systemPrompt: agentConfig.config.systemPrompt,
          tools: agentConfig.config.tools
        } : null,
        imagePaths
      );

      const returnedProviderSessionId = providerForRun === 'claude'
        ? result.claudeSessionId || result.providerSessionId
        : result.providerSessionId;
      const existingProviderSessionId = currentSession ? getProviderSessionId(currentSession) : undefined;
      const responseSessionId = returnedProviderSessionId || sessionIdForCallbacks;

      if ((!sessionId || sessionId === currentSessionId) && returnedProviderSessionId && returnedProviderSessionId !== currentSessionId) {
        this.sessionManager.updateSessionId(returnedProviderSessionId);
        const updatedSession = this.sessionManager.getCurrent();
        const state = this.runningSessions.get(sessionIdForCallbacks);
        const currentWs = state?.ws;

        if (currentWs && currentWs.readyState === 1) {
          currentWs.send(JSON.stringify({
            type: 'session_id_updated',
            oldSessionId: currentSessionId,
            newSessionId: returnedProviderSessionId,
            title: updatedSession?.title || content.substring(0, 50),
            provider: providerForRun,
            projectId: updatedSession ? this.getProjectIdForSession(updatedSession) : undefined,
            timestamp: Date.now()
          }));
        }
      } else if (returnedProviderSessionId && returnedProviderSessionId !== existingProviderSessionId) {
        this.sessionManager.setProviderSessionId(returnedProviderSessionId);
      }

      const assistantMessage = createMessage('assistant', result.response);
      this.sessionManager.addMessage(assistantMessage);

      const state = this.runningSessions.get(sessionIdForCallbacks);
      const currentWs = state?.ws;
      if (currentWs && currentWs.readyState === 1) {
        currentWs.send(JSON.stringify({
          type: 'claude_done',
          messageId: assistantMessage.id,
          sessionId: responseSessionId,
          provider: providerForRun,
          providerSessionId: returnedProviderSessionId,
          claudeSessionId: providerForRun === 'claude' ? returnedProviderSessionId : undefined,
          projectId: this.sessionManager.getCurrent() ? this.getProjectIdForSession(this.sessionManager.getCurrent()!) : undefined,
          timestamp: Date.now()
        }));
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const normalizedError = this.normalizeProviderError(errorMessage, providerForRun);
      sendError(normalizedError.code, normalizedError.message);
    } finally {
      const state = this.runningSessions.get(sessionIdForCallbacks);
      if (state) {
        state.isRunning = false;
        this.runningSessions.delete(sessionIdForCallbacks);
      }

      if (this.runningState.sessionId === sessionIdForCallbacks) {
        this.runningState = { sessionId: null, ws: null, isRunning: false };
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
    beforeIndex?: number,
    provider?: Provider
  ): void {
    switch (action) {
      case 'new': {
        const providerForNewSession = provider || DEFAULT_PROVIDER;
        const newSession = this.sessionManager.createTemporary(title, providerForNewSession);
        ws.send(JSON.stringify({
          type: 'session_created',
          session: {
            id: newSession.id,
            title: newSession.title,
            createdAt: newSession.createdAt,
            messageCount: 0,
            isTemporary: true,
            provider: providerForNewSession
          },
          projectId: encodeProjectId(providerForNewSession, this.sessionManager.getProjectId(providerForNewSession)),
          provider: providerForNewSession,
          timestamp: Date.now()
        }));
        break;
      }

      case 'list': {
        const sessions = this.sessionManager.list(provider);
        ws.send(JSON.stringify({
          type: 'session_list',
          sessions,
          provider,
          timestamp: Date.now()
        }));
        break;
      }

      case 'list_projects': {
        const projects = this.listAllProjects();
        ws.send(JSON.stringify({
          type: 'project_list',
          projects,
          timestamp: Date.now()
        }));
        break;
      }

      case 'list_by_project': {
        if (!projectId) {
          break;
        }

        const sessions = this.listSessionsByProject(projectId, limit || 1000);
        ws.send(JSON.stringify({
          type: 'session_list',
          projectId,
          sessions,
          timestamp: Date.now()
        }));
        break;
      }

      case 'resume': {
        if (!sessionId) {
          break;
        }

        const loadLimit = limit || 3;
        let result: { session: ClaudeSession | null; hasMore: boolean; totalMessages: number };

        if (projectId) {
          const projectRef = decodeProjectId(projectId);
          result = projectRef
            ? this.loadCrossProjectSessionPaginated(projectRef.provider, projectRef.projectKey, sessionId, loadLimit)
            : { session: null, hasMore: false, totalMessages: 0 };
          if (result.session) {
            this.sessionManager.setSessionFromCrossProject(result.session);
          }
        } else {
          result = this.sessionManager.resumePaginated(sessionId, loadLimit, undefined, provider);
        }

        if (!result.session) {
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Session not found',
            timestamp: Date.now()
          }));
          break;
        }

        const messages = result.session.messages.map((message: ClaudeMessage) => ({
          ...message,
          role: message.role === 'assistant' ? 'model' : message.role
        }));

        ws.send(JSON.stringify({
          type: 'session_resumed',
          projectId: this.getProjectIdForSession(result.session),
          provider: result.session.provider,
          session: {
            id: result.session.id,
            title: result.session.title,
            summary: result.session.title,
            messages,
            createdAt: result.session.createdAt,
            provider: result.session.provider
          },
          hasMore: result.hasMore,
          totalMessages: result.totalMessages,
          timestamp: Date.now()
        }));
        break;
      }

      case 'load_more': {
        if (!sessionId) {
          break;
        }

        const loadLimit = limit || 20;
        let result: { session: ClaudeSession | null; hasMore: boolean; totalMessages: number };

        if (projectId) {
          const projectRef = decodeProjectId(projectId);
          result = projectRef
            ? this.loadCrossProjectSessionPaginated(projectRef.provider, projectRef.projectKey, sessionId, loadLimit, beforeIndex)
            : { session: null, hasMore: false, totalMessages: 0 };
        } else {
          result = this.sessionManager.resumePaginated(sessionId, loadLimit, beforeIndex, provider);
        }

        if (!result.session) {
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Failed to load more messages',
            timestamp: Date.now()
          }));
          break;
        }

        const messages = result.session.messages.map((message: ClaudeMessage) => ({
          ...message,
          role: message.role === 'assistant' ? 'model' : message.role
        }));

        ws.send(JSON.stringify({
          type: 'messages_loaded',
          sessionId,
          projectId: this.getProjectIdForSession(result.session),
          provider: result.session.provider,
          messages,
          hasMore: result.hasMore,
          totalMessages: result.totalMessages,
          timestamp: Date.now()
        }));
        break;
      }

      case 'delete': {
        if (!sessionId) {
          break;
        }

        let deleted = false;
        if (projectId) {
          const projectRef = decodeProjectId(projectId);
          deleted = projectRef ? this.deleteCrossProjectSession(projectRef.provider, projectRef.projectKey, sessionId) : false;
        } else {
          deleted = this.sessionManager.delete(sessionId, provider);
        }

        ws.send(JSON.stringify({
          type: 'session_deleted',
          sessionId,
          projectId,
          provider: projectId ? decodeProjectId(projectId)?.provider : provider,
          success: deleted,
          timestamp: Date.now()
        }));
        break;
      }

      case 'rename': {
        if (!sessionId || !title) {
          break;
        }

        let renamed = false;
        let providerForRename = provider;

        if (projectId) {
          const projectRef = decodeProjectId(projectId);
          providerForRename = projectRef?.provider;
          renamed = projectRef ? this.renameCrossProjectSession(projectRef.provider, projectRef.projectKey, sessionId, title) : false;
        } else {
          renamed = this.sessionManager.rename(sessionId, title, provider);
          providerForRename = providerForRename || this.sessionManager.get(sessionId)?.provider;
        }

        ws.send(JSON.stringify({
          type: 'session_renamed',
          sessionId,
          projectId,
          provider: providerForRename,
          title,
          success: renamed,
          timestamp: Date.now()
        }));
        break;
      }
    }
  }

  private getErrorCode(errorMessage: string): string {
    const lower = errorMessage.toLowerCase();

    if (
      lower.includes('not found')
      || lower.includes('enoent')
      || lower.includes('is not recognized as an internal or external command')
      || lower.includes('no such file or directory')
    ) {
      return 'CLI_NOT_FOUND';
    }
    if (lower.includes('api key') || lower.includes('apikey') || lower.includes('auth token')) {
      return 'API_KEY_MISSING';
    }
    if (lower.includes('rate limit') || lower.includes('429')) {
      return 'RATE_LIMITED';
    }
    if (lower.includes('session not found')) {
      return 'SESSION_NOT_FOUND';
    }
    if (lower.includes('busy')) {
      return 'SESSION_BUSY';
    }
    return 'STREAM_ERROR';
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  getSessionStorage(provider?: Provider): SessionStorage | CodexSessionStorage {
    return this.sessionManager.getStorage(provider);
  }
}
