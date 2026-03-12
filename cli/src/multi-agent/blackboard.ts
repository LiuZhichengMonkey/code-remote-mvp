/**
 * 全局黑板机制
 * The Global Blackboard
 *
 * 这是系统的唯一记忆载体，解决上下文爆炸问题
 */

import {
  GlobalBlackboard,
  DebateStep,
  AgentSpeech
} from './types';

/**
 * 黑板管理器
 */
export class BlackboardManager {
  private blackboard: GlobalBlackboard;
  private speechHistory: AgentSpeech[] = [];
  private compressionCount = 0;

  /**
   * 创建新的黑板
   */
  static create(topic: string): BlackboardManager {
    const blackboard: GlobalBlackboard = {
      round: 0,
      currentTopic: topic,
      verifiedFacts: [],
      coreClashes: [],
      consensusScore: 0,
      agentInsights: {},
      currentStep: 'proposer'
    };

    return new BlackboardManager(blackboard);
  }

  /**
   * 从现有状态恢复黑板
   */
  static restore(state: GlobalBlackboard): BlackboardManager {
    return new BlackboardManager(state);
  }

  private constructor(blackboard: GlobalBlackboard) {
    this.blackboard = { ...blackboard };
  }

  /**
   * 获取当前黑板状态
   */
  getState(): GlobalBlackboard {
    return { ...this.blackboard };
  }

  /**
   * 记录 Agent 发言
   */
  recordSpeech(speech: AgentSpeech): void {
    this.speechHistory.push(speech);
  }

  /**
   * 获取发言历史
   */
  getSpeechHistory(round?: number): AgentSpeech[] {
    if (round !== undefined) {
      return this.speechHistory.filter(s => s.round === round);
    }
    return [...this.speechHistory];
  }

  /**
   * 进入下一轮
   */
  nextRound(): void {
    this.blackboard.round += 1;
    this.blackboard.currentStep = 'proposer';
    this.compressionCount += 1;
  }

  /**
   * 更新当前步骤
   */
  setStep(step: DebateStep): void {
    this.blackboard.currentStep = step;
  }

  /**
   * 更新核心议题
   */
  updateTopic(topic: string): void {
    this.blackboard.currentTopic = topic;
  }

  /**
   * 添加已验证事实
   */
  addVerifiedFact(fact: string): void {
    if (!this.blackboard.verifiedFacts.includes(fact)) {
      this.blackboard.verifiedFacts.push(fact);
    }
  }

  /**
   * 添加核心争议点
   */
  addClash(clash: string): void {
    if (!this.blackboard.coreClashes.includes(clash)) {
      this.blackboard.coreClashes.push(clash);
    }
  }

  /**
   * 移除已解决的争议点
   */
  resolveClash(clash: string): void {
    const index = this.blackboard.coreClashes.indexOf(clash);
    if (index !== -1) {
      this.blackboard.coreClashes.splice(index, 1);
    }
  }

  /**
   * 更新 Agent 见解
   */
  updateAgentInsight(agentName: string, insight: string): void {
    this.blackboard.agentInsights[agentName] = insight;
  }

  /**
   * 更新共识分数
   */
  updateScore(score: number): void {
    this.blackboard.consensusScore = Math.max(0, Math.min(100, score));
  }

  /**
   * 检查是否应该终止
   */
  shouldTerminate(threshold: number = 85): boolean {
    return this.blackboard.consensusScore >= threshold;
  }

  /**
   * 压缩历史
   * 将发言历史压缩为摘要，防止上下文爆炸
   */
  compressHistory(): string {
    if (this.speechHistory.length === 0) {
      return '';
    }

    // 生成摘要
    const summary = this.generateSummary();

    // 清空历史
    this.speechHistory = [];

    // 保存摘要到黑板
    this.blackboard.historySummary = summary;

    return summary;
  }

  /**
   * 生成历史摘要
   */
  private generateSummary(): string {
    const groupedByRound: Record<number, AgentSpeech[]> = {};

    for (const speech of this.speechHistory) {
      if (!groupedByRound[speech.round]) {
        groupedByRound[speech.round] = [];
      }
      groupedByRound[speech.round].push(speech);
    }

    const summaries: string[] = [];

    for (const round of Object.keys(groupedByRound).map(Number).sort((a, b) => a - b)) {
      const speeches = groupedByRound[round];
      const keyPoints = speeches
        .map(s => `[${s.role}] ${this.extractKeyPoint(s.content)}`)
        .join('; ');
      summaries.push(`R${round}: ${keyPoints}`);
    }

    return summaries.join('\n');
  }

  /**
   * 提取关键点（每个论点不超过 50 字）
   */
  private extractKeyPoint(content: string, maxLength: number = 50): string {
    // 移除多余的空白和换行
    const cleaned = content.replace(/\s+/g, ' ').trim();

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    // 尝试在句子边界截断
    const sentences = cleaned.match(/[^。！？.!?]+[。！？.!?]/g);
    if (sentences && sentences.length > 0) {
      const firstSentence = sentences[0].trim();
      if (firstSentence.length <= maxLength) {
        return firstSentence;
      }
    }

    // 强制截断
    return cleaned.substring(0, maxLength - 3) + '...';
  }

  /**
   * 导出为 JSON（用于持久化）
   */
  toJSON(): string {
    return JSON.stringify({
      blackboard: this.blackboard,
      speeches: this.speechHistory
    }, null, 2);
  }

  /**
   * 从 JSON 恢复
   */
  static fromJSON(json: string): BlackboardManager {
    const data = JSON.parse(json);
    const manager = new BlackboardManager(data.blackboard);
    manager.speechHistory = data.speeches || [];
    return manager;
  }
}

/**
 * 废话检测器
 * 确保所有发言都是干货，没有寒暄和客套
 */
export class FluffDetector {
  private static readonly FLUFF_PATTERNS = [
    /作为.*我认为/,
    /我觉得/,
    /在我看来/,
    /我个人认为/,
    /我想说的是/,
    /首先.*其次/,
    /总而言之/,
    /综上所述/,
    /不言而喻/,
    /众所周知/
  ];

  /**
   * 检测发言是否包含废话
   */
  static detectFluff(content: string): {
    hasFluff: boolean;
    fluffCount: number;
    cleanContent: string;
  } {
    let cleanContent = content;
    let fluffCount = 0;

    for (const pattern of this.FLUFF_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        fluffCount += matches.length;
        cleanContent = cleanContent.replace(pattern, '');
      }
    }

    return {
      hasFluff: fluffCount > 0,
      fluffCount,
      cleanContent: cleanContent.replace(/\s+/g, ' ').trim()
    };
  }

  /**
   * 验证发言格式
   * 每个核心论点不超过 50 字
   */
  static validateFormat(content: string): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // 检查是否使用列表格式
    if (!content.includes('-') && !content.includes('*') && !content.includes('1.')) {
      issues.push('建议使用 Markdown 列表格式');
    }

    // 检查论点长度
    const points = content.split(/[\n\-\*]/).filter(p => p.trim().length > 0);
    for (const point of points) {
      if (point.trim().length > 50) {
        issues.push(`论点过长 (${point.trim().length} 字): "${point.trim().substring(0, 30)}..."`);
      }
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }
}
