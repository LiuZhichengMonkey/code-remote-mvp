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
import { AccessIdentity, createAdminAccessIdentity, isAdminAccess } from '../accessControl';
import { SessionAccessStore } from '../sessionAccess';
import { CommandHandler } from './commands';
import { DEFAULT_PROVIDER, Provider, decodeProjectId, encodeProjectId } from '../session/provider';
import { resolveSessionWorkspace } from '../sessionWorkspace';
import {
  createRemoteAttachmentDescriptor,
  resolveAccessibleWorkspaceRoot,
  sanitizeUploadFileName
} from '../fileBrowser';

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

type RunningStateSnapshotReason = 'reconnect' | 'focus' | 'resume';

export class ClaudeHandler {
  private sessionManager: SessionManager;
  private commandHandler: CommandHandler;
  private accessStore: SessionAccessStore;
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
    this.accessStore = new SessionAccessStore(workspaceRoot);
    this.workspaceRoot = workspaceRoot;
    console.log(`[ClaudeHandler] Workspace: ${workspaceRoot || process.cwd()}`);
  }

  private createEngine(provider: Provider): ProviderEngine {
    return provider === 'codex' ? new CodexCodeEngine() : new ClaudeCodeEngine();
  }

  private resolveSessionWorkspaceContext(accessIdentity?: AccessIdentity): { cwd: string; projectId: string } {
    const context = resolveSessionWorkspace(this.workspaceRoot || process.cwd(), accessIdentity);
    return {
      cwd: context.workspacePath,
      projectId: context.projectId
    };
  }

  private applySessionWorkspaceContext(session: ClaudeSession, accessIdentity?: AccessIdentity): ClaudeSession {
    const context = this.resolveSessionWorkspaceContext(accessIdentity);

    if (!session.cwd) {
      session.cwd = context.cwd;
    }

    if (!session.projectId) {
      session.projectId = context.projectId;
    }

    return session;
  }

  private getWorkspaceRootForSession(
    session: Pick<ClaudeSession, 'cwd'>,
    accessIdentity?: AccessIdentity
  ): string {
    return session.cwd
      || resolveAccessibleWorkspaceRoot(this.workspaceRoot || process.cwd(), accessIdentity);
  }

  private serializeMessageForClient(
    message: ClaudeMessage,
    workspaceRoot: string
  ): Record<string, unknown> {
    const attachments = (message.images || []).flatMap((filePath, index) => {
      try {
        return [createRemoteAttachmentDescriptor(workspaceRoot, filePath, {
          id: `${message.id}-attachment-${index}`,
          allowExternal: true,
          includeMissing: true
        })];
      } catch {
        return [];
      }
    });

    return {
      ...message,
      role: message.role === 'assistant' ? 'model' : message.role,
      ...(attachments.length > 0 ? { attachments } : {})
    };
  }

  private sessionAlreadyContainsAssistantResponse(session: ClaudeSession | null, response: string): boolean {
    if (!session || !response.trim()) {
      return false;
    }

    const lastAssistantMessage = [...session.messages]
      .reverse()
      .find(message => message.role === 'assistant');

    return lastAssistantMessage?.content.trim() === response.trim();
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

  private sendRunningStateSnapshot(
    sessionId: string,
    state: SessionRunState,
    reason: RunningStateSnapshotReason
  ): void {
    if (!state.ws || state.ws.readyState !== 1) {
      return;
    }

    const session = this.sessionManager.get(sessionId, state.provider);
    state.ws.send(JSON.stringify({
      type: 'session_running_state',
      sessionId,
      title: session?.title || sessionId.substring(0, 12),
      projectId: session ? this.getProjectIdForSession(session) : undefined,
      provider: session?.provider || state.provider,
      hasBufferedContent: Boolean(state.accumulatedContent || state.accumulatedThinking),
      hasBufferedLogs: state.bufferedLogs.length > 0,
      reason,
      timestamp: Date.now()
    }));
  }

  private getProjectIdForSession(session: ClaudeSession): string | undefined {
    const rawProjectId = session.projectId
      || (session.cwd ? resolveSessionWorkspace(session.cwd).projectId : undefined)
      || this.sessionManager.getProjectId(session.provider);
    return rawProjectId ? encodeProjectId(session.provider, rawProjectId) : undefined;
  }

  private getRawProjectIdForSession(session: Pick<ClaudeSession, 'provider' | 'projectId' | 'cwd'>): string {
    return session.projectId
      || (session.cwd ? resolveSessionWorkspace(session.cwd).projectId : '')
      || this.sessionManager.getProjectId(session.provider);
  }

  private getEffectiveAccessIdentity(accessIdentity?: AccessIdentity): AccessIdentity {
    return accessIdentity || createAdminAccessIdentity();
  }

  private assignSessionAccess(
    sessionId: string,
    provider: Provider,
    projectId: string,
    accessIdentity?: AccessIdentity
  ): void {
    this.accessStore.assignSession(provider, projectId, sessionId, this.getEffectiveAccessIdentity(accessIdentity));
  }

  private moveSessionAccess(
    oldSessionId: string,
    newSessionId: string,
    provider: Provider,
    projectId: string
  ): void {
    this.accessStore.moveSession(provider, projectId, oldSessionId, newSessionId);
  }

  private canAccessSessionInfo(
    session: Pick<SessionInfo, 'id' | 'provider' | 'projectId'>,
    accessIdentity?: AccessIdentity
  ): boolean {
    const identity = this.getEffectiveAccessIdentity(accessIdentity);
    if (isAdminAccess(identity)) {
      return true;
    }

    if (!session.projectId) {
      return false;
    }

    const projectRef = decodeProjectId(session.projectId);
    const rawProjectId = projectRef?.projectKey || session.projectId;
    const provider = projectRef?.provider || session.provider;

    return this.accessStore.canAccessSession(identity, provider, rawProjectId, session.id);
  }

  private filterSessionsByAccess(sessions: SessionInfo[], accessIdentity?: AccessIdentity): SessionInfo[] {
    const identity = this.getEffectiveAccessIdentity(accessIdentity);
    if (isAdminAccess(identity)) {
      return sessions;
    }

    return sessions.filter(session => this.canAccessSessionInfo(session, identity));
  }

  private findSessionForAccess(sessionId: string, provider?: Provider): ClaudeSession | null {
    const cachedSession = this.sessionManager.get(sessionId, provider);
    if (cachedSession) {
      return cachedSession;
    }

    const providersToTry: Provider[] = provider ? [provider] : ['claude', 'codex'];

    for (const candidate of providersToTry) {
      const storage = this.sessionManager.getStorageByProvider(candidate);
      const session = storage.load(sessionId);
      if (session) {
        return session;
      }
    }

    const record = this.accessStore.findRecordBySessionId(sessionId, provider);
    if (!record) {
      return null;
    }

    return this.loadCrossProjectSession(record.provider, record.projectId, sessionId);
  }

  canAccessSession(
    sessionId: string,
    accessIdentity?: AccessIdentity,
    projectId?: string,
    provider?: Provider
  ): boolean {
    const identity = this.getEffectiveAccessIdentity(accessIdentity);
    if (isAdminAccess(identity)) {
      return true;
    }

    if (projectId) {
      const projectRef = decodeProjectId(projectId);
      const rawProjectId = projectRef?.projectKey || projectId;
      const effectiveProvider = projectRef?.provider || provider;
      return effectiveProvider
        ? this.accessStore.canAccessSession(identity, effectiveProvider, rawProjectId, sessionId)
        : false;
    }

    const session = this.findSessionForAccess(sessionId, provider);
    if (!session) {
      return false;
    }

    return this.accessStore.canAccessSession(
      identity,
      session.provider,
      this.getRawProjectIdForSession(session),
      session.id
    );
  }

  getSessionForAccess(
    sessionId: string,
    accessIdentity?: AccessIdentity,
    projectId?: string,
    provider?: Provider
  ): ClaudeSession | null {
    if (!this.canAccessSession(sessionId, accessIdentity, projectId, provider)) {
      return null;
    }

    if (projectId) {
      const projectRef = decodeProjectId(projectId);
      if (projectRef) {
        const session = this.loadCrossProjectSession(projectRef.provider, projectRef.projectKey, sessionId);
        if (session) {
          this.sessionManager.setSessionFromCrossProject(session);
        }
        return session;
      }
    }

    return this.sessionManager.get(sessionId, provider) || this.findSessionForAccess(sessionId, provider);
  }

  private resolveProvider(sessionId?: string, projectId?: string, provider?: Provider): Provider {
    if (sessionId) {
      const existingSession = this.findSessionForAccess(sessionId, provider);
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

  private listAllProjects(accessIdentity?: AccessIdentity): ProviderProjectInfo[] {
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

    const projects = [...claudeProjects, ...codexProjects].sort((a, b) => b.lastActivity - a.lastActivity);
    const identity = this.getEffectiveAccessIdentity(accessIdentity);
    if (isAdminAccess(identity)) {
      return projects;
    }

    return projects.flatMap(project => {
      const sessions = this.listSessionsByProject(project.id, 1000, identity);
      if (sessions.length === 0) {
        return [];
      }

      return [{
        ...project,
        sessionCount: sessions.length,
        lastActivity: sessions.reduce((latest, session) => Math.max(latest, session.lastActivity || session.createdAt), 0)
      }];
    });
  }

  private listSessionsByProject(projectId: string, limit: number = 1000, accessIdentity?: AccessIdentity): SessionInfo[] {
    const projectRef = decodeProjectId(projectId);
    if (!projectRef) {
      return [];
    }

    const sessions = projectRef.provider === 'codex'
      ? CodexSessionStorage.listSessionsByProject(projectRef.projectKey, limit)
      : SessionStorage.listSessionsByProject(projectRef.projectKey, limit);

    return this.filterSessionsByAccess(sessions.map(session => ({
      ...session,
      provider: projectRef.provider,
      projectId: encodeProjectId(projectRef.provider, projectRef.projectKey)
    })), accessIdentity);
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

  getRunningSessionSummaries(accessIdentity?: AccessIdentity): Array<{ sessionId: string; title: string; projectId?: string; provider: Provider }> {
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
      })
      .filter(session => this.canAccessSession(session.sessionId, accessIdentity, session.projectId, session.provider));
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

    this.sendRunningStateSnapshot(sessionId, state, 'focus');
    this.flushBufferedState(sessionId, state);
  }

  getActiveSession(): string | null {
    return this.activeSessionId;
  }

  isActiveSession(sessionId: string): boolean {
    return this.activeSessionId === sessionId;
  }

  updateRunningWebSocket(ws: WebSocket, accessIdentity?: AccessIdentity): boolean {
    let updated = false;

    for (const [sessionId, state] of this.runningSessions) {
      if (!state.isRunning) {
        continue;
      }

      const session = this.sessionManager.get(sessionId, state.provider);
      const projectId = session ? this.getProjectIdForSession(session) : undefined;
      if (!this.canAccessSession(sessionId, accessIdentity, projectId, state.provider)) {
        continue;
      }

      state.ws = ws;
      this.sendRunningStateSnapshot(sessionId, state, 'reconnect');
      if (this.activeSessionId === sessionId) {
        this.flushBufferedState(sessionId, state);
      }
      updated = true;
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

  stopSession(sessionId: string, accessIdentity?: AccessIdentity, projectId?: string, provider?: Provider): boolean {
    if (!this.canAccessSession(sessionId, accessIdentity, projectId, provider)) {
      return false;
    }

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

  stopAccessibleSessions(accessIdentity?: AccessIdentity): boolean {
    const identity = this.getEffectiveAccessIdentity(accessIdentity);
    if (isAdminAccess(identity)) {
      return this.stop();
    }

    let stopped = false;
    for (const sessionId of Array.from(this.runningSessions.keys())) {
      stopped = this.stopSession(sessionId, identity) || stopped;
    }

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
    provider?: Provider,
    accessIdentity?: AccessIdentity
  ): Promise<void> {
    if (sessionId && !this.canAccessSession(sessionId, accessIdentity, projectId, provider)) {
      sendError('SESSION_NOT_FOUND', 'Session not found');
      return;
    }

    const targetSessionId = sessionId;
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

    const defaultSessionWorkspace = this.resolveSessionWorkspaceContext(accessIdentity);
    let workingSession: ClaudeSession | null = null;

    if (sessionId && projectId) {
      const projectRef = decodeProjectId(projectId);
      if (projectRef) {
        const crossProjectSession = this.loadCrossProjectSession(projectRef.provider, projectRef.projectKey, sessionId);
        if (crossProjectSession) {
          this.sessionManager.setSessionFromCrossProject(crossProjectSession);
          workingSession = crossProjectSession;
        }
      }
    } else if (sessionId) {
      workingSession = this.sessionManager.resume(sessionId, requestedProvider);
      if (!workingSession) {
        workingSession = this.findSessionForAccess(sessionId, requestedProvider);
        if (workingSession) {
          this.sessionManager.setSessionFromCrossProject(workingSession);
        }
      }
    }

    if (!workingSession) {
      workingSession = this.sessionManager.createTemporary(undefined, requestedProvider, defaultSessionWorkspace);
    }

    workingSession = this.applySessionWorkspaceContext(workingSession, accessIdentity);
    this.assignSessionAccess(
      workingSession.id,
      workingSession.provider,
      this.getRawProjectIdForSession(workingSession),
      accessIdentity
    );

    const providerForRun = workingSession.provider || requestedProvider;
    const cwd = workingSession.cwd || defaultSessionWorkspace.cwd;

    let promptToSend = content;
    let promptToStore = content;
    let imagePaths: string[] = [];
    const workspaceRoot = this.getWorkspaceRootForSession(workingSession, accessIdentity);

    if (attachments && attachments.length > 0) {
      const tempImageDir = path.join(cwd, '.coderemote', 'temp_images');
      if (!fs.existsSync(tempImageDir)) {
        fs.mkdirSync(tempImageDir, { recursive: true });
      }

      imagePaths = attachments.map((attachment, index) => {
        const buffer = Buffer.from(attachment.data || '', 'base64');
        const fileName = sanitizeUploadFileName(attachment.name, index);
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

    const userMessage = createMessage('user', promptToStore, imagePaths);
    this.sessionManager.addMessageToSession(workingSession.id, userMessage, workingSession.provider);

    const messages = this.sessionManager.getMessagesForSession(workingSession.id, workingSession.provider);
    const currentSessionId = targetSessionId || workingSession.id || `temp-${Date.now()}`;

    if (attachments && attachments.length > 0 && ws.readyState === 1) {
      const registeredAttachments = attachments.flatMap((attachment, index) => {
        const filePath = imagePaths[index];
        if (!filePath) {
          return [];
        }

        try {
          return [createRemoteAttachmentDescriptor(workspaceRoot, filePath, {
            id: attachment.id,
            originalName: attachment.name,
            mimeType: attachment.type
          })];
        } catch {
          return [];
        }
      });

      if (registeredAttachments.length > 0) {
        ws.send(JSON.stringify({
          type: 'attachments_registered',
          sessionId: currentSessionId,
          provider: providerForRun,
          attachments: registeredAttachments,
          timestamp: Date.now()
        }));
      }
    }

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
      const providerSessionId = getProviderSessionId(workingSession);
      const sessionCwd = workingSession.cwd || cwd;

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
      const existingProviderSessionId = getProviderSessionId(workingSession);
      const responseSessionId = returnedProviderSessionId || sessionIdForCallbacks;
      let finalSession = workingSession;

      if ((!sessionId || sessionId === currentSessionId) && returnedProviderSessionId && returnedProviderSessionId !== currentSessionId) {
        const currentProjectId = this.getRawProjectIdForSession(workingSession);
        const updatedSession = this.sessionManager.updateSessionIdForSession(currentSessionId, returnedProviderSessionId, providerForRun);
        if (updatedSession) {
          finalSession = this.applySessionWorkspaceContext(updatedSession, accessIdentity);
        }
        this.moveSessionAccess(currentSessionId, returnedProviderSessionId, providerForRun, currentProjectId);
        const state = this.runningSessions.get(sessionIdForCallbacks);
        const currentWs = state?.ws;

        if (currentWs && currentWs.readyState === 1) {
          currentWs.send(JSON.stringify({
            type: 'session_id_updated',
            oldSessionId: currentSessionId,
            newSessionId: returnedProviderSessionId,
            title: finalSession?.title || content.substring(0, 50),
            provider: providerForRun,
            projectId: finalSession ? this.getProjectIdForSession(finalSession) : undefined,
            timestamp: Date.now()
          }));
        }
      } else if (returnedProviderSessionId && returnedProviderSessionId !== existingProviderSessionId) {
        const updatedSession = this.sessionManager.setProviderSessionIdForSession(workingSession.id, returnedProviderSessionId, providerForRun);
        if (updatedSession) {
          finalSession = updatedSession;
        }
      }

      let assistantMessageId = `done-${responseSessionId}`;
      if (!this.sessionAlreadyContainsAssistantResponse(finalSession, result.response)) {
        const assistantMessage = createMessage('assistant', result.response);
        assistantMessageId = assistantMessage.id;
        this.sessionManager.addMessageToSession(finalSession.id, assistantMessage, finalSession.provider);
      } else {
        const lastAssistantMessage = [...finalSession.messages]
          .reverse()
          .find(message => message.role === 'assistant');
        if (lastAssistantMessage?.id) {
          assistantMessageId = lastAssistantMessage.id;
        }
      }

      if (finalSession) {
        this.assignSessionAccess(
          finalSession.id,
          finalSession.provider,
          this.getRawProjectIdForSession(finalSession),
          accessIdentity
        );
      }

      const state = this.runningSessions.get(sessionIdForCallbacks);
      const currentWs = state?.ws;
      if (currentWs && currentWs.readyState === 1) {
        currentWs.send(JSON.stringify({
          type: 'claude_done',
          messageId: assistantMessageId,
          sessionId: responseSessionId,
          provider: providerForRun,
          providerSessionId: returnedProviderSessionId,
          claudeSessionId: providerForRun === 'claude' ? returnedProviderSessionId : undefined,
          projectId: finalSession ? this.getProjectIdForSession(finalSession) : undefined,
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
    provider?: Provider,
    accessIdentity?: AccessIdentity
  ): void {
    switch (action) {
      case 'new': {
        const providerForNewSession = provider || DEFAULT_PROVIDER;
        const newSession = this.applySessionWorkspaceContext(
          this.sessionManager.createTemporary(
            title,
            providerForNewSession,
            this.resolveSessionWorkspaceContext(accessIdentity)
          ),
          accessIdentity
        );
        this.assignSessionAccess(
          newSession.id,
          providerForNewSession,
          this.getRawProjectIdForSession(newSession),
          accessIdentity
        );
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
          projectId: this.getProjectIdForSession(newSession),
          provider: providerForNewSession,
          timestamp: Date.now()
        }));
        break;
      }

      case 'list': {
        const sessions = this.filterSessionsByAccess(this.sessionManager.list(provider), accessIdentity);
        ws.send(JSON.stringify({
          type: 'session_list',
          sessions,
          provider,
          timestamp: Date.now()
        }));
        break;
      }

      case 'list_projects': {
        const projects = this.listAllProjects(accessIdentity);
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

        const sessions = this.listSessionsByProject(projectId, limit || 1000, accessIdentity);
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

        if (!this.canAccessSession(sessionId, accessIdentity, projectId, provider)) {
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Session not found',
            timestamp: Date.now()
          }));
          break;
        }

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

        const workspaceRoot = this.getWorkspaceRootForSession(result.session, accessIdentity);
        const messages = result.session.messages.map((message: ClaudeMessage) => (
          this.serializeMessageForClient(message, workspaceRoot)
        ));

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

        const runningState = this.runningSessions.get(result.session.id);
        if (runningState?.isRunning) {
          runningState.ws = ws;
          this.sendRunningStateSnapshot(result.session.id, runningState, 'resume');
          if (this.activeSessionId === result.session.id) {
            this.flushBufferedState(result.session.id, runningState);
          }
        }
        break;
      }

      case 'load_more': {
        if (!sessionId) {
          break;
        }

        const loadLimit = limit || 20;
        let result: { session: ClaudeSession | null; hasMore: boolean; totalMessages: number };

        if (!this.canAccessSession(sessionId, accessIdentity, projectId, provider)) {
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Failed to load more messages',
            timestamp: Date.now()
          }));
          break;
        }

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

        const workspaceRoot = this.getWorkspaceRootForSession(result.session, accessIdentity);
        const messages = result.session.messages.map((message: ClaudeMessage) => (
          this.serializeMessageForClient(message, workspaceRoot)
        ));

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
          deleted = projectRef && this.canAccessSession(sessionId, accessIdentity, projectId, projectRef.provider)
            ? this.deleteCrossProjectSession(projectRef.provider, projectRef.projectKey, sessionId)
            : false;
          if (deleted && projectRef) {
            this.accessStore.deleteSession(projectRef.provider, projectRef.projectKey, sessionId);
          }
        } else {
          const existingSession = this.findSessionForAccess(sessionId, provider);
          deleted = this.canAccessSession(sessionId, accessIdentity, undefined, provider)
            ? this.sessionManager.delete(sessionId, provider)
            : false;
          if (deleted && existingSession) {
            this.accessStore.deleteSession(existingSession.provider, this.getRawProjectIdForSession(existingSession), sessionId);
          }
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
          renamed = projectRef && this.canAccessSession(sessionId, accessIdentity, projectId, projectRef.provider)
            ? this.renameCrossProjectSession(projectRef.provider, projectRef.projectKey, sessionId, title)
            : false;
        } else {
          renamed = this.canAccessSession(sessionId, accessIdentity, undefined, provider)
            ? this.sessionManager.rename(sessionId, title, provider)
            : false;
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
