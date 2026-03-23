import { v4 as uuidv4 } from 'uuid';
import { Provider } from '../session/provider';

export interface ClaudeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: string[];
  process?: MessageProcess;
}

export type MessageProcessState = 'running' | 'completed' | 'error';

export interface ProcessStatusEvent {
  type: 'status';
  label: string;
  timestamp: number;
}

export interface ProcessLogEvent {
  type: 'log';
  level: LogLevel;
  message: string;
  timestamp: number;
}

export interface ProcessToolUseEvent {
  type: 'tool_use';
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  timestamp: number;
}

export interface ProcessToolResultEvent {
  type: 'tool_result';
  toolUseId?: string;
  result?: string;
  isError?: boolean;
  timestamp: number;
}

export type MessageProcessEvent =
  | ProcessStatusEvent
  | ProcessLogEvent
  | ProcessToolUseEvent
  | ProcessToolResultEvent;

export interface MessageProcess {
  provider: Provider;
  state: MessageProcessState;
  events: MessageProcessEvent[];
}

export interface ClaudeSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ClaudeMessage[];
  provider: Provider;
  providerSessionId?: string;
  claudeSessionId?: string;
  cwd?: string;
  projectId?: string;
}

export interface ClaudeConfig {
  preferCLI: boolean;
  apiKey?: string;
  streamMode: 'realtime' | 'segmented';
  maxHistoryLength: number;
  sessionTimeout: number;
}

export type LogLevel = 'info' | 'debug' | 'warn' | 'error';

export interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: number;
}

export interface ClaudeStreamChunk {
  type: 'claude_stream';
  content: string;
  done: boolean;
  messageId?: string;
  sessionId?: string;
  provider?: Provider;
  timestamp: number;
}

export interface ToolUseEvent {
  type: 'tool_use';
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolUseId: string;
  result?: string;
  isError?: boolean;
}

export interface ClaudeError {
  type: 'claude_error';
  error: string;
  code: 'CLI_NOT_FOUND' | 'API_KEY_MISSING' | 'RATE_LIMITED' | 'SESSION_NOT_FOUND' | 'STREAM_ERROR' | 'SESSION_BUSY';
  sessionId?: string;
  provider?: Provider;
  timestamp: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
  provider: Provider;
  projectId?: string;
  lastActivity?: number;
}

export function createMessage(role: 'user' | 'assistant', content: string, images?: string[]): ClaudeMessage {
  return {
    id: uuidv4(),
    role,
    content,
    timestamp: Date.now(),
    images
  };
}

export function createSession(title: string = 'New Chat', provider: Provider = 'claude'): ClaudeSession {
  return {
    id: uuidv4(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    provider
  };
}

export function getProviderSessionId(session: Pick<ClaudeSession, 'provider' | 'providerSessionId' | 'claudeSessionId'>): string | undefined {
  return session.providerSessionId || (session.provider === 'claude' ? session.claudeSessionId : undefined);
}

export const DEFAULT_CONFIG: ClaudeConfig = {
  preferCLI: true,
  streamMode: 'realtime',
  maxHistoryLength: 100,
  sessionTimeout: 3600000
};
