/**
 * 讨论协调器 - 协调多 Agent 讨论
 *
 * 核心功能:
 * - 解析 @提及，动态创建 Agent
 * - 协调讨论流程（轮流发言、总结）
 * - 生成讨论结果
 * - 支持对抗/协作模式
 * - 集成黑板机制防止上下文爆炸
 * - 共识评分自动终止
 */

import {
  UnifiedAgent,
  AgentContext,
  AgentResponse,
  AgentSpeech,
  GlobalBlackboard
} from '../types';
import { BaseAgent, AgentFactory, ModeratorAgent, ProposerAgent, SkepticAgent } from '../agents';
import { BlackboardManager, FluffDetector } from '../blackboard';
import { EventBus, globalEventBus } from '../bus/EventBus';
import { AgentParser, BUILTIN_TEMPLATES } from './AgentParser';
import { ModeDetector, DiscussionMode, ModeDetectionResult } from './ModeDetector';
import {
  DiscussionSession,
  DiscussionConfig,
  DiscussionMessage,
  DiscussionParticipant,
  DiscussionEvent,
  DiscussionResult,
  DiscussionSubscriber,
  AgentMention,
  AgentTemplate,
  DEFAULT_DISCUSSION_CONFIG,
  TerminationMode
} from './types';
import { SubagentSessionManager, createSubagentSessionManager } from './SubagentSessionManager';
import { AsyncLock } from '../bus/LockManager';

/**
 * 讨论协调器
 */
export class DiscussionOrchestrator {
  private parser: AgentParser;
  private config: DiscussionConfig;
  private sessions: Map<string, DiscussionSession> = new Map();
  private subscribers: Set<DiscussionSubscriber> = new Set();
  private llmInvoker?: (prompt: string, systemPrompt: string) => Promise<string>;
  private subagentManager: SubagentSessionManager;
  private useRealLLM: boolean = true; // 默认使用真实 LLM

  // 新增：黑板管理器缓存
  private blackboardManagers: Map<string, BlackboardManager> = new Map();
  // 新增：黑板写入锁
  private blackboardLock: AsyncLock = new AsyncLock();
  // 新增：EventBus（可选启用）
  private eventBus: EventBus;

  constructor(config?: Partial<DiscussionConfig>) {
    this.config = { ...DEFAULT_DISCUSSION_CONFIG, ...config };
    this.parser = new AgentParser();
    this.parser.registerTemplates(BUILTIN_TEMPLATES);
    this.subagentManager = createSubagentSessionManager({
      timeout: config?.messageTimeout || 120000,
      maxConcurrency: 3,
      cwd: process.env.CODEREMOTE_DEFAULT_WORKSPACE || process.cwd()
    });
    this.eventBus = globalEventBus;
  }

  /**
   * 设置 LLM 调用器
   */
  setLLMInvoker(invoker: (prompt: string, systemPrompt: string) => Promise<string>): void {
    this.llmInvoker = invoker;
  }

  /**
   * 设置是否使用真实 LLM
   */
  setUseRealLLM(use: boolean): void {
    this.useRealLLM = use;
  }

  /**
   * 获取是否使用真实 LLM
   */
  getUseRealLLM(): boolean {
    return this.useRealLLM;
  }

  /**
   * 注册 Agent 模板
   */
  registerTemplate(template: AgentTemplate): void {
    this.parser.registerTemplate(template);
  }

  /**
   * 批量注册模板
   */
  registerTemplates(templates: AgentTemplate[]): void {
    this.parser.registerTemplates(templates);
  }

