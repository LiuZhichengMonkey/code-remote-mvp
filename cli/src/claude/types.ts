import { v4 as uuidv4 } from 'uuid';

export interface ClaudeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: string[];
}

export interface ClaudeSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ClaudeMessage[];
  claudeSessionId?: string;
  cwd?: string;  // 工作目录
}

export interface ClaudeConfig {
  preferCLI: boolean;
  apiKey?: string;
  streamMode: 'realtime' | 'segmented';
  maxHistoryLength: number;
  sessionTimeout: number;
}

// 日志级别类型
export type LogLevel = 'info' | 'debug' | 'warn' | 'error';

// 日志消息接口
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
  timestamp: number;
}

// 工具使用事件
export interface ToolUseEvent {
  type: 'tool_use';
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
}

// 工具结果事件
export interface ToolResultEvent {
  type: 'tool_result';
  toolUseId: string;
  result?: string;
  isError?: boolean;
}

export interface ClaudeError {
  type: 'claude_error';
  error: string;
  code: 'CLI_NOT_FOUND' | 'API_KEY_MISSING' | 'RATE_LIMITED' | 'SESSION_NOT_FOUND' | 'STREAM_ERROR';
  timestamp: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
  lastActivity?: number;  // 最后活动时间，用于排序
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

export function createSession(title: string = 'New Chat'): ClaudeSession {
  return {
    id: uuidv4(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
}

export const DEFAULT_CONFIG: ClaudeConfig = {
  preferCLI: true,
  streamMode: 'realtime',
  maxHistoryLength: 100,
  sessionTimeout: 3600000
};
