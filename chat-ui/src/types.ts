export interface ChatOption {
  id?: string;
  label: string;
  description?: string;
  category?: string;
}

export interface ToolUse {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  result?: string;
  isError?: boolean;
  timestamp: number;
}

export type Provider = 'claude' | 'codex';

export interface ProcessPanelPreferences {
  showStatus: boolean;
  showLog: boolean;
  showTool: boolean;
}

export interface UiPreferences {
  processPanel: ProcessPanelPreferences;
  updatedAt: number;
}

export type MessageProcessState = 'running' | 'completed' | 'error';

export type MessageProcessEvent =
  | {
      type: 'status';
      label: string;
      timestamp: number;
    }
  | {
      type: 'log';
      level: 'info' | 'debug' | 'warn' | 'error';
      message: string;
      timestamp: number;
    }
  | {
      type: 'tool_use';
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolUseId?: string;
      timestamp: number;
    }
  | {
      type: 'tool_result';
      toolUseId?: string;
      result?: string;
      isError?: boolean;
      timestamp: number;
    };

export interface MessageProcess {
  provider: Provider;
  state: MessageProcessState;
  events: MessageProcessEvent[];
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
  tools?: ToolUse[];
  process?: MessageProcess;
  canRetry?: boolean;
}

export interface Attachment {
  id: string;
  url: string;
  type: string;
  name: string;
  data?: string;
}

export type DiscussionAvatar = string | {
  icon?: string;
  color?: string;
};

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  provider: Provider;
}

export type DiscussionMode = 'debate' | 'collaborate' | 'auto';

export type TerminationMode = 'consensus' | 'rounds' | 'both';

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
  avatar?: DiscussionAvatar;
}

export interface DiscussionMessage {
  id: string;
  sender: string;
  role: string;
  content: string;
  timestamp: number;
  type: 'user' | 'agent' | 'system' | 'summary';
  round?: number;
  avatar?: DiscussionAvatar;
}

export interface DiscussionSession {
  id: string;
  agents: DiscussionAgent[];
  messages: DiscussionMessage[];
  status: 'pending' | 'running' | 'completed' | 'error';
  currentRound: number;
  maxRounds: number;
  conclusion?: string;
  originalInput?: string;
  participants?: string[];
  config?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  mode?: DiscussionMode;
  modeReason?: string;
  consensusScore?: number;
  verifiedFacts?: string[];
  coreClashes?: string[];
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
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

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
