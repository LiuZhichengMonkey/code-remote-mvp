/**
 * 状态管理器 - 统一状态管理
 *
 * 整合黑板、会话、锁等功能，提供：
 * - 统一的状态存储和访问
 * - 事件驱动的状态变更通知
 * - 状态持久化和恢复
 * - 状态快照功能
 */

import {
  GlobalBlackboard,
  DebateSession,
  AgentSpeech,
  DebateStep,
  DebateConfig,
  FinalReport
} from '../types';
import { BlackboardManager } from '../blackboard';
import { AsyncLock, LockManager } from '../bus/LockManager';

/**
 * 状态变更事件
 */
export interface StateChangeEvent {
  type: 'blackboard_update' | 'speech_added' | 'round_complete' | 'session_update';
  path: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

/**
 * 状态快照
 */
export interface StateSnapshot {
  id: string;
  sessionId: string;
  blackboard: GlobalBlackboard;
  speeches: AgentSpeech[];
  createdAt: number;
  label?: string;
}

/**
 * 状态订阅者
 */
type StateSubscriber = (event: StateChangeEvent) => void;

/**
 * 状态管理器配置
 */
export interface StateManagerConfig {
  /** 最大快照数量 */
  maxSnapshots: number;
  /** 是否自动保存快照 */
  autoSnapshot: boolean;
  /** 自动快照间隔（轮次） */
  snapshotInterval: number;
  /** 锁超时时间 (ms) */
  lockTimeout: number;
}

const DEFAULT_CONFIG: StateManagerConfig = {
  maxSnapshots: 10,
  autoSnapshot: true,
  snapshotInterval: 2,
  lockTimeout: 30000
};

/**
 * 统一状态管理器
 */
export class StateManager {
  private session: DebateSession;
  private blackboardManager: BlackboardManager;
  private config: StateManagerConfig;
  private lockManager: LockManager;
  private stateLock: AsyncLock;

  private subscribers: Set<StateSubscriber> = new Set();
  private snapshots: StateSnapshot[] = [];
  private snapshotCounter = 0;

  constructor(
    session: DebateSession,
    blackboardManager: BlackboardManager,
    config?: Partial<StateManagerConfig>
  ) {
    this.session = session;
    this.blackboardManager = blackboardManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lockManager = new LockManager({
      writeLockTimeout: this.config.lockTimeout
    });
    this.stateLock = new AsyncLock();
  }

  /**
   * 创建新的状态管理器
   */
  static create(
    topic: string,
    debateConfig?: Partial<DebateConfig>,
    stateConfig?: Partial<StateManagerConfig>
  ): StateManager {
    const blackboardManager = BlackboardManager.create(topic);
    const session: DebateSession = {
      id: generateSessionId(),
      originalQuestion: topic,
      blackboard: blackboardManager.getState(),
      speeches: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'running'
    };

    return new StateManager(session, blackboardManager, stateConfig);
  }

  /**
   * 从 JSON 恢复状态管理器
   */
  static fromJSON(json: string, config?: Partial<StateManagerConfig>): StateManager {
    const data = JSON.parse(json);
    const blackboardManager = BlackboardManager.restore(data.blackboard);

    const session: DebateSession = {
      id: data.id,
      originalQuestion: data.originalQuestion,
      customExpert: data.customExpert,
      blackboard: blackboardManager.getState(),
      speeches: data.speeches || [],
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      status: data.status
    };

    const manager = new StateManager(session, blackboardManager, config);
    manager.snapshots = data.snapshots || [];

    return manager;
  }

  // ========== 状态访问 ==========

  /**
   * 获取黑板状态
   */
  getBlackboard(): GlobalBlackboard {
    return this.blackboardManager.getState();
  }

  /**
   * 获取会话
   */
  getSession(): DebateSession {
    return { ...this.session };
  }

  /**
   * 获取发言历史
   */
  getSpeeches(round?: number): AgentSpeech[] {
    return this.blackboardManager.getSpeechHistory(round);
  }

  /**
   * 获取当前轮次
   */
  getCurrentRound(): number {
    return this.session.blackboard.round;
  }

  /**
   * 获取当前状态
   */
  getStatus(): 'running' | 'completed' | 'paused' {
    return this.session.status;
  }

  // ========== 状态更新 ==========

