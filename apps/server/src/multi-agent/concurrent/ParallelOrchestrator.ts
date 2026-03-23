/**
 * 并行执行器 - 多Agent并发执行
 *
 * 核心特性:
 * - 并行执行多个Agent
 * - 使用Promise.allSettled确保一个Agent失败不影响其他
 * - 结果聚合与冲突仲裁
 */

import {
  DebateRole,
  GlobalBlackboard,
  AgentSpeech,
  DebateStep,
  DebateConfig
} from '../types';
import { BaseAgent, AgentFactory } from '../agents';
import { BlackboardManager } from '../blackboard';
import { EventBus, globalEventBus } from '../bus';
import { ConcurrentAgent, createConcurrentAgent } from './ConcurrentAgent';
import { AsyncLock } from '../bus/LockManager';

/**
 * 并行执行结果
 */
export interface ParallelResult {
  /** Agent角色 */
  role: DebateRole;
  /** 执行状态 */
  status: 'fulfilled' | 'rejected';
  /** 发言内容 */
  content?: string;
  /** 错误信息 */
  error?: string;
  /** 执行耗时 (ms) */
  duration: number;
  /** Token使用量 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * 轮次结果
 */
export interface RoundResult {
  /** 轮次号 */
  round: number;
  /** 各Agent执行结果 */
  results: ParallelResult[];
  /** 总耗时 */
  totalDuration: number;
  /** 成功数量 */
  successCount: number;
  /** 失败数量 */
  failureCount: number;
}

/**
 * 并行执行器配置
 */
export interface ParallelOrchestratorConfig extends DebateConfig {
  /** 并发执行的超时时间 (ms) */
  parallelTimeout: number;
  /** 最大并发数 */
  maxConcurrency: number;
  /** 失败重试次数 */
  maxRetries: number;
  /** 是否启用结果缓存 */
  enableCache: boolean;
}

const DEFAULT_PARALLEL_CONFIG: ParallelOrchestratorConfig = {
  maxRounds: 10,
  terminationScore: 85,
  compressHistory: true,
  compressionInterval: 2,
  enableFactChecker: true,
  enableExpert: true,
  parallelTimeout: 60000, // 60秒
  maxConcurrency: 5,
  maxRetries: 2,
  enableCache: false
};

/**
 * 并行执行器
 */
export class ParallelOrchestrator {
  private eventBus: EventBus;
  private blackboardManager: BlackboardManager;
  private config: ParallelOrchestratorConfig;
  private agents: Map<DebateRole, ConcurrentAgent> = new Map();
  private blackboardLock: AsyncLock;
  private eventHandlers: Set<(event: any) => void> = new Set();

  constructor(
    blackboardManager: BlackboardManager,
    config?: Partial<ParallelOrchestratorConfig>,
    eventBus?: EventBus
  ) {
    this.blackboardManager = blackboardManager;
    this.config = { ...DEFAULT_PARALLEL_CONFIG, ...config };
    this.eventBus = eventBus || globalEventBus;
    this.blackboardLock = new AsyncLock();
  }

  /**
   * 注册Agent
   */
  registerAgent(role: DebateRole, agent: BaseAgent): void {
    const concurrentAgent = createConcurrentAgent(agent);
    concurrentAgent.connect(this.eventBus);
    this.agents.set(role, concurrentAgent);
  }

  /**
   * 使用默认Agent
   */
  useDefaultAgents(): void {
    const defaultRoles: DebateRole[] = ['proposer', 'skeptic'];
    for (const role of defaultRoles) {
      const agent = AgentFactory.getAgent(role);
      this.registerAgent(role, agent);
    }
  }