  /**
   * 订阅讨论事件
   */
  subscribe(handler: DiscussionSubscriber): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  /**
   * 发送事件
   */
  private emit(event: DiscussionEvent): void {
    for (const handler of this.subscribers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[DiscussionOrchestrator] Error in subscriber:', error);
      }
    }
  }

  /**
   * 创建讨论会话
   */
  createSession(input: string, customConfig?: Partial<DiscussionConfig>): DiscussionSession {
    const config = customConfig ? { ...this.config, ...customConfig } : this.config;
    const mentions = this.parser.parseUnique(input);
    const participants = this.createParticipants(mentions);

    // 提取任务内容
    let task = this.parser.removeMentions(input);

    // 自动检测讨论模式
    let mode: DiscussionMode = config.mode;
    let modeReason = '';

    if (config.mode === 'auto') {
      const detection = ModeDetector.detect(task, participants.map(p => p.template));
      mode = detection.mode;
      modeReason = detection.reason;
      console.log(`[DiscussionOrchestrator] Auto-detected mode: ${mode} (${detection.reason})`);

      // 清理任务中的模式关键词
      task = ModeDetector.stripModeKeywords(task);
    } else {
      mode = config.mode;
      modeReason = `用户指定模式: ${mode}`;
    }

    const session: DiscussionSession = {
      id: generateSessionId(),
      originalInput: input,
      mentions,
      participants,
      messages: [],
      currentRound: 0,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config,
      // 新增字段
      mode,
      modeReason,
      consensusScore: 0,
      verifiedFacts: [],
      coreClashes: [],
      agentInsights: {},
      topicType: ModeDetector.detect(task, participants.map(p => p.template)).analysis.topicType
    };

    // 创建黑板管理器
    const blackboardManager = BlackboardManager.create(task);
    this.blackboardManagers.set(session.id, blackboardManager);

    this.sessions.set(session.id, session);

    // 发送模式检测事件
    this.emit({
      type: 'mode_detected',
      sessionId: session.id,
      data: { mode, reason: modeReason },
      timestamp: Date.now()
    });

    return session;
  }

  /**
   * 创建参与者
   */
  private createParticipants(mentions: AgentMention[]): DiscussionParticipant[] {
    const participants: DiscussionParticipant[] = [];
    let order = 0;

    for (const mention of mentions) {
      if (!mention.valid) continue;

      const template = this.parser.getTemplate(mention.name);
      if (!template) continue;

      const agent = this.createAgentFromTemplate(template);
      if (!agent) continue;

      participants.push({
        agent,
        template,
        activated: false,
        order: order++
      });
    }

    return participants;
  }

  /**
   * 从模板创建 Agent
   */
  private createAgentFromTemplate(template: AgentTemplate): UnifiedAgent | null {
    // 创建 BaseAgent 子类实例
    const agent = new (class extends BaseAgent {
      constructor(
        id: string,
        name: string,
        role: string,
        systemPrompt: string,
        tools: string[]
      ) {
        super({
          name,
          role: 'custom',
          description: `${role} - ${name}`,
          systemPrompt,
          tools
        });
        this.id = id;
      }

      async invoke(context: AgentContext): Promise<AgentResponse> {
        // 由 LLM 调用器处理
        return { content: '' };
      }
    })(
      template.id,
      template.name,
      template.role,
      template.systemPrompt,
      template.tools || []
    );

    return agent;
  }

  /**
   * 运行讨论
   */
  async run(sessionId: string): Promise<DiscussionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.participants.length === 0) {
      throw new Error('No valid participants in session');
    }

    // 获取黑板管理器
    let blackboardManager = this.blackboardManagers.get(sessionId);
    if (!blackboardManager) {
      blackboardManager = BlackboardManager.create(this.parser.removeMentions(session.originalInput));
      this.blackboardManagers.set(sessionId, blackboardManager);
    }

    const startTime = Date.now();

    // 重置 Token 统计
    this.subagentManager.resetTokenUsage();

    // 更新状态
    session.status = 'running';
    session.updatedAt = Date.now();

    // 发送开始事件
    this.emit({
      type: 'session_start',
      sessionId: session.id,
      data: `讨论开始，共 ${session.participants.length} 位参与者，模式: ${session.mode}`,
      timestamp: Date.now()
    });

    // 添加用户消息
    const userMessage: DiscussionMessage = {
      id: generateMessageId(),
      sender: 'User',
      role: 'user',
      content: session.originalInput,
      timestamp: Date.now(),
      type: 'user'
    };
    session.messages.push(userMessage);

    this.emit({
      type: 'message',
      sessionId: session.id,
      data: userMessage,
      timestamp: Date.now()
    });

    try {
      // 提取任务内容（移除 @提及）
      const taskContent = this.parser.removeMentions(session.originalInput);

      // 根据模式选择运行方式
      if (session.mode === 'debate') {
        // 对抗模式：使用 Proposer → Expert → Skeptic → FactChecker → Moderator 流程
        await this.runDebateMode(session, blackboardManager, taskContent);
      } else {
        // 协作模式：所有 Agent 轮流发言
        await this.runCollaborateMode(session, blackboardManager, taskContent);
      }

      // 生成结论
      const conclusion = await this.generateConclusion(session);
      session.conclusion = conclusion;

      // 更新状态
      session.status = 'completed';
      session.updatedAt = Date.now();

      // 获取 Token 统计
      const tokenUsage = this.subagentManager.getTotalTokenUsage();
      console.log(`[DiscussionOrchestrator] Total tokens: in=${tokenUsage.inputTokens}, out=${tokenUsage.outputTokens}, total=${tokenUsage.totalTokens}`);

      // 发送结束事件
      this.emit({
        type: 'session_end',
        sessionId: session.id,
        data: conclusion,
        timestamp: Date.now()
      });

      const duration = Date.now() - startTime;

      // 构建结果
      const result: DiscussionResult = {
        sessionId: session.id,
        participantCount: session.participants.length,
        totalRounds: session.currentRound,
        totalMessages: session.messages.length,
        perspectives: this.extractPerspectives(session),
        conclusion,
        agreements: this.extractAgreements(session),
        disagreements: session.coreClashes,
        recommendations: this.extractRecommendations(session),
        messages: session.messages,
        duration,
        tokenUsage
      };

      return result;
    } catch (error) {
      session.status = 'error';
      session.updatedAt = Date.now();

      this.emit({
        type: 'error',
        sessionId: session.id,
        data: error instanceof Error ? error : new Error(String(error)),
        timestamp: Date.now()
      });

      throw error;
    } finally {
      // 清理所有 Subagent 会话和映射（讨论结束后不再需要复用）
      this.subagentManager.cleanupAll();
      console.log('[DiscussionOrchestrator] All subagent sessions cleaned up');
    }
  }

  /**
   * 对抗模式：Proposer → Expert → Skeptic → FactChecker → Moderator
   */
  private async runDebateMode(
    session: DiscussionSession,
    blackboardManager: BlackboardManager,
    taskContent: string
  ): Promise<void> {
    // 创建内置角色
    const moderator = AgentFactory.getAgent('moderator');
    const proposer = AgentFactory.getAgent('proposer');
    const skeptic = AgentFactory.getAgent('skeptic');
    const factChecker = AgentFactory.getAgent('fact-checker');

    // 发送角色分配通知
    this.emit({
      type: 'message',
      sessionId: session.id,
      data: {
        id: `system_${Date.now()}`,
        sender: '系统',
        role: 'system',
        content: `⚔️ **对抗模式启动**\n\n角色分配：\n- 🎯 **主持人 (Moderator)**: 掌控流程、评分\n- ✅ **正方 (Proposer)**: 提出建设性方案\n- ❓ **反方 (Skeptic)**: 找漏洞、提风险\n- 🔍 **查证员 (FactChecker)**: 事实核查\n\n用户专家：${session.participants.map(p => p.template.name).join('、')}`,
        timestamp: Date.now(),
        type: 'system'
      },
      timestamp: Date.now()
    });

    for (let round = 1; round <= session.config.maxRounds; round++) {
      session.currentRound = round;
      blackboardManager.nextRound();

      // Phase 1: Proposer 发言（正方）
      await this.runDebateAgent(
        session, blackboardManager, proposer, 'proposer',
        `作为正方，请提出支持"${taskContent}"的建设性方案。`, round
      );

      // Phase 1b: 用户指定的专家发言（协作角色）- 顺序执行避免回调冲突
      for (const participant of session.participants) {
        await this.runDebateAgent(
          session, blackboardManager, participant.agent, 'expert',
          this.buildDebateContext(session, blackboardManager, taskContent, round), round
        );
      }

      // Phase 2: Skeptic 反方质询
      await this.runDebateAgent(
        session, blackboardManager, skeptic, 'skeptic',
        this.buildDebateContext(session, blackboardManager, taskContent, round), round
      );

      // Phase 3: FactChecker 事实核查（如果需要）
      if (session.config.enableFactChecker && blackboardManager.getState().coreClashes.length > 0) {
        await this.runDebateAgent(
          session, blackboardManager, factChecker, 'fact-check',
          this.buildDebateContext(session, blackboardManager, taskContent, round), round
        );
      }

      // Phase 4: Moderator 结算打分
      const moderatorResult = await this.runModerator(session, blackboardManager, round);

      // 计算共识分数
      const score = moderatorResult.score;
      session.consensusScore = score;
      blackboardManager.updateScore(score);

      // 发送共识更新事件
      this.emit({
        type: 'consensus_update',
        sessionId: session.id,
        data: { score, previousScore: round === 1 ? 0 : session.consensusScore },
        timestamp: Date.now()
      });

      // 检查是否应该终止
      if (this.shouldTerminate(session, round)) {
        console.log(`[Debate] Terminating at round ${round}, score: ${score}`);
        break;
      }

      // 历史压缩
      if (round % session.config.compressionInterval === 0) {
        blackboardManager.compressHistory();
      }
    }
  }

  /**
   * 协作模式：所有 Agent 轮流发言
   */
  private async runCollaborateMode(
    session: DiscussionSession,
    blackboardManager: BlackboardManager,
    taskContent: string
  ): Promise<void> {
    // 发送协作模式通知
    this.emit({
      type: 'message',
      sessionId: session.id,
      data: {
        id: `system_${Date.now()}`,
        sender: '系统',
        role: 'system',
        content: `🤝 **协作模式启动**\n\n参与者：${session.participants.map(p => `${p.template.name}`).join('、')}\n所有专家将协作分析问题。`,
        timestamp: Date.now(),
        type: 'system'
      },
      timestamp: Date.now()
    });

    for (let round = 1; round <= session.config.maxRounds; round++) {
      session.currentRound = round;
      blackboardManager.nextRound();

      // 每个 Agent 发言
      for (const participant of session.participants) {
        const message = await this.generateAgentMessage(
          session,
          participant,
          taskContent,
          round
        );

        if (message) {
          // 废话检测
          if (session.config.enableFluffDetection) {
            const fluffResult = FluffDetector.detectFluff(message.content);
            if (fluffResult.hasFluff) {
              this.emit({
                type: 'fluff_detected',
                sessionId: session.id,
                data: {
                  agentName: message.sender,
                  originalContent: message.content,
                  cleanContent: fluffResult.cleanContent,
                  fluffCount: fluffResult.fluffCount
                },
                timestamp: Date.now()
              });
              message.content = fluffResult.cleanContent;
            }
          }

          // 内容长度限制
          if (message.content.length > session.config.maxContentLength) {
            message.content = message.content.substring(0, session.config.maxContentLength) + '...';
          }

          session.messages.push(message);
          participant.activated = true;

          // 更新黑板
          await this.blackboardLock.acquire();
          try {
            blackboardManager.recordSpeech({
              agentName: message.sender,
              role: participant.template.role as any,
              content: message.content,
              timestamp: message.timestamp,
              round: message.round || round,
              step: 'expert'
            });
            blackboardManager.updateAgentInsight(message.sender, this.extractInsight(message.content));
          } finally {
            this.blackboardLock.release();
          }

          this.emit({
            type: 'agent_activated',
            sessionId: session.id,
            data: participant,
            timestamp: Date.now()
          });

          this.emit({
            type: 'message',
            sessionId: session.id,
            data: message,
            timestamp: Date.now()
          });
        }
      }

      // 生成轮次总结
      const roundSummary = this.summarizeRound(session, round);
      if (!session.roundSummaries) {
        session.roundSummaries = {};
      }
      session.roundSummaries[round] = roundSummary;

      // 发送轮次完成事件
      this.emit({
        type: 'round_complete',
        sessionId: session.id,
        data: { round, summary: roundSummary },
        timestamp: Date.now()
      });

      // 计算共识分数
      const score = this.calculateConsensusScore(session, blackboardManager);
      const previousScore = session.consensusScore;
      session.consensusScore = score;
      blackboardManager.updateScore(score);

      // 发送共识更新事件
      this.emit({
        type: 'consensus_update',
        sessionId: session.id,
        data: { score, previousScore },
        timestamp: Date.now()
      });

      // 发送黑板更新事件
      this.emit({
        type: 'blackboard_update',
        sessionId: session.id,
        data: {
          facts: session.verifiedFacts,
          clashes: session.coreClashes,
          insights: session.agentInsights
        },
        timestamp: Date.now()
      });

      // 检查是否应该终止
      if (this.shouldTerminate(session, round)) {
        console.log(`[Collaborate] Terminating at round ${round}, score: ${score}`);
        break;
      }

      // 历史压缩
      if (round % session.config.compressionInterval === 0) {
        blackboardManager.compressHistory();
      }
    }
  }

  /**
   * 运行对抗模式中的单个 Agent
   */
  private async runDebateAgent(
    session: DiscussionSession,
    blackboardManager: BlackboardManager,
    agent: UnifiedAgent,
    step: string,
    prompt: string,
    round: number
  ): Promise<void> {
    const startTime = Date.now();

    // 获取 Agent 信息
    const agentName = agent.name || step;
    const agentRole = agent.role || step;

    try {
      let content: string;

      // 使用真实 LLM
      if (this.useRealLLM) {
        content = await this.invokeRealLLMForDebate(agent, step, prompt, session, blackboardManager);
      } else if (this.llmInvoker) {
        content = await this.llmInvoker(prompt, agent.systemPrompt || '');
      } else {
        // 使用模板生成
        content = this.generateDebateTemplate(agentName, step, round);
      }

      // 废话检测
      if (session.config.enableFluffDetection) {
        const fluffResult = FluffDetector.detectFluff(content);
        if (fluffResult.hasFluff) {
          this.emit({
            type: 'fluff_detected',
            sessionId: session.id,
            data: {
              agentName,
              originalContent: content,
              cleanContent: fluffResult.cleanContent,
              fluffCount: fluffResult.fluffCount
            },
            timestamp: Date.now()
          });
          content = fluffResult.cleanContent;
        }
      }

      // 内容长度限制
      if (content.length > session.config.maxContentLength) {
        content = content.substring(0, session.config.maxContentLength) + '...';
      }

      // 创建消息
      const message: DiscussionMessage = {
        id: generateMessageId(),
        sender: agentName,
        role: agentRole,
        content,
        timestamp: Date.now(),
        type: 'agent',
        round,
        metadata: { step }
      };

      session.messages.push(message);

      // 更新黑板
      await this.blackboardLock.acquire();
      try {
        blackboardManager.recordSpeech({
          agentName,
          role: step as any,
          content,
          timestamp: message.timestamp,
          round,
          step: step as any
        });
        blackboardManager.updateAgentInsight(agentName, this.extractInsight(content));

        // 提取争议点和事实
        if (step === 'skeptic') {
          // 反方发现的争议点
          const clashes = this.extractClashes(content);
          clashes.forEach(c => blackboardManager.addClash(c));
        } else if (step === 'fact-check') {
          // 查证员验证的事实
          const facts = this.extractFacts(content);
          facts.forEach(f => blackboardManager.addVerifiedFact(f));
        }
      } finally {
        this.blackboardLock.release();
      }

      // 发送消息事件
      this.emit({
        type: 'message',
        sessionId: session.id,
        data: message,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error(`[Debate] Error running ${agentName}:`, error);
      // 发送错误消息
      this.emit({
        type: 'message',
        sessionId: session.id,
        data: {
          id: generateMessageId(),
          sender: agentName,
          role: agentRole,
          content: `❌ ${agentName} 发言时出错: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now(),
          type: 'agent',
          round
        },
        timestamp: Date.now()
      });
    }
  }

  /**
   * 运行主持人结算
   */
  private async runModerator(
    session: DiscussionSession,
    blackboardManager: BlackboardManager,
    round: number
  ): Promise<{ score: number; content: string }> {
    const blackboard = blackboardManager.getState();

    // 计算分数
    const score = this.calculateConsensusScore(session, blackboardManager);

    // 生成结算报告
    const content = `## ⚖️ 第 ${round} 轮结算报告

### 当前状态
- 核心议题: ${blackboard.currentTopic}
- 已验证事实: ${blackboard.verifiedFacts.length} 条
- 待解决争议: ${blackboard.coreClashes.length} 个
- 共识分数: ${score}/100

### 评分明细
- 逻辑严密性: ${Math.min(30, 10 + blackboard.verifiedFacts.length * 5)}/30
- 漏洞修复: ${Math.max(0, 30 - blackboard.coreClashes.length * 10)}/30
- 实际价值: ${Math.min(40, Object.keys(blackboard.agentInsights).length * 10)}/40

${score >= 85 ? '✅ **达到共识阈值，准备输出最终报告**' : '⏳ **继续下一轮讨论**'}`;

    // 创建消息
    const message: DiscussionMessage = {
      id: generateMessageId(),
      sender: 'Moderator',
      role: 'moderator',
      content,
      timestamp: Date.now(),
      type: 'agent',
      round,
      metadata: { step: 'settlement', score }
    };

    session.messages.push(message);

    // 发送消息事件
    this.emit({
      type: 'message',
      sessionId: session.id,
      data: message,
      timestamp: Date.now()
    });

    return { score, content };
  }

  /**
   * 为对抗模式调用真实 LLM
   */
  private async invokeRealLLMForDebate(
    agent: UnifiedAgent,
    step: string,
    prompt: string,
    session: DiscussionSession,
    blackboardManager: BlackboardManager
  ): Promise<string> {
    const blackboard = blackboardManager.getState();

    // 构建角色特定的 system prompt
    const systemPrompts: Record<string, string> = {
      'proposer': `你是正方（Proposer），负责提出建设性方案。
你的职责：
1. 提出创新性、大胆的解决方案
2. 强调方案的优势和潜在收益
3. 预先考虑可能的反对意见并准备回应
4. 保持目标导向，负责"破局"

发言要求：
- 直接给出核心观点，不要寒暄
- 每个论点控制在50字以内
- 使用 Markdown 列表格式
- 提供具体的论据和示例`,

      'skeptic': `你是反方（Skeptic），负责找漏洞和提风险。
你的职责：
1. 找出正方方案的逻辑漏洞
2. 提出潜在风险和极端边缘情况
3. 质疑假设的合理性
4. 保持极度理性和批判性

发言要求：
- 直接给出质疑点，不要客气
- 每个质疑控制在50字以内
- 使用 Markdown 列表格式
- 提供具体的风险场景`,

      'fact-check': `你是查证员（FactChecker），负责核查事实争议。
你的职责：
1. 识别需要验证的事实声明
2. 检查数据、统计、研究的准确性
3. 标注已验证和未验证的内容
4. 提供客观的事实结论

发言要求：
- 只关注可验证的事实
- 每个验证结果控制在30字以内
- 使用 ✅ 或 ❌ 标记
- 提供来源或理由`,

      'expert': `你是专家顾问，从专业角度提供见解。
你的职责：
1. 提供领域专业知识
2. 补充正反双方可能忽略的视角
3. 给出平衡的建议

发言要求：
- 直接给出专业观点
- 每个观点控制在50字以内
- 使用 Markdown 列表格式`
    };

    const systemPrompt = systemPrompts[step] || agent.systemPrompt || '';

    // 构建上下文
    const context = this.buildDebateContext(session, blackboardManager, prompt, session.currentRound);

    // 使用 subagentManager 调用 LLM
    return new Promise(async (resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Agent ${agent.name} timeout`));
        }
      }, session.config.messageTimeout);

      try {
        // 使用稳定的 agent ID 以便复用会话（每轮相同角色使用同一会话）
        const stableAgentId = `debate_${step}_${agent.name || step}`;
        const template: AgentTemplate = {
          id: stableAgentId,
          name: agent.name || step,
          role: step,
          systemPrompt,
          tools: agent.tools || []
        };

        // 启动会话
        const sessionId = await this.subagentManager.startAgentSession(template, context, blackboard.historySummary || '');
        console.log(`[DiscussionOrchestrator] Started debate session ${sessionId} for ${agent.name || step} (stableId: ${stableAgentId})`);

        // 等待会话完成
        const checkInterval = setInterval(() => {
          const s = this.subagentManager.getSession(sessionId);
          if (s && (s.status === 'completed' || s.status === 'error' || s.status === 'timeout')) {
            clearInterval(checkInterval);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              if (s.status === 'completed' && s.output) {
                resolve(s.output.trim());
              } else if (s.status === 'error') {
                reject(new Error(s.error || `Agent ${agent.name} failed`));
              } else {
                reject(new Error(`Agent ${agent.name} ${s.status}`));
              }
            }
          }
        }, 500);

        // 超时处理
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            reject(new Error(`Agent ${agent.name} timeout`));
          }
        }, session.config.messageTimeout);

      } catch (err) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      }
    });
  }

  /**
   * 构建对抗模式上下文
   */
  private buildDebateContext(
    session: DiscussionSession,
    blackboardManager: BlackboardManager,
    task: string,
    round: number
  ): string {
    const blackboard = blackboardManager.getState();
    const parts: string[] = [];

    parts.push(`## 当前状态`);
    parts.push(`- 轮次: ${round}/${session.config.maxRounds}`);
    parts.push(`- 议题: ${blackboard.currentTopic}`);
    parts.push(`- 共识分数: ${session.consensusScore}/100`);

    if (blackboard.verifiedFacts.length > 0) {
      parts.push(`\n## 已验证事实`);
      blackboard.verifiedFacts.slice(-5).forEach(f => parts.push(`- ✅ ${f}`));
    }

    if (blackboard.coreClashes.length > 0) {
      parts.push(`\n## 待解决争议`);
      blackboard.coreClashes.slice(-5).forEach(c => parts.push(`- ❓ ${c}`));
    }

    // 添加最近发言摘要
    const recentMessages = session.messages.filter(m => m.type === 'agent').slice(-6);
    if (recentMessages.length > 0) {
      parts.push(`\n## 最近发言`);
      recentMessages.forEach(m => {
        const content = m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content;
        parts.push(`**${m.sender}**: ${content}`);
      });
    }

    parts.push(`\n## 你的任务`);
    parts.push(task);

    return parts.join('\n');
  }

  /**
   * 生成对抗模式模板内容
   */
  private generateDebateTemplate(agentName: string, step: string, round: number): string {
    const templates: Record<string, string> = {
      'proposer': `## 正方观点 (第${round}轮)

- 核心方案: [待LLM生成]
- 关键优势: [待LLM生成]
- 行动建议: [待LLM生成]`,

      'skeptic': `## 反方质询 (第${round}轮)

### 致命问题
1. [待LLM生成]
2. [待LLM生成]

### 潜在风险
- [待LLM生成]`,

      'fact-check': `## 事实核查 (第${round}轮)

### 待核查声明
- [待LLM生成]

### 核查结果
- ✅/❌ [待LLM生成]`,

      'expert': `## 专家见解 (第${round}轮)

- [待LLM生成专业见解]`
    };

    return templates[step] || `## ${agentName} 发言 (第${round}轮)\n\n[待LLM生成]`;
  }

  /**
   * 从内容中提取争议点
   */
  private extractClashes(content: string): string[] {
    const clashes: string[] = [];
    const patterns = [
      /风险[：:]\s*(.+)/g,
      /问题[：:]\s*(.+)/g,
      /漏洞[：:]\s*(.+)/g,
      /缺陷[：:]\s*(.+)/g,
      /质疑[：:]\s*(.+)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const clash = match[1].trim().substring(0, 100);
        if (clash && !clashes.includes(clash)) {
          clashes.push(clash);
        }
      }
    }

    return clashes.slice(0, 3);
  }

  /**
   * 从内容中提取事实
   */
  private extractFacts(content: string): string[] {
    const facts: string[] = [];
    const patterns = [
      /✅\s*(.+)/g,
      /验证[：:]\s*(.+)/g,
      /确认[：:]\s*(.+)/g,
      /事实[：:]\s*(.+)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const fact = match[1].trim().substring(0, 100);
        if (fact && !facts.includes(fact)) {
          facts.push(fact);
        }
      }
    }

    return facts.slice(0, 3);
  }

  /**
   * 检查是否应该终止讨论
   */
  private shouldTerminate(session: DiscussionSession, round: number): boolean {
    const config = session.config;

    switch (config.terminationMode) {
      case 'consensus':
        // 仅依赖共识分数
        return session.consensusScore >= config.consensusThreshold;

      case 'rounds':
        // 仅依赖轮次
        return round >= config.maxRounds;

      case 'both':
      default:
        // 两者任一达到即终止
        return session.consensusScore >= config.consensusThreshold || round >= config.maxRounds;
    }
  }

  /**
   * 计算共识分数
   */
  private calculateConsensusScore(session: DiscussionSession, blackboardManager: BlackboardManager): number {
    const blackboard = blackboardManager.getState();

    // 基于黑板状态计算分数
    let score = 0;

    // 基础分：每轮增加 10 分（最多 30 分）
    score += Math.min(session.currentRound * 10, 30);

    // 事实分：每个已验证事实增加 5 分（最多 25 分）
    score += Math.min((blackboard.verifiedFacts?.length || 0) * 5, 25);

    // 争议解决分：争议越少分数越高（最多 25 分）
    const clashPenalty = (blackboard.coreClashes?.length || 0) * 5;
    score += Math.max(0, 25 - clashPenalty);

    // 见解分：每个 Agent 见解增加 5 分（最多 20 分）
    const insightsCount = Object.keys(blackboard.agentInsights || {}).length;
    score += Math.min(insightsCount * 5, 20);

    return Math.min(100, Math.max(0, score));
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
   * 生成 Agent 消息
   */
  private async generateAgentMessage(
    session: DiscussionSession,
    participant: DiscussionParticipant,
    task: string,
    round: number
  ): Promise<DiscussionMessage | null> {
    const agent = participant.agent;
    const template = participant.template;

    // 构建上下文
    const context = this.buildContext(session, task, round);

    let content: string;

    // 使用真实 LLM（通过 SubagentSessionManager）
    if (this.useRealLLM) {
      try {
        content = await this.invokeRealLLM(template, task, context, round);
      } catch (error) {
        console.error(`[DiscussionOrchestrator] Error generating message for ${agent.name}:`, error);
        content = `抱歉，我在处理时遇到了问题: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else if (this.llmInvoker) {
      // 使用外部 LLM 调用器
      try {
        content = await this.llmInvoker(context, agent.systemPrompt);
      } catch (error) {
        console.error(`[DiscussionOrchestrator] Error generating message for ${agent.name}:`, error);
        content = `抱歉，我在处理时遇到了问题: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      // 使用模板生成
      content = await this.generateFromTemplate(session, participant, task, round);
    }

    return {
      id: generateMessageId(),
      sender: agent.name,
      role: template.role,
      content,
      timestamp: Date.now(),
      type: 'agent',
      round,
      metadata: {
        templateId: template.id,
        order: participant.order
      }
    };
  }

  /**
   * 通过 SubagentSessionManager 调用真实 LLM
   */
  private async invokeRealLLM(
    template: AgentTemplate,
    task: string,
    context: string,
    round: number
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Agent ${template.name} timeout after ${this.config.messageTimeout}ms`));
        }
      }, this.config.messageTimeout);

      try {
        // 启动 Agent 会话（使用稳定的 template.id 以便复用会话）
        const actualSessionId = await this.subagentManager.startAgentSession(template, task, context);
        console.log(`[DiscussionOrchestrator] Started session ${actualSessionId} for ${template.name}`);

        // 等待会话完成
        const checkInterval = setInterval(() => {
          const session = this.subagentManager.getSession(actualSessionId);
          if (session && (session.status === 'completed' || session.status === 'error' || session.status === 'timeout')) {
            clearInterval(checkInterval);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              if (session.status === 'completed' && session.output) {
                resolve(session.output.trim());
              } else if (session.status === 'error') {
                reject(new Error(session.error || `Agent ${template.name} failed`));
              } else {
                reject(new Error(`Agent ${template.name} ${session.status}`));
              }
            }
          }
        }, 500);

        // 最多等待 timeout 时间
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            reject(new Error(`Agent ${template.name} timeout`));
          }
        }, this.config.messageTimeout);
      } catch (err) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      }
    });
  }

  /**
   * 构建上下文
   * 优化：只传递最近的发言和轮次总结，避免上下文爆炸
   */
  private buildContext(session: DiscussionSession, task: string, round: number): string {
    const parts: string[] = [];

    parts.push(`## 任务\n${task}`);
    parts.push(`## 当前轮次\n第 ${round} 轮，共 ${session.config.maxRounds} 轮`);

    // 获取所有 Agent 消息
    const agentMessages = session.messages.filter(m => m.type === 'agent');

    if (agentMessages.length > 0) {
      // 第一轮：传递所有发言（因为只有一轮）
      if (round === 1) {
        parts.push('## 已有观点');
        for (const msg of agentMessages) {
          // 限制每个观点的长度，避免上下文过长
          const truncatedContent = msg.content.length > 500
            ? msg.content.substring(0, 500) + '...'
            : msg.content;
          parts.push(`**${msg.sender}**: ${truncatedContent}`);
        }
      } else {
        // 后续轮次：只传递上一轮的总结和最近的观点
        parts.push('## 上一轮讨论总结');

        // 获取上一轮的发言
        const lastRoundMessages = agentMessages.filter(m => m.round === round - 1);

        if (lastRoundMessages.length > 0) {
          // 生成简短总结
          const summaryPoints = lastRoundMessages.map(m => {
            const content = m.content.length > 300
              ? m.content.substring(0, 300) + '...'
              : m.content;
            return `- **${m.sender}**: ${this.extractKeyPoint(content)}`;
          });
          parts.push(summaryPoints.join('\n'));
        }

        // 如果有之前的轮次总结，也传递
        if (session.roundSummaries && session.roundSummaries[round - 1]) {
          parts.push(`\n## 前序轮次要点\n${session.roundSummaries[round - 1]}`);
        }
      }
    }

    return parts.join('\n\n');
  }

  /**
   * 提取关键观点（取第一句话或第一个要点）
   */
  private extractKeyPoint(content: string): string {
    // 尝试提取第一个要点（通常以 - 或 * 开头）
    const bulletMatch = content.match(/[-*]\s*(.+)/);
    if (bulletMatch) {
      return bulletMatch[1].substring(0, 200);
    }

    // 否则取第一句话
    const firstSentence = content.split(/[。.!！\n]/)[0];
    return firstSentence.substring(0, 200);
  }

  /**
   * 总结一轮讨论
   * 生成简洁的轮次总结，用于后续轮次的上下文
   */
  private summarizeRound(session: DiscussionSession, round: number): string {
    const roundMessages = session.messages.filter(m => m.type === 'agent' && m.round === round);

    if (roundMessages.length === 0) {
      return '本轮无发言';
    }

    const summaryParts: string[] = [];

    for (const msg of roundMessages) {
      // 提取关键观点（最多 150 字）
      const keyPoint = this.extractKeyPoint(msg.content);
      summaryParts.push(`**${msg.sender}**: ${keyPoint}`);
    }

    return summaryParts.join('\n');
  }

  /**
   * 从模板生成内容（无 LLM 时）
   */
  private async generateFromTemplate(
    session: DiscussionSession,
    participant: DiscussionParticipant,
    task: string,
    round: number
  ): Promise<string> {
    const template = participant.template;
    const agentCount = session.participants.length;
    const isFirstRound = round === 1;

    // 基于角色生成模板响应
    const responses: Record<string, string[]> = {
      'Code Reviewer': [
        `- 代码结构需要关注模块解耦程度`,
        `- 建议增加单元测试覆盖率`,
        `- 注意错误处理和边界条件`
      ],
      'Architect': [
        `- 架构设计应考虑扩展性`,
        `- 模块间依赖关系需要优化`,
        `- 建议采用分层架构`
      ],
      'QA Engineer': [
        `- 需要覆盖边缘测试用例`,
        `- 建议增加集成测试`,
        `- 注意错误场景的处理`
      ],
      'Security Expert': [
        `- 需要评估数据安全风险`,
        `- 建议增加输入验证`,
        `- 注意权限控制`
      ],
      'Performance Expert': [
        `- 关注算法复杂度`,
        `- 建议优化热点代码路径`,
        `- 注意资源使用效率`
      ],
      'Product Manager': [
        `- 用户体验需要重点考虑`,
        `- 功能优先级需要明确`,
        `- 建议分阶段交付`
      ],
      'DevOps Engineer': [
        `- 部署流程需要自动化`,
        `- 监控和告警需要完善`,
        `- 注意容灾备份策略`
      ]
    };

    const roleResponses = responses[template.role] || [
      `- 从 ${template.role} 角度分析`,
      `- 需要进一步评估`,
      `- 建议深入研究`
    ];

    // 根据 Agent 数量和轮次调整响应
    const index = (round + participant.order) % roleResponses.length;
    return roleResponses[index];
  }

  /**
   * 生成结论
   */
  private async generateConclusion(session: DiscussionSession): Promise<string> {
    const agentMessages = session.messages.filter(m => m.type === 'agent');

    if (this.llmInvoker) {
      const context = `基于以下讨论，请总结出一个综合结论:\n\n${
        agentMessages.map(m => `**${m.sender}**: ${m.content}`).join('\n\n')
      }`;

      try {
        return await this.llmInvoker(context, '你是一个讨论总结助手，请综合各方观点，给出简洁的结论。');
      } catch (error) {
        console.error('[DiscussionOrchestrator] Error generating conclusion:', error);
      }
    }

    // 模板总结
    const perspectives = new Set<string>();
    for (const msg of agentMessages) {
      perspectives.add(`**${msg.sender}**: ${msg.content}`);
    }

    return `经过 ${session.currentRound} 轮讨论，${session.participants.length} 位专家达成以下共识:\n\n${
      Array.from(perspectives).join('\n\n')
    }`;
  }

  /**
   * 提取各 Agent 观点摘要
   */
  private extractPerspectives(session: DiscussionSession): Array<{
    agentName: string;
    role: string;
    summary: string;
  }> {
    const perspectives: Map<string, { role: string; messages: string[] }> = new Map();

    for (const msg of session.messages.filter(m => m.type === 'agent')) {
      const existing = perspectives.get(msg.sender);
      if (existing) {
        existing.messages.push(msg.content);
      } else {
        perspectives.set(msg.sender, {
          role: msg.role,
          messages: [msg.content]
        });
      }
    }

    return Array.from(perspectives.entries()).map(([agentName, data]) => ({
      agentName,
      role: data.role,
      summary: data.messages.join('\n')
    }));
  }

  /**
   * 提取共识点
   */
  private extractAgreements(session: DiscussionSession): string[] {
    // 简单实现：查找重复出现的关键词
    const messages = session.messages.filter(m => m.type === 'agent');
    const keywords = new Map<string, number>();

    for (const msg of messages) {
      const words = msg.content.split(/[\s,，。.!?！？]+/).filter(w => w.length > 2);
      for (const word of words) {
        keywords.set(word, (keywords.get(word) || 0) + 1);
      }
    }

    return Array.from(keywords.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  /**
   * 提取分歧点
   */
  private extractDisagreements(session: DiscussionSession): string[] {
    // 简单实现：返回空数组
    // TODO: 实现真正的分歧检测
    return [];
  }

  /**
   * 提取建议
   */
  private extractRecommendations(session: DiscussionSession): string[] {
    const recommendations: string[] = [];
    const messages = session.messages.filter(m => m.type === 'agent');

    for (const msg of messages) {
      const lines = msg.content.split('\n');
      for (const line of lines) {
        if (line.includes('建议') || line.includes('应该') || line.includes('需要')) {
          recommendations.push(line.trim());
        }
      }
    }

    return [...new Set(recommendations)].slice(0, 10);
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): DiscussionSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): DiscussionSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'running');
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * 获取可用模板列表
   */
  getAvailableTemplates(): AgentTemplate[] {
    return this.parser.getAllTemplates();
  }

  /**
   * 解析输入文本
   */
  parseInput(text: string): {
    mentions: AgentMention[];
    templates: AgentTemplate[];
    task: string;
  } {
    const mentions = this.parser.parseUnique(text);
    const templates = this.parser.parseValidTemplates(text);
    const task = this.parser.removeMentions(text);

    return { mentions, templates, task };
  }
}

/**
 * 生成会话 ID
 */
function generateSessionId(): string {
  return `disc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成消息 ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 创建讨论协调器
 */
export function createDiscussionOrchestrator(
  config?: Partial<DiscussionConfig>
): DiscussionOrchestrator {
  return new DiscussionOrchestrator(config);
}

/**
 * 全局协调器实例
 */
export const globalDiscussionOrchestrator = new DiscussionOrchestrator();
