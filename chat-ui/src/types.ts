export interface ChatOption {
  id?: string;
  label: string;
  description?: string;
  category?: string;
}

// 工具使用记录
export interface ToolUse {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  result?: string;
  isError?: boolean;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  attachments?: Attachment[];
  options?: ChatOption[];
  thinking?: string;
  tools?: ToolUse[];  // 工具使用记录
  canRetry?: boolean; // 是否可以重试（如429限流错误）
  retryContent?: string; // 重试时发送的内容
}

export interface Attachment {
  id: string;
  url: string;
  type: string;
  name: string;
  data?: string; // base64
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

// 讨论系统类型

/**
 * 讨论模式
 */
export type DiscussionMode = 'debate' | 'collaborate' | 'auto';

/**
 * 终止模式
 */
export type TerminationMode = 'consensus' | 'rounds' | 'both';

/**
 * 讨论配置
 */
export interface DiscussionConfig {
  maxRounds?: number;
  maxMessagesPerRound?: number;
  allowAgentInteraction?: boolean;
  autoSummary?: boolean;
  messageTimeout?: number;
  showThinking?: boolean;
  mode?: DiscussionMode;
  terminationMode?: TerminationMode;
  consensusThreshold?: number;
  enableFluffDetection?: boolean;
  maxContentLength?: number;
  compressionInterval?: number;
  enableEventBus?: boolean;
  enableFactChecker?: boolean;
}

export interface DiscussionAgent {
  id: string;
  name: string;
  role: string;
  avatar?: {
    icon?: string;
    color?: string;
  };
}

export interface DiscussionMessage {
  id: string;
  sender: string;
  role: string;
  content: string;
  timestamp: number;
  type: 'user' | 'agent' | 'system' | 'summary';
  round?: number;
  avatar?: {
    icon?: string;
    color?: string;
  };
}

export interface DiscussionSession {
  id: string;
  agents: DiscussionAgent[];
  messages: DiscussionMessage[];
  status: 'pending' | 'running' | 'completed' | 'error';
  currentRound: number;
  maxRounds: number;
  conclusion?: string;
  /** 讨论模式 */
  mode?: DiscussionMode;
  /** 模式判断理由 */
  modeReason?: string;
  /** 共识分数 (0-100) */
  consensusScore?: number;
  /** 已验证事实 */
  verifiedFacts?: string[];
  /** 核心争议点 */
  coreClashes?: string[];
  /** Agent 见解 */
  agentInsights?: Record<string, string>;
}

export interface DiscussionResult {
  sessionId: string;
  participantCount: number;
  totalRounds: number;
  totalMessages: number;
  perspectives: Array<{
    agentName: string;
    role: string;
    summary: string;
  }>;
  conclusion: string;
  agreements: string[];
  disagreements?: string[];
  recommendations: string[];
  messages: DiscussionMessage[];
  duration: number;
  /** Token 使用量统计 */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * 模式检测结果
 */
export interface ModeDetectionResult {
  mode: DiscussionMode;
  reason: string;
  analysis: {
    hasControversy: boolean;
    needsFactCheck: boolean;
    hasMultipleSolutions: boolean;
    topicType: 'decision' | 'analysis' | 'creative' | 'factual';
  };
  confidence: number;
}
