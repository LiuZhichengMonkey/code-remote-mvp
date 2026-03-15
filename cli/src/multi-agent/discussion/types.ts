/**
 * 讨论系统类型定义
 *
 * 支持 @语法 触发多智能体讨论
 */

import { UnifiedAgent, AgentCapability } from '../types';

/**
 * Agent 模板 - 预定义的 Agent 配置
 */
export interface AgentTemplate {
  /** 模板 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 角色描述 */
  role: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 可用工具 */
  tools?: string[];
  /** 能力标签 */
  capabilities?: AgentCapability[];
  /** 图标/颜色（用于 UI） */
  avatar?: {
    icon?: string;
    color?: string;
  };
}

/**
 * 解析后的 @ 提及
 */
export interface AgentMention {
  /** 提及的 Agent 名称 */
  name: string;
  /** 在原文中的起始位置 */
  startIndex: number;
  /** 在原文中的结束位置 */
  endIndex: number;
  /** 是否有效（模板存在） */
  valid: boolean;
}

/**
 * 讨论参与者
 */
export interface DiscussionParticipant {
  /** Agent 实例 */
  agent: UnifiedAgent;
  /** 来源模板 */
  template: AgentTemplate;
  /** 是否已激活 */
  activated: boolean;
  /** 发言顺序 */
  order: number;
}

/**
 * 讨论消息
 */
export interface DiscussionMessage {
  /** 消息 ID */
  id: string;
  /** 发送者名称 */
  sender: string;
  /** 发送者角色 */
  role: string;
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
  /** 消息类型 */
  type: 'user' | 'agent' | 'system' | 'summary';
  /** 轮次 */
  round?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

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
  /** 最大轮次 */
  maxRounds: number;
  /** 每轮最大发言数 */
  maxMessagesPerRound: number;
  /** 是否允许 Agent 间交互 */
  allowAgentInteraction: boolean;
  /** 是否自动生成总结 */
  autoSummary: boolean;
  /** 发言超时时间 (ms) */
  messageTimeout: number;
  /** 是否显示思考过程 */
  showThinking: boolean;
  /** 讨论模式: 对抗/协作/自动判断 */
  mode: DiscussionMode;
  /** 终止模式: 共识评分/固定轮次/两者 */
  terminationMode: TerminationMode;
  /** 共识阈值 (0-100) */
  consensusThreshold: number;
  /** 是否启用废话检测 */
  enableFluffDetection: boolean;
  /** 最大内容长度 */
  maxContentLength: number;
  /** 历史压缩间隔 (轮次) */
  compressionInterval: number;
  /** 是否启用 EventBus */
  enableEventBus: boolean;
  /** 是否启用事实查证 */
  enableFactChecker: boolean;
}

/**
 * 讨论会话
 */
export interface DiscussionSession {
  /** 会话 ID */
  id: string;
  /** 原始用户输入 */
  originalInput: string;
  /** 解析出的提及列表 */
  mentions: AgentMention[];
  /** 参与者列表 */
  participants: DiscussionParticipant[];
  /** 消息历史 */
  messages: DiscussionMessage[];
  /** 当前轮次 */
  currentRound: number;
  /** 会话状态 */
  status: 'pending' | 'running' | 'completed' | 'error';
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 最终结论 */
  conclusion?: string;
  /** 配置 */
  config: DiscussionConfig;
  /** 每轮总结（用于上下文压缩） */
  roundSummaries?: Record<number, string>;
  /** 讨论模式 */
  mode: DiscussionMode;
  /** 模式判断理由 */
  modeReason?: string;
  /** 共识分数 (0-100) */
  consensusScore: number;
  /** 已验证事实 */
  verifiedFacts: string[];
  /** 核心争议点 */
  coreClashes: string[];
  /** Agent 见解 */
  agentInsights: Record<string, string>;
  /** 检测到的话题类型 */
  topicType?: 'decision' | 'analysis' | 'creative' | 'factual';
}

/**
 * 讨论事件
 */
export interface DiscussionEvent {
  /** 事件类型 */
  type: 'session_start' | 'agent_activated' | 'message' | 'round_complete' | 'session_end' | 'error' |
        'mode_detected' | 'consensus_update' | 'blackboard_update' | 'fluff_detected';
  /** 会话 ID */
  sessionId: string;
  /** 事件数据 */
  data: DiscussionMessage | DiscussionParticipant | string | Error | {
    round: number;
    summary: string;
  } | {
    mode: DiscussionMode;
    reason: string;
  } | {
    score: number;
    previousScore: number;
  } | {
    facts: string[];
    clashes: string[];
    insights: Record<string, string>;
  } | {
    agentName: string;
    originalContent: string;
    cleanContent: string;
    fluffCount: number;
  };
  /** 时间戳 */
  timestamp: number;
}

/**
 * 讨论结果
 */
export interface DiscussionResult {
  /** 会话 ID */
  sessionId: string;
  /** 参与者数量 */
  participantCount: number;
  /** 总轮次 */
  totalRounds: number;
  /** 总消息数 */
  totalMessages: number;
  /** 各 Agent 观点摘要 */
  perspectives: Array<{
    agentName: string;
    role: string;
    summary: string;
  }>;
  /** 综合结论 */
  conclusion: string;
  /** 共识点 */
  agreements: string[];
  /** 分歧点 */
  disagreements: string[];
  /** 建议 */
  recommendations: string[];
  /** 完整消息历史 */
  messages: DiscussionMessage[];
  /** 执行时间 (ms) */
  duration: number;
  /** Token 使用量统计 */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * 讨论订阅者
 */
export type DiscussionSubscriber = (event: DiscussionEvent) => void;

/**
 * 默认讨论配置
 */
export const DEFAULT_DISCUSSION_CONFIG: DiscussionConfig = {
  maxRounds: 3,
  maxMessagesPerRound: 10,
  allowAgentInteraction: true,
  autoSummary: true,
  messageTimeout: 60000,
  showThinking: false,
  // 新增配置
  mode: 'auto',
  terminationMode: 'both',
  consensusThreshold: 85,
  enableFluffDetection: true,
  maxContentLength: 500,
  compressionInterval: 2,
  enableEventBus: true,
  enableFactChecker: true
};