  /**
   * 订阅事件
   */
  subscribe(handler: (event: any) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * 发送事件
   */
  private emit(event: any): void {
    Array.from(this.eventHandlers).forEach(handler => {
      handler(event);
    });
  }

  /**
   * 并行执行一轮
   * 核心：使用Promise.allSettled确保所有Agent都能执行
   */
  async runParallelRound(
    roles: DebateRole[],
    context: string
  ): Promise<RoundResult> {
    const startTime = Date.now();
    const round = this.blackboardManager.getState().round;

    // 准备执行任务
    const tasks: Promise<ParallelResult>[] = roles.map(role =>
      this.executeAgentWithTimeout(role, context)
    );

    // 并行执行，使用Promise.allSettled确保不因单个失败而中断
    const settledResults = await Promise.allSettled(tasks);

    // 处理结果
    const results: ParallelResult[] = settledResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          role: roles[index],
          status: 'rejected',
          error: result.reason?.message || 'Unknown error',
          duration: 0
        };
      }
    });

    // 获取黑板锁，安全地更新黑板
    await this.blackboardLock.acquire();
    try {
      // 记录成功的发言
      for (const r of results) {
        if (r.status === 'fulfilled' && r.content) {
          const speech: AgentSpeech = {
            agentName: r.role,
            role: r.role,
            content: r.content,
            timestamp: Date.now(),
            round,
            step: r.role as DebateStep
          };
          this.blackboardManager.recordSpeech(speech);
        }
      }
    } finally {
      this.blackboardLock.release();
    }

    const roundResult: RoundResult = {
      round,
      results,
      totalDuration: Date.now() - startTime,
      successCount: results.filter(r => r.status === 'fulfilled').length,
      failureCount: results.filter(r => r.status === 'rejected').length
    };

    // 发送事件
    this.emit({
      type: 'round_complete',
      data: roundResult,
      timestamp: Date.now()
    });

    return roundResult;
  }

  /**
   * 执行单个Agent (带超时)
   */
  private async executeAgentWithTimeout(
    role: DebateRole,
    context: string
  ): Promise<ParallelResult> {
    const agent = this.agents.get(role);
    if (!agent) {
      return {
        role,
        status: 'rejected',
        error: `Agent ${role} not registered`,
        duration: 0
      };
    }

    const startTime = Date.now();

    try {
      // 使用AbortController实现超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Agent ${role} timeout`));
        }, this.config.parallelTimeout);
      });

      const executePromise = agent.generateSpeech(
        this.blackboardManager.getState(),
        context
      );

      const content = await Promise.race([executePromise, timeoutPromise]);

      return {
        role,
        status: 'fulfilled',
        content,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        role,
        status: 'rejected',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 执行并行辩论轮次
   * proposer和skeptic同时执行，而不是串行
   */
  async runDebateRound(): Promise<RoundResult> {
    const blackboard = this.blackboardManager.getState();
    const round = blackboard.round + 1;

    // 构建上下文
    const context = this.buildContext(round);

    // 确定要并行执行的Agent
    const parallelRoles: DebateRole[] = ['proposer', 'skeptic'];

    // 如果有专家，也并行执行
    if (this.config.enableExpert && this.agents.has('expert')) {
      parallelRoles.push('expert');
    }

    // 并行执行
    const result = await this.runParallelRound(parallelRoles, context);

    // 更新黑板
    this.blackboardManager.nextRound();

    // 检查是否达到终止条件
    if (this.blackboardManager.shouldTerminate(this.config.terminationScore)) {
      this.emit({
        type: 'debate_complete',
        data: { reason: 'termination_score_reached' },
        timestamp: Date.now()
      });
    } else if (round >= this.config.maxRounds) {
      this.emit({
        type: 'debate_complete',
        data: { reason: 'max_rounds_reached' },
        timestamp: Date.now()
      });
    }

    return result;
  }

  /**
   * 构建上下文
   */
  private buildContext(round: number): string {
    const blackboard = this.blackboardManager.getState();

    return `## 并行讨论 (Round ${round})
- 核心议题: ${blackboard.currentTopic}

## 已验证事实
${blackboard.verifiedFacts.map(f => `- ${f}`).join('\n') || '无'}

## 待解决争议
${blackboard.coreClashes.map(c => `- ${c}`).join('\n') || '无'}

## 历史摘要
${blackboard.historySummary || '首轮讨论'}

---
请基于以上状态，从你的角色视角发表观点。注意：其他Agent正在同时思考，请聚焦你独特的分析角度。`;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    agents: DebateRole[];
    busStats: ReturnType<EventBus['getStats']>;
  } {
    return {
      agents: Array.from(this.agents.keys()),
      busStats: this.eventBus.getStats()
    };
  }

  /**
   * 获取黑板状态
   */
  getBlackboard(): GlobalBlackboard {
    return this.blackboardManager.getState();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    Array.from(this.agents.values()).forEach(agent => {
      agent.disconnect();
    });
    this.agents.clear();
    this.eventHandlers.clear();
  }
}

/**
 * 创建并行执行器
 */
export function createParallelOrchestrator(
  topic: string,
  config?: Partial<ParallelOrchestratorConfig>
): ParallelOrchestrator {
  const blackboardManager = BlackboardManager.create(topic);
  return new ParallelOrchestrator(blackboardManager, config);
}
