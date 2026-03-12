/**
 * 多智能体系统类型定义
 */

/**
 * Agent 角色
 */
export type AgentRole = 'moderator' | 'proposer' | 'skeptic' | 'fact-checker' | 'expert';

/**
 * Agent 配置
 */
export interface AgentConfig {
  name: string;
  role: AgentRole;
  description: string;
  systemPrompt: string;
  tools?: string[];
}

/**
 * Agent 发言记录
 */
export interface AgentSpeech {
  agentName: string;
  role: AgentRole;
  content: string;
  timestamp: number;
  round: number;
  step: DebateStep;
}

/**
 * 辩论步骤
 */
export type DebateStep =
  | 'proposer'      // Step 1: 立论
  | 'expert'        // Step 2: 补充
  | 'skeptic'       // Step 3: 质询
  | 'fact-check'    // Step 4: 查证
  | 'settlement';   // Step 5: 结算

/**
 * 全局黑板状态
 */
export interface GlobalBlackboard {
  /** 当前轮次 */
  round: number;
  /** 当前核心议题 */
  currentTopic: string;
  /** 已验证的事实 */
  verifiedFacts: string[];
  /** 核心争议点（未解决的分歧） */
  coreClashes: string[];
  /** 共识与完善度得分 (0-100) */
  consensusScore: number;
  /** 各 Agent 的见解摘要 */
  agentInsights: Record<string, string>;
  /** 当前步骤 */
  currentStep: DebateStep;
  /** 历史摘要（压缩后的关键信息） */
  historySummary?: string;
}

/**
 * 辩论会话
 */
export interface DebateSession {
  /** 会话 ID */
  id: string;
  /** 原始问题 */
  originalQuestion: string;
  /** 自定义专家配置 */
  customExpert?: {
    name: string;
    background: string;
  };
  /** 全局黑板 */
  blackboard: GlobalBlackboard;
  /** 发言记录 */
  speeches: AgentSpeech[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 状态 */
  status: 'running' | 'completed' | 'paused';
}

/**
 * 最终分析报告
 */
export interface FinalReport {
  /** 核心结论 */
  coreConclusion: string;
  /** 多维分析视角 */
  perspectives: string[];
  /** 潜在风险提示 */
  risks: string[];
  /** 事实依据 */
  facts: string[];
  /** 总轮次 */
  totalRounds: number;
  /** 最终得分 */
  finalScore: number;
}

/**
 * 工具调用结果
 */
export interface ToolResult {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  timestamp: number;
}

/**
 * 辩论事件（用于前端通知）
 */
export interface DebateEvent {
  type: 'speech' | 'blackboard_update' | 'tool_call' | 'round_complete' | 'debate_complete';
  data: AgentSpeech | GlobalBlackboard | ToolResult | FinalReport;
  timestamp: number;
}

/**
 * 辩论配置
 */
export interface DebateConfig {
  /** 最大轮次 */
  maxRounds: number;
  /** 终止分数阈值 */
  terminationScore: number;
  /** 每轮压缩历史 */
  compressHistory: boolean;
  /** 压缩间隔（轮次） */
  compressionInterval: number;
  /** 是否启用查证员 */
  enableFactChecker: boolean;
  /** 是否启用动态专家 */
  enableExpert: boolean;
}