  /**
   * 记录发言
   */
  async recordSpeech(speech: AgentSpeech): Promise<void> {
    await this.stateLock.acquire();
    try {
      // 更新黑板
      this.blackboardManager.recordSpeech(speech);

      // 更新会话
      this.session.speeches.push(speech);
      this.session.updatedAt = Date.now();

      // 发送事件
      this.emit({
        type: 'speech_added',
        path: 'speeches',
        oldValue: null,
        newValue: speech,
        timestamp: Date.now()
      });
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 更新黑板
   */
  async updateBlackboard(
    updates: Partial<GlobalBlackboard>
  ): Promise<void> {
    await this.stateLock.acquire();
    try {
      const oldState = this.blackboardManager.getState();

      // 应用更新
      if (updates.currentTopic !== undefined) {
        this.blackboardManager.updateTopic(updates.currentTopic);
      }
      if (updates.consensusScore !== undefined) {
        this.blackboardManager.updateScore(updates.consensusScore);
      }

      // 同步到会话
      this.session.blackboard = this.blackboardManager.getState();
      this.session.updatedAt = Date.now();

      // 发送事件
      this.emit({
        type: 'blackboard_update',
        path: 'blackboard',
        oldValue: oldState,
        newValue: this.session.blackboard,
        timestamp: Date.now()
      });
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 添加已验证事实
   */
  async addVerifiedFact(fact: string): Promise<void> {
    await this.stateLock.acquire();
    try {
      this.blackboardManager.addVerifiedFact(fact);
      this.session.blackboard = this.blackboardManager.getState();
      this.session.updatedAt = Date.now();

      this.emit({
        type: 'blackboard_update',
        path: 'blackboard.verifiedFacts',
        oldValue: null,
        newValue: fact,
        timestamp: Date.now()
      });
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 添加核心争议点
   */
  async addClash(clash: string): Promise<void> {
    await this.stateLock.acquire();
    try {
      this.blackboardManager.addClash(clash);
      this.session.blackboard = this.blackboardManager.getState();
      this.session.updatedAt = Date.now();

      this.emit({
        type: 'blackboard_update',
        path: 'blackboard.coreClashes',
        oldValue: null,
        newValue: clash,
        timestamp: Date.now()
      });
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 解决争议点
   */
  async resolveClash(clash: string): Promise<void> {
    await this.stateLock.acquire();
    try {
      this.blackboardManager.resolveClash(clash);
      this.session.blackboard = this.blackboardManager.getState();
      this.session.updatedAt = Date.now();

      this.emit({
        type: 'blackboard_update',
        path: 'blackboard.coreClashes',
        oldValue: clash,
        newValue: null,
        timestamp: Date.now()
      });
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 更新 Agent 见解
   */
  async updateAgentInsight(agentName: string, insight: string): Promise<void> {
    await this.stateLock.acquire();
    try {
      this.blackboardManager.updateAgentInsight(agentName, insight);
      this.session.blackboard = this.blackboardManager.getState();
      this.session.updatedAt = Date.now();
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 进入下一轮
   */
  async nextRound(): Promise<void> {
    await this.stateLock.acquire();
    try {
      const oldRound = this.session.blackboard.round;
      this.blackboardManager.nextRound();
      this.session.blackboard = this.blackboardManager.getState();
      this.session.updatedAt = Date.now();

      // 自动快照
      if (this.config.autoSnapshot && oldRound % this.config.snapshotInterval === 0) {
        this.createSnapshot(`Round ${oldRound}`);
      }

      this.emit({
        type: 'round_complete',
        path: 'blackboard.round',
        oldValue: oldRound,
        newValue: this.session.blackboard.round,
        timestamp: Date.now()
      });
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 设置当前步骤
   */
  async setStep(step: DebateStep): Promise<void> {
    await this.stateLock.acquire();
    try {
      this.blackboardManager.setStep(step);
      this.session.blackboard = this.blackboardManager.getState();
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 设置会话状态
   */
  async setStatus(status: 'running' | 'completed' | 'paused'): Promise<void> {
    await this.stateLock.acquire();
    try {
      const oldStatus = this.session.status;
      this.session.status = status;
      this.session.updatedAt = Date.now();

      this.emit({
        type: 'session_update',
        path: 'session.status',
        oldValue: oldStatus,
        newValue: status,
        timestamp: Date.now()
      });
    } finally {
      this.stateLock.release();
    }
  }

  // ========== 快照功能 ==========

  /**
   * 创建快照
   */
  createSnapshot(label?: string): StateSnapshot {
    const snapshot: StateSnapshot = {
      id: `snapshot_${++this.snapshotCounter}_${Date.now()}`,
      sessionId: this.session.id,
      blackboard: this.blackboardManager.getState(),
      speeches: [...this.session.speeches],
      createdAt: Date.now(),
      label
    };

    this.snapshots.push(snapshot);

    // 限制快照数量
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * 获取快照
   */
  getSnapshot(id: string): StateSnapshot | undefined {
    return this.snapshots.find(s => s.id === id);
  }

  /**
   * 获取所有快照
   */
  getAllSnapshots(): StateSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * 恢复到快照
   */
  async restoreSnapshot(id: string): Promise<boolean> {
    const snapshot = this.getSnapshot(id);
    if (!snapshot) {
      return false;
    }

    await this.stateLock.acquire();
    try {
      // 恢复黑板
      this.blackboardManager = BlackboardManager.restore(snapshot.blackboard);

      // 恢复会话
      this.session.blackboard = snapshot.blackboard;
      this.session.speeches = [...snapshot.speeches];
      this.session.updatedAt = Date.now();

      this.emit({
        type: 'session_update',
        path: 'session',
        oldValue: null,
        newValue: snapshot,
        timestamp: Date.now()
      });

      return true;
    } finally {
      this.stateLock.release();
    }
  }

  /**
   * 删除快照
   */
  deleteSnapshot(id: string): boolean {
    const index = this.snapshots.findIndex(s => s.id === id);
    if (index !== -1) {
      this.snapshots.splice(index, 1);
      return true;
    }
    return false;
  }

  // ========== 持久化 ==========

  /**
   * 导出为 JSON
   */
  toJSON(): string {
    return JSON.stringify({
      id: this.session.id,
      originalQuestion: this.session.originalQuestion,
      customExpert: this.session.customExpert,
      blackboard: this.session.blackboard,
      speeches: this.session.speeches,
      createdAt: this.session.createdAt,
      updatedAt: this.session.updatedAt,
      status: this.session.status,
      snapshots: this.snapshots
    }, null, 2);
  }

  /**
   * 导出为 Markdown 报告
   */
  toMarkdownReport(): string {
    const blackboard = this.session.blackboard;
    const speeches = this.session.speeches;

    let report = `# 多 Agent 辩论报告\n\n`;
    report += `**会话 ID**: ${this.session.id}\n`;
    report += `**创建时间**: ${new Date(this.session.createdAt).toLocaleString('zh-CN')}\n`;
    report += `**状态**: ${this.session.status}\n\n`;

    report += `## 核心议题\n\n${blackboard.currentTopic}\n\n`;

    report += `## 辩论结果\n\n`;
    report += `- **总轮次**: ${blackboard.round}\n`;
    report += `- **共识得分**: ${blackboard.consensusScore}/100\n\n`;

    if (blackboard.verifiedFacts.length > 0) {
      report += `## 已验证事实\n\n`;
      for (const fact of blackboard.verifiedFacts) {
        report += `- ${fact}\n`;
      }
      report += `\n`;
    }

    if (blackboard.coreClashes.length > 0) {
      report += `## 待解决争议\n\n`;
      for (const clash of blackboard.coreClashes) {
        report += `- ${clash}\n`;
      }
      report += `\n`;
    }

    if (Object.keys(blackboard.agentInsights).length > 0) {
      report += `## Agent 见解\n\n`;
      for (const [agent, insight] of Object.entries(blackboard.agentInsights)) {
        report += `### ${agent}\n\n${insight}\n\n`;
      }
    }

    if (speeches.length > 0) {
      report += `## 发言记录\n\n`;

      // 按轮次分组
      const groupedByRound: Record<number, AgentSpeech[]> = {};
      for (const speech of speeches) {
        if (!groupedByRound[speech.round]) {
          groupedByRound[speech.round] = [];
        }
        groupedByRound[speech.round].push(speech);
      }

      for (const round of Object.keys(groupedByRound).map(Number).sort((a, b) => a - b)) {
        report += `### Round ${round}\n\n`;
        for (const speech of groupedByRound[round]) {
          report += `**${speech.agentName}** (${speech.step}):\n`;
          report += `> ${speech.content.replace(/\n/g, '\n> ')}\n\n`;
        }
      }
    }

    return report;
  }

  /**
   * 生成最终报告
   */
  generateFinalReport(): FinalReport {
    const blackboard = this.session.blackboard;

    return {
      coreConclusion: blackboard.currentTopic,
      perspectives: Object.entries(blackboard.agentInsights)
        .filter(([role]) => role === 'proposer' || role === 'expert')
        .map(([role, insight]) => `**${role}**: ${insight}`),
      risks: blackboard.coreClashes,
      facts: blackboard.verifiedFacts,
      totalRounds: blackboard.round,
      finalScore: blackboard.consensusScore,
      detailedReport: this.toMarkdownReport()
    };
  }

  // ========== 事件系统 ==========

  /**
   * 订阅状态变更
   */
  subscribe(handler: StateSubscriber): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  /**
   * 发送事件
   */
  private emit(event: StateChangeEvent): void {
    for (const handler of this.subscribers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[StateManager] Error in subscriber:', error);
      }
    }
  }

  // ========== 压缩与清理 ==========

  /**
   * 压缩历史
   */
  compressHistory(): string {
    return this.blackboardManager.compressHistory();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.subscribers.clear();
    this.snapshots = [];
    this.lockManager.forceReleaseAll('blackboard');
  }
}

/**
 * 生成会话 ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 创建状态管理器（便捷工厂函数）
 */
export function createStateManager(
  topic: string,
  config?: Partial<StateManagerConfig>
): StateManager {
  return StateManager.create(topic, undefined, config);
}
