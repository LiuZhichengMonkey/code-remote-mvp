/**
 * 辩论协调器
 * Debate Orchestrator
 *
 * 管理多智能体对抗的工作流程
 */

import {
  DebateSession,
  DebateConfig,
  DebateStep,
  DebateEvent,
  GlobalBlackboard,
  AgentSpeech,
  FinalReport,
  AgentRole
} from './types';
import { BlackboardManager, FluffDetector } from './blackboard';
import {
  BaseAgent,
  ModeratorAgent,
  ProposerAgent,
  SkepticAgent,
  FactCheckerAgent,
  ExpertAgent,
  AgentFactory
} from './agents';
import { LLMAdapter, LLMResult, createLLMAdapter, OpenAICompatibleAdapter } from './llm-adapter';

/**
 * Token 使用统计
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  byRole: Map<string, { inputTokens: number; outputTokens: number; requests: number }>;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: DebateConfig = {
  maxRounds: 10,
  terminationScore: 85,
  compressHistory: true,
  compressionInterval: 2,
  enableFactChecker: true,
  enableExpert: true
};

/**
 * 辩论协调器
 */
export class DebateOrchestrator {
  private session: DebateSession;
  private blackboardManager: BlackboardManager;
  private config: DebateConfig;
  private agents: Map<AgentRole, BaseAgent> = new Map();
  private eventHandlers: Set<(event: DebateEvent) => void> = new Set();
  private customExpert?: ExpertAgent;
  private llmAdapter?: LLMAdapter;
  private llmInvoker?: (prompt: string, systemPrompt: string) => Promise<string>;

