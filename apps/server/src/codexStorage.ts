import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ClaudeMessage,
  ClaudeSession,
  MessageProcess,
  MessageProcessEvent,
  SessionInfo
} from './claude/types';
import { pathToProjectKey, projectKeyToPath } from './session/provider';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');

interface CodexMetadataEntry {
  title?: string;
  updatedAt?: number;
}

type CodexMetadataStore = Record<string, CodexMetadataEntry>;

interface ParsedSessionRecord {
  session: ClaudeSession;
  filePath: string;
}

export interface CodexProjectInfo {
  id: string;
  displayName: string;
  sessionCount: number;
  lastActivity: number;
  provider: 'codex';
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string' || !value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function cloneProcess(process: MessageProcess | null): MessageProcess | undefined {
  if (!process || process.events.length === 0) {
    return undefined;
  }

  return {
    provider: process.provider,
    state: process.state,
    events: [...process.events]
  };
}

function isSameProcessEvent(a: MessageProcessEvent, b: MessageProcessEvent): boolean {
  if (a.type !== b.type || a.timestamp !== b.timestamp) {
    return false;
  }

  switch (a.type) {
    case 'status':
      return b.type === 'status' && a.label === b.label;
    case 'log':
      return b.type === 'log' && a.level === b.level && a.message === b.message;
    case 'tool_use':
      return b.type === 'tool_use'
        && a.toolName === b.toolName
        && a.toolUseId === b.toolUseId
        && JSON.stringify(a.toolInput || {}) === JSON.stringify(b.toolInput || {});
    case 'tool_result':
      return b.type === 'tool_result'
        && a.toolUseId === b.toolUseId
        && a.result === b.result
        && a.isError === b.isError;
    default:
      return false;
  }
}

function walkJsonlFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export class CodexSessionStorage {
  private workspaceRoot: string;
  private projectPath: string;
  private metadataFile: string;
  private metadataCache: CodexMetadataStore | null = null;

  constructor(workspaceRoot?: string, projectPath?: string) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.projectPath = projectPath || this.workspaceRoot;
    this.metadataFile = path.join(this.workspaceRoot, '.coderemote', 'codex-session-metadata.json');
  }

  getProjectId(): string {
    return pathToProjectKey(this.projectPath);
  }

  private ensureMetadataDirectory(): void {
    const metadataDir = path.dirname(this.metadataFile);
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }
  }

  private getMetadataStore(): CodexMetadataStore {
    if (this.metadataCache) {
      return this.metadataCache;
    }

    try {
      if (!fs.existsSync(this.metadataFile)) {
        const emptyStore: CodexMetadataStore = {};
        this.metadataCache = emptyStore;
        return emptyStore;
      }

      const content = fs.readFileSync(this.metadataFile, 'utf-8');
      const store: CodexMetadataStore = content ? JSON.parse(content) : {};
      this.metadataCache = store;
      return store;
    } catch (error) {
      console.error('[CodexSessionStorage] Failed to load metadata store:', error);
      const emptyStore: CodexMetadataStore = {};
      this.metadataCache = emptyStore;
      return emptyStore;
    }
  }

  private saveMetadataStore(store: CodexMetadataStore): void {
    this.ensureMetadataDirectory();
    fs.writeFileSync(this.metadataFile, JSON.stringify(store, null, 2), 'utf-8');
    this.metadataCache = store;
  }

  private appendUserMessage(messages: ClaudeMessage[], content: string, timestamp: number, id: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    messages.push({
      id,
      role: 'user',
      content: trimmed,
      timestamp
    });
  }

  private appendAssistantMessage(
    messages: ClaudeMessage[],
    content: string,
    timestamp: number,
    id: string,
    process?: MessageProcess
  ): number | null {
    const trimmed = content.trim();
    if (!trimmed && (!process || process.events.length === 0)) {
      return null;
    }

    messages.push({
      id,
      role: 'assistant',
      content: trimmed,
      timestamp,
      process
    });

    return messages.length - 1;
  }

  private createPendingProcess(): MessageProcess {
    return {
      provider: 'codex',
      state: 'running',
      events: []
    };
  }

  private ensurePendingProcess(process: MessageProcess | null): MessageProcess {
    return process || this.createPendingProcess();
  }

  private appendProcessEvent(process: MessageProcess | null, event: MessageProcessEvent): MessageProcess {
    const next = this.ensurePendingProcess(process);
    const lastEvent = next.events[next.events.length - 1];
    if (!lastEvent || !isSameProcessEvent(lastEvent, event)) {
      next.events.push(event);
    }
    return next;
  }

  private appendEventToAssistant(
    messages: ClaudeMessage[],
    index: number | null,
    event: MessageProcessEvent,
    state?: MessageProcess['state']
  ): void {
    if (index === null || index < 0 || index >= messages.length) {
      return;
    }

    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      return;
    }

    const currentProcess = message.process || this.createPendingProcess();
    const lastEvent = currentProcess.events[currentProcess.events.length - 1];
    if (!lastEvent || !isSameProcessEvent(lastEvent, event)) {
      currentProcess.events.push(event);
    }
    if (state) {
      currentProcess.state = state;
    }
    message.process = currentProcess;
  }

  private parseFunctionArguments(rawArguments: unknown): Record<string, unknown> | undefined {
    if (typeof rawArguments !== 'string' || !rawArguments.trim()) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(rawArguments);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { value: parsed };
    } catch {
      return { raw: rawArguments };
    }
  }

  private parseSessionFile(filePath: string): ParsedSessionRecord | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/).filter(line => line.trim());
      const messages: ClaudeMessage[] = [];

      let sessionId = '';
      let title = 'New Chat';
      let cwd = '';
      let createdAt = 0;
      let updatedAt = 0;
      let pendingProcess: MessageProcess | null = null;
      let currentAssistantIndex: number | null = null;

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        try {
          const entry: any = JSON.parse(line);
          const entryTimestamp = parseTimestamp(entry.timestamp);

          if (entryTimestamp > 0) {
            createdAt = createdAt === 0 ? entryTimestamp : Math.min(createdAt, entryTimestamp);
            updatedAt = Math.max(updatedAt, entryTimestamp);
          }

          if (entry.type === 'session_meta') {
            sessionId = entry.payload?.id || sessionId;
            cwd = entry.payload?.cwd || cwd;

            const payloadTimestamp = parseTimestamp(entry.payload?.timestamp);
            if (payloadTimestamp > 0) {
              createdAt = createdAt === 0 ? payloadTimestamp : Math.min(createdAt, payloadTimestamp);
              updatedAt = Math.max(updatedAt, payloadTimestamp);
            }
            continue;
          }

          if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
            const messageText = typeof entry.payload.message === 'string' ? entry.payload.message : '';
            this.appendUserMessage(messages, messageText, entryTimestamp || Date.now(), `codex-user-${index}`);
            pendingProcess = null;
            currentAssistantIndex = null;
            if (title === 'New Chat' && messageText.trim()) {
              title = messageText.trim().substring(0, 50);
            }
            continue;
          }

          if (entry.type === 'event_msg' && entry.payload?.type === 'task_started') {
            currentAssistantIndex = null;
            pendingProcess = this.appendProcessEvent(pendingProcess, {
              type: 'status',
              label: 'Codex started working',
              timestamp: entryTimestamp || Date.now()
            });
            continue;
          }

          if (entry.type === 'event_msg' && entry.payload?.type === 'agent_message') {
            const phase = typeof entry.payload.phase === 'string' ? entry.payload.phase : '';
            const text = typeof entry.payload.message === 'string' ? entry.payload.message.trim() : '';
            if (text && phase && phase !== 'final_answer') {
              pendingProcess = this.appendProcessEvent(pendingProcess, {
                type: 'log',
                level: 'info',
                message: text,
                timestamp: entryTimestamp || Date.now()
              });
            }
            continue;
          }

          if (entry.type === 'event_msg' && entry.payload?.type === 'task_complete') {
            const completionEvent: MessageProcessEvent = {
              type: 'status',
              label: 'Codex completed the response',
              timestamp: entryTimestamp || Date.now()
            };

            if (currentAssistantIndex !== null) {
              this.appendEventToAssistant(messages, currentAssistantIndex, completionEvent, 'completed');
            } else if (pendingProcess?.events.length) {
              pendingProcess = this.appendProcessEvent(pendingProcess, completionEvent);
              pendingProcess.state = 'completed';
              currentAssistantIndex = this.appendAssistantMessage(
                messages,
                '',
                entryTimestamp || Date.now(),
                `codex-assistant-${index}`,
                cloneProcess(pendingProcess)
              );
              pendingProcess = null;
            }
            continue;
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
            pendingProcess = this.appendProcessEvent(pendingProcess, {
              type: 'status',
              label: 'Codex generated internal reasoning',
              timestamp: entryTimestamp || Date.now()
            });
            continue;
          }

          if (
            entry.type === 'response_item'
            && (entry.payload?.type === 'function_call' || entry.payload?.type === 'custom_tool_call')
          ) {
            pendingProcess = this.appendProcessEvent(pendingProcess, {
              type: 'tool_use',
              toolName: entry.payload.name || 'tool',
              toolInput: this.parseFunctionArguments(entry.payload.arguments),
              toolUseId: entry.payload.call_id || entry.payload.id,
              timestamp: entryTimestamp || Date.now()
            });
            continue;
          }

          if (
            entry.type === 'response_item'
            && (entry.payload?.type === 'function_call_output' || entry.payload?.type === 'custom_tool_call_output')
          ) {
            pendingProcess = this.appendProcessEvent(pendingProcess, {
              type: 'tool_result',
              toolUseId: entry.payload.call_id || entry.payload.id,
              result: typeof entry.payload.output === 'string' ? entry.payload.output : undefined,
              isError: false,
              timestamp: entryTimestamp || Date.now()
            });
            continue;
          }

          if (entry.type !== 'response_item' || entry.payload?.type !== 'message' || entry.payload?.role !== 'assistant') {
            continue;
          }

          const phase = typeof entry.payload.phase === 'string' ? entry.payload.phase : '';
          const text = Array.isArray(entry.payload.content)
            ? entry.payload.content
              .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
              .map((item: any) => item.text)
              .join('')
            : '';

          if (!text.trim()) {
            continue;
          }

          if (phase && phase !== 'final_answer') {
            continue;
          }

          currentAssistantIndex = this.appendAssistantMessage(
            messages,
            text,
            entryTimestamp || Date.now(),
            `codex-assistant-${index}`,
            cloneProcess(pendingProcess)
          );
          pendingProcess = null;
        } catch {
          // Ignore malformed lines.
        }
      }

      if (!sessionId || messages.length === 0) {
        return null;
      }

      const metadataStore = this.getMetadataStore();
      const metadata = metadataStore[sessionId];
      if (metadata?.title) {
        title = metadata.title;
      }

      const projectId = cwd ? pathToProjectKey(cwd) : undefined;
      const effectiveCreatedAt = createdAt || Date.now();
      const effectiveUpdatedAt = Math.max(updatedAt, metadata?.updatedAt || 0, effectiveCreatedAt);

      return {
        filePath,
        session: {
          id: sessionId,
          title,
          createdAt: effectiveCreatedAt,
          updatedAt: effectiveUpdatedAt,
          messages,
          provider: 'codex',
          providerSessionId: sessionId,
          cwd: cwd || undefined,
          projectId
        }
      };
    } catch (error) {
      console.error(`[CodexSessionStorage] Failed to parse session ${filePath}:`, error);
      return null;
    }
  }

  private scanSessions(projectId?: string): ParsedSessionRecord[] {
    const records = walkJsonlFiles(CODEX_SESSIONS_DIR)
      .map(filePath => this.parseSessionFile(filePath))
      .filter((record): record is ParsedSessionRecord => record !== null);

    const filtered = projectId
      ? records.filter(record => record.session.projectId === projectId)
      : records;

    return filtered.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
  }

  list(): ClaudeSession[] {
    return this.scanSessions(this.getProjectId()).map(record => record.session);
  }

  listInfo(): SessionInfo[] {
    return this.list().map(session => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      messageCount: session.messages.length,
      provider: 'codex',
      projectId: session.projectId,
      lastActivity: session.updatedAt
    }));
  }

  load(sessionId: string): ClaudeSession | null {
    const record = this.scanSessions(this.getProjectId()).find(item => item.session.id === sessionId);
    return record?.session || null;
  }

  loadPaginated(sessionId: string, limit: number = 20, beforeIndex?: number): {
    session: ClaudeSession | null;
    hasMore: boolean;
    totalMessages: number;
  } {
    const session = this.load(sessionId);
    if (!session) {
      return { session: null, hasMore: false, totalMessages: 0 };
    }

    const totalMessages = session.messages.length;
    const endIndex = beforeIndex !== undefined ? Math.max(0, totalMessages - beforeIndex) : totalMessages;
    const startIndex = Math.max(0, endIndex - limit);
    const messages = session.messages.slice(startIndex, endIndex);

    return {
      session: {
        ...session,
        messages
      },
      hasMore: startIndex > 0,
      totalMessages
    };
  }

  delete(sessionId: string): boolean {
    const record = this.scanSessions(this.getProjectId()).find(item => item.session.id === sessionId);
    if (!record || !fs.existsSync(record.filePath)) {
      return false;
    }

    fs.unlinkSync(record.filePath);

    const metadataStore = this.getMetadataStore();
    if (metadataStore[sessionId]) {
      delete metadataStore[sessionId];
      this.saveMetadataStore(metadataStore);
    }

    return true;
  }

  rename(sessionId: string, newTitle: string): boolean {
    const exists = this.scanSessions(this.getProjectId()).some(item => item.session.id === sessionId);
    if (!exists) {
      return false;
    }

    const metadataStore = this.getMetadataStore();
    metadataStore[sessionId] = {
      ...metadataStore[sessionId],
      title: newTitle,
      updatedAt: Date.now()
    };
    this.saveMetadataStore(metadataStore);
    return true;
  }

  getLatest(): ClaudeSession | null {
    const sessions = this.list();
    return sessions.length > 0 ? sessions[0] : null;
  }

  static listAllProjects(): CodexProjectInfo[] {
    const storage = new CodexSessionStorage(process.cwd());
    const grouped = new Map<string, CodexProjectInfo>();

    for (const record of storage.scanSessions()) {
      const projectId = record.session.projectId;
      if (!projectId) {
        continue;
      }

      const existing = grouped.get(projectId);
      if (existing) {
        existing.sessionCount += 1;
        existing.lastActivity = Math.max(existing.lastActivity, record.session.updatedAt);
        continue;
      }

      grouped.set(projectId, {
        id: projectId,
        displayName: record.session.cwd || projectKeyToPath(projectId),
        sessionCount: 1,
        lastActivity: record.session.updatedAt,
        provider: 'codex'
      });
    }

    return Array.from(grouped.values()).sort((a, b) => b.lastActivity - a.lastActivity);
  }

  static listSessionsByProject(projectId: string, limit: number = 1000): SessionInfo[] {
    const storage = new CodexSessionStorage(process.cwd(), projectId);
    return storage.listInfo().slice(0, limit);
  }

  static loadSessionFromProject(projectId: string, sessionId: string): ClaudeSession | null {
    const storage = new CodexSessionStorage(process.cwd(), projectId);
    return storage.load(sessionId);
  }

  static loadSessionFromProjectPaginated(
    projectId: string,
    sessionId: string,
    limit: number = 20,
    beforeIndex?: number
  ): { session: ClaudeSession | null; hasMore: boolean; totalMessages: number } {
    const storage = new CodexSessionStorage(process.cwd(), projectId);
    return storage.loadPaginated(sessionId, limit, beforeIndex);
  }

  static deleteSessionFromProject(projectId: string, sessionId: string): boolean {
    const storage = new CodexSessionStorage(process.cwd(), projectId);
    return storage.delete(sessionId);
  }

  static renameSessionFromProject(projectId: string, sessionId: string, newTitle: string): boolean {
    const storage = new CodexSessionStorage(process.cwd(), projectId);
    return storage.rename(sessionId, newTitle);
  }
}