  // Token 统计
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requests: 0,
    byRole: new Map()
  };

  /**
   * 创建新的辩论会话
   */
  static create(
    question: string,
    customExpert?: { name: string; background: string },
    config?: Partial<DebateConfig>
  ): DebateOrchestrator {
    const blackboardManager = BlackboardManager.create(question);
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const session: DebateSession = {
      id: generateId(),
      originalQuestion: question,
      customExpert,
      blackboard: blackboardManager.getState(),
      speeches: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'running'
    };

    const orchestrator = new DebateOrchestrator(session, blackboardManager, mergedConfig);

    if (customExpert) {
      orchestrator.setCustomExpert(customExpert.name, customExpert.background);
    }

    return orchestrator;
  }

  /**
   * 从现有状态恢复
   */
  static restore(stateJson: string): DebateOrchestrator {
    const data = JSON.parse(stateJson);
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

    const config: DebateConfig = data.config || DEFAULT_CONFIG;
    const orchestrator = new DebateOrchestrator(session, blackboardManager, config);

    if (data.customExpert) {
      orchestrator.setCustomExpert(data.customExpert.name, data.customExpert.background);
    }

    return orchestrator;
  }

  /**
   * 构造函数
   */
  constructor(
    session: DebateSession,
    blackboardManager: BlackboardManager,
    config: DebateConfig
  ) {
    this.session = session;
    this.blackboardManager = blackboardManager;
    this.config = config;

    // 初始化默认 Agent
    this.agents.set('moderator', AgentFactory.getAgent('moderator'));
    this.agents.set('proposer', AgentFactory.getAgent('proposer'));
    this.agents.set('skeptic', AgentFactory.getAgent('skeptic'));
    if (config.enableFactChecker) {
      this.agents.set('fact-checker', AgentFactory.getAgent('fact-checker'));
    }
  }

  /**
   * 设置 LLM 适配器
   */
  setLLMAdapter(adapter: LLMAdapter): void {
    this.llmAdapter = adapter;
    // 兼容旧的回调方式
    this.llmInvoker = async (prompt: string, systemPrompt: string) => {
      const result = await adapter.invoke(systemPrompt, prompt);
      return result.content;
    };
  }

  /**
   * 获取 Token 使用统计
   */
  getTokenUsage(): TokenUsage {
    // 如果适配器支持 getTotalUsage，合并统计
    if (this.llmAdapter && 'getTotalUsage' in this.llmAdapter) {
      const adapterUsage = (this.llmAdapter as OpenAICompatibleAdapter).getTotalUsage();
      return {
        ...adapterUsage,
        byRole: this.tokenUsage.byRole
      };
    }
    return { ...this.tokenUsage, totalTokens: this.tokenUsage.inputTokens + this.tokenUsage.outputTokens };
  }

  /**
   * 重置 Token 统计
   */
  resetTokenUsage(): void {
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
      byRole: new Map()
    };
    if (this.llmAdapter && 'resetUsage' in this.llmAdapter) {
      (this.llmAdapter as OpenAICompatibleAdapter).resetUsage();
    }
  }

  /**
   * 设置 LLM 调用器（兼容旧方式）
   * @deprecated 使用 setLLMAdapter 替代
   */
  setLLMInvoker(invoker: (prompt: string, systemPrompt: string) => Promise<string>): void {
    this.llmInvoker = invoker;
  }

  /**
   * 设置自定义专家
   */
  setCustomExpert(name: string, background: string): void {
    this.customExpert = AgentFactory.createExpert(name, background);
    this.agents.set('expert', this.customExpert);
    this.session.customExpert = { name, background };
  }

  /**
   * 订阅事件
   */
  subscribe(handler: (event: DebateEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * 发送事件
   */
  private emit(event: DebateEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  /**
   * 运行一轮辩论
   */
  async runRound(): Promise<GlobalBlackboard> {
    if (this.session.status !== 'running') {
      throw new Error(`Cannot run round: session is ${this.session.status}`);
    }

    const blackboard = this.blackboardManager.getState();
    const round = blackboard.round + 1;

    // Step 1: 建构者发言
    await this.runStep('proposer', round);

    // Step 2: 专家补充（如果有）
    if (this.config.enableExpert && this.customExpert) {
      await this.runStep('expert', round);
    }

    // Step 3: 破坏者质询
    await this.runStep('skeptic', round);

    // Step 4: 查证员核查（如果有事实争议）
    if (this.config.enableFactChecker && this.hasFactDispute()) {
      await this.runStep('fact-check', round);
    }

    // Step 5: 结算
    await this.runSettlement(round);

    // 更新黑板
    this.session.blackboard = this.blackboardManager.getState();
    this.session.updatedAt = Date.now();

    // 检查是否应该终止
    if (this.blackboardManager.shouldTerminate(this.config.terminationScore)) {
      await this.terminate();
    } else if (round >= this.config.maxRounds) {
      // 达到最大轮次
      await this.terminate();
    } else {
      // 进入下一轮
      this.blackboardManager.nextRound();

      // 历史压缩
      if (this.config.compressHistory && round % this.config.compressionInterval === 0) {
        this.blackboardManager.compressHistory();
      }
    }

    return this.session.blackboard;
  }

  /**
   * 运行单个步骤
   */
  private async runStep(step: DebateStep, round: number): Promise<void> {
    this.blackboardManager.setStep(step);

    const agent = this.getAgentForStep(step);
    if (!agent) {
      return;
    }

    // 构建上下文
    const context = this.buildContext(step);

    // 生成发言
    let content: string;

    if (this.llmAdapter) {
      // 使用真实 LLM 适配器
      const result = await this.llmAdapter.invoke(agent.systemPrompt, context, {
        agentRole: agent.role  // 传递角色以支持会话复用
      });
      content = result.content;

      // 记录 token 使用
      if (result.usage) {
        this.tokenUsage.inputTokens += result.usage.inputTokens;
        this.tokenUsage.outputTokens += result.usage.outputTokens;
        this.tokenUsage.requests++;

        // 按角色统计
        const roleKey = agent.role;
        const roleUsage = this.tokenUsage.byRole.get(roleKey) || { inputTokens: 0, outputTokens: 0, requests: 0 };
        roleUsage.inputTokens += result.usage.inputTokens;
        roleUsage.outputTokens += result.usage.outputTokens;
        roleUsage.requests++;
        this.tokenUsage.byRole.set(roleKey, roleUsage);
      }
    } else if (this.llmInvoker) {
      // 使用旧的 invoker 方式
      content = await this.llmInvoker(context, agent.systemPrompt);
    } else {
      // 使用模板
      content = await agent.generateSpeech(this.blackboardManager.getState(), context);
    }

    // 验证格式（非 moderator）
    if (step !== 'settlement') {
      const validation = FluffDetector.validateFormat(content);
      if (!validation.isValid) {
        console.warn(`[Debate] ${agent.name} 发言格式问题:`, validation.issues);
      }
    }

    // 记录发言（保存到 session 和 blackboard）
    const speech: AgentSpeech = {
      agentName: agent.name,
      role: agent.role,
      content,
      timestamp: Date.now(),
      round,
      step
    };

    // 保存到 session（持久化，不会被压缩）
    this.session.speeches.push(speech);

    // 保存到 blackboard（会被压缩）
    this.blackboardManager.recordSpeech(speech);

    // 更新黑板
    this.blackboardManager.updateAgentInsight(agent.name, this.extractInsight(content));

    // 发送事件
    this.emit({
      type: 'speech',
      data: speech,
      timestamp: Date.now()
    });
  }

  /**
   * 结算步骤
   */
  private async runSettlement(round: number): Promise<void> {
    this.blackboardManager.setStep('settlement');

    const moderator = this.agents.get('moderator');
    if (!moderator) {
      return;
    }

    // 构建上下文
    const context = this.buildContext('settlement');

    // 生成发言
    let content: string;

    if (this.llmAdapter) {
      // 使用真实 LLM 适配器
      const result = await this.llmAdapter.invoke(moderator.systemPrompt, context, {
        agentRole: moderator.role  // 传递角色以支持会话复用
      });
      content = result.content;

      // 记录 token 使用
      if (result.usage) {
        this.tokenUsage.inputTokens += result.usage.inputTokens;
        this.tokenUsage.outputTokens += result.usage.outputTokens;
        this.tokenUsage.requests++;

        // 按角色统计
        const roleKey = moderator.role;
        const roleUsage = this.tokenUsage.byRole.get(roleKey) || { inputTokens: 0, outputTokens: 0, requests: 0 };
        roleUsage.inputTokens += result.usage.inputTokens;
        roleUsage.outputTokens += result.usage.outputTokens;
        roleUsage.requests++;
        this.tokenUsage.byRole.set(roleKey, roleUsage);
      }
    } else if (this.llmInvoker) {
      // 使用旧的 invoker 方式
      content = await this.llmInvoker(context, moderator.systemPrompt);
    } else {
      // 使用模板
      content = await moderator.generateSpeech(this.blackboardManager.getState(), context);
    }

    // 记录发言（保存到 session 和 blackboard）
    const speech: AgentSpeech = {
      agentName: moderator.name,
      role: moderator.role,
      content,
      timestamp: Date.now(),
      round,
      step: 'settlement'
    };

    // 保存到 session（持久化，不会被压缩）
    this.session.speeches.push(speech);

    // 保存到 blackboard（会被压缩）
    this.blackboardManager.recordSpeech(speech);

    // 发送发言事件
    this.emit({
      type: 'speech',
      data: speech,
      timestamp: Date.now()
    });

    // 计算并更新分数
    const score = this.calculateConsensusScore();
    this.blackboardManager.updateScore(score);

    // 发送黑板更新事件
    this.emit({
      type: 'blackboard_update',
      data: this.blackboardManager.getState(),
      timestamp: Date.now()
    });

    // 发送轮次完成事件
    this.emit({
      type: 'round_complete',
      data: {
        round,
        blackboard: this.blackboardManager.getState(),
        speeches: this.blackboardManager.getSpeechHistory(round)
      } as any,
      timestamp: Date.now()
    });
  }

  /**
   * 计算共识分数
   */
  private calculateConsensusScore(): number {
    const blackboard = this.blackboardManager.getState();

    // 基于黑板状态计算分数
    let score = 0;

    // 基础分：每轮增加 10 分
    score += Math.min(blackboard.round * 10, 30);

    // 事实分：每个已验证事实增加 5 分
    score += Math.min(blackboard.verifiedFacts.length * 5, 25);

    // 争议解决分：争议越少分数越高
    const clashPenalty = blackboard.coreClashes.length * 5;
    score += Math.max(0, 25 - clashPenalty);

    // 见解分：每个 Agent 见解增加 5 分
    const insightsCount = Object.keys(blackboard.agentInsights).length;
    score += Math.min(insightsCount * 5, 20);

    return Math.min(100, Math.max(0, score));
  }

  /**
   * 获取步骤对应的 Agent
   */
  private getAgentForStep(step: DebateStep): BaseAgent | undefined {
    switch (step) {
      case 'proposer':
        return this.agents.get('proposer');
      case 'expert':
        return this.agents.get('expert');
      case 'skeptic':
        return this.agents.get('skeptic');
      case 'fact-check':
        return this.agents.get('fact-checker');
      case 'settlement':
        return this.agents.get('moderator');
      default:
        return undefined;
    }
  }

  /**
   * 构建上下文
   */
  private buildContext(step: DebateStep): string {
    const blackboard = this.blackboardManager.getState();

    let context = `## 当前状态
- 轮次: ${blackboard.round + 1}
- 核心议题: ${blackboard.currentTopic}
- 当前步骤: ${step}

## 已验证事实
${blackboard.verifiedFacts.map(f => `- ${f}`).join('\n') || '无'}

## 待解决争议
${blackboard.coreClashes.map(c => `- ${c}`).join('\n') || '无'}

## 历史摘要
${blackboard.historySummary || '首轮讨论，暂无历史'}

---
请基于以上状态，以 ${step} 的角色发表观点。`;

    // 如果是质询或补充，加入上一轮发言
    if (step === 'skeptic' || step === 'expert') {
      const lastSpeeches = this.blackboardManager.getSpeechHistory(blackboard.round);
      if (lastSpeeches.length > 0) {
        context += `\n\n## 本轮发言记录\n`;
        for (const speech of lastSpeeches) {
          context += `\n[${speech.role}] ${speech.content.substring(0, 200)}...\n`;
        }
      }
    }

    return context;
  }

  /**
   * 检查是否有事实争议
   */
  private hasFactDispute(): boolean {
    const blackboard = this.blackboardManager.getState();
    // 简单判断：如果争议点包含数字或特定关键词
    const factKeywords = ['数据', '统计', '研究', '报告', '百分比', '比例', '数量', '年份'];
    return blackboard.coreClashes.some(clash =>
      factKeywords.some(keyword => clash.includes(keyword))
    );
  }

  /**
   * 提取见解摘要
   */
  private extractInsight(content: string): string {
    // 简单提取前 200 字符作为摘要
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 200) {
      return cleaned;
    }
    return cleaned.substring(0, 197) + '...';
  }

  /**
   * 终止辩论
   */
  private async terminate(): Promise<void> {
    this.session.status = 'completed';

    const moderator = this.agents.get('moderator') as ModeratorAgent;
    const report = moderator.generateFinalReport(
      this.blackboardManager.getState(),
      this.session.speeches
    );

    const finalReport: FinalReport = {
      coreConclusion: this.session.blackboard.currentTopic,
      perspectives: Object.values(this.session.blackboard.agentInsights),
      risks: this.session.blackboard.coreClashes,
      facts: this.session.blackboard.verifiedFacts,
      totalRounds: this.session.blackboard.round,
      finalScore: this.session.blackboard.consensusScore,
      detailedReport: report
    };

    // 保存最终报告到会话
    (this.session as any).finalReport = finalReport;

    // 发送完成事件
    this.emit({
      type: 'debate_complete',
      data: finalReport,
      timestamp: Date.now()
    });
  }

  /**
   * 获取最终报告
   */
  getFinalReport(): FinalReport | null {
    return (this.session as any).finalReport || null;
  }

  /**
   * 导出完整报告为 Markdown
   */
  exportMarkdownReport(): string {
    const report = (this.session as any).finalReport;
    const blackboard = this.session.blackboard;

    let md = `# 多智能体辩论报告\n\n`;
    md += `> 生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

    md += `## 基本信息\n\n`;
    md += `| 项目 | 值 |\n`;
    md += `|------|----|\n`;
    md += `| 辩论 ID | ${this.session.id} |\n`;
    md += `| 原始问题 | ${this.session.originalQuestion} |\n`;
    md += `| 总轮次 | ${blackboard.round} |\n`;
    md += `| 最终得分 | ${blackboard.consensusScore}/100 |\n`;
    md += `| 专家 | ${this.session.customExpert?.name || '无'} |\n\n`;

    md += `## 核心结论\n\n`;
    md += `${blackboard.currentTopic}\n\n`;

    if (report?.detailedReport) {
      md += `${report.detailedReport}\n\n`;
    }

    md += `## 各方见解\n\n`;
    for (const [agent, insight] of Object.entries(blackboard.agentInsights)) {
      md += `### ${agent}\n\n`;
      md += `${insight}\n\n`;
    }

    md += `## 已验证事实\n\n`;
    if (blackboard.verifiedFacts.length > 0) {
      for (const fact of blackboard.verifiedFacts) {
        md += `- ${fact}\n`;
      }
    } else {
      md += `_暂无_\n`;
    }
    md += `\n`;

    md += `## 待解决问题\n\n`;
    if (blackboard.coreClashes.length > 0) {
      for (const clash of blackboard.coreClashes) {
        md += `- ${clash}\n`;
      }
    } else {
      md += `_全部解决_\n`;
    }
    md += `\n`;

    md += `## 完整辩论记录\n\n`;

    // 按轮次分组发言
    const speechesByRound: Record<number, AgentSpeech[]> = {};
    for (const speech of this.session.speeches) {
      if (!speechesByRound[speech.round]) {
        speechesByRound[speech.round] = [];
      }
      speechesByRound[speech.round].push(speech);
    }

    if (Object.keys(speechesByRound).length > 0) {
      for (const round of Object.keys(speechesByRound).map(Number).sort((a, b) => a - b)) {
        md += `### 第 ${round} 轮\n\n`;
        for (const speech of speechesByRound[round]) {
          md += `**[${speech.role}] ${speech.agentName}**\n\n`;
          md += `${speech.content}\n\n`;
          md += `---\n\n`;
        }
      }
    } else {
      md += `_暂无记录（可能已被压缩）_\n\n`;
    }

    md += `---\n\n`;
    md += `_共 ${this.session.speeches.length} 条发言_\n`;

    return md;
  }

  /**
   * 暂停辩论
   */
  pause(): void {
    this.session.status = 'paused';
  }

  /**
   * 恢复辩论
   */
  resume(): void {
    if (this.session.status === 'paused') {
      this.session.status = 'running';
    }
  }

  /**
   * 获取当前状态
   */
  getState(): DebateSession {
    return { ...this.session };
  }

  /**
   * 获取黑板
   */
  getBlackboard(): GlobalBlackboard {
    return this.blackboardManager.getState();
  }

  /**
   * 导出状态
   */
  exportState(): string {
    return JSON.stringify({
      id: this.session.id,
      originalQuestion: this.session.originalQuestion,
      customExpert: this.session.customExpert,
      blackboard: this.session.blackboard,
      speeches: this.session.speeches,
      config: this.config,
      createdAt: this.session.createdAt,
      updatedAt: this.session.updatedAt,
      status: this.session.status
    }, null, 2);
  }

  /**
   * 注入人工干预
   */
  injectHumanInput(input: string, targetRole?: AgentRole): void {
    // 将人工干预作为特殊发言记录
    const speech: AgentSpeech = {
      agentName: 'Human',
      role: targetRole || 'moderator',
      content: `[人工干预] ${input}`,
      timestamp: Date.now(),
      round: this.session.blackboard.round,
      step: 'settlement'
    };

    this.blackboardManager.recordSpeech(speech);

    // 根据输入类型更新黑板
    if (input.includes('攻击')) {
      // 要求反方加强攻击
      this.blackboardManager.updateTopic(`反方需要更激进地攻击: ${input}`);
    } else if (input.includes('补充')) {
      // 要求补充
      this.blackboardManager.addClash(input);
    }
  }
}

/**
 * 生成 ID
 */
function generateId(): string {
  return `debate_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
