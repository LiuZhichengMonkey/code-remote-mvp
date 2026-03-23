/**
 * Agent 角色定义
 *
 * 定义多智能体系统中的各种角色：
 * - Moderator: 裁判与主持人
 * - Proposer: 建构者/正方
 * - Skeptic: 破坏者/反方
 * - FactChecker: 查证员
 * - Expert: 动态专家
 *
 * v2.0: 实现 UnifiedAgent 统一接口
 */

import {
  AgentRole,
  AgentConfig,
  AgentSpeech,
  GlobalBlackboard,
  DebateStep,
  ToolResult,
  UnifiedAgent,
  AgentContext,
  AgentResponse,
  AgentCapability,
  DebateRole,
  ToolCall
} from './types';
import { loadPrompt } from './prompt-loader';
import { ToolManager, globalToolManager } from './tools';

/**
 * Agent 基类
 * 实现 UnifiedAgent 统一接口
 */
export abstract class BaseAgent implements UnifiedAgent {
  id: string;
  role: AgentRole | 'custom';
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  capabilities: AgentCapability[] = [];

  constructor(config: AgentConfig & { id?: string }) {
    this.id = config.id || `${config.role}_${Date.now()}`;
    this.role = config.role;
    this.name = config.name;
    this.description = config.description;
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools || [];
  }

  /**
   * 执行 Agent（子类实现）
   */
  abstract invoke(context: AgentContext): Promise<AgentResponse>;

  /**
   * 生成发言（兼容旧接口）
   * @deprecated 使用 invoke() 替代
   */
  async generateSpeech(
    blackboard: GlobalBlackboard,
    context?: string
  ): Promise<string> {
    const response = await this.invoke({
      blackboard,
      history: [],
      currentStep: 'proposer',
      round: blackboard.round,
      customContext: context ? { additionalContext: context } : undefined
    });
    return response.content;
  }

  /**
   * 格式化发言（确保精简）
   */
  protected formatSpeech(content: string, maxLength: number = 500): string {
    // 移除废话
    const cleaned = this.removeFluff(content);

    // 限制长度
    if (cleaned.length > maxLength) {
      return cleaned.substring(0, maxLength - 3) + '...';
    }

    return cleaned;
  }

  /**
   * 移除废话
   */
  private removeFluff(content: string): string {
    const fluffPatterns = [
      /作为.*我认为/g,
      /我觉得/g,
      /在我看来/g,
      /我个人认为/g,
      /我想说的是/g
    ];

    let result = content;
    for (const pattern of fluffPatterns) {
      result = result.replace(pattern, '');
    }

    return result.replace(/\s+/g, ' ').trim();
  }

  /**
   * 激活钩子（默认空实现）
   */
  async onActivate?(): Promise<void>;

  /**
   * 停用钩子（默认空实现）
   */
  async onDeactivate?(): Promise<void>;
}

/**
 * Agent A: 裁判与主持人 (The Moderator & Judge)
 *
 * 职责:
 * - 掌控流程
 * - 强制执行防爆机制
 * - 更新全局黑板
 * - 给讨论深度和方案完善度打分
 */
export class ModeratorAgent extends BaseAgent {
  constructor() {
    super({
      name: 'Moderator',
      role: 'moderator',
      description: '裁判与主持人，负责流程控制和评分',
      systemPrompt: loadPrompt('moderator')
    });
  }

  async invoke(context: AgentContext): Promise<AgentResponse> {
    const blackboard = context.blackboard;
    const score = this.calculateScore(blackboard);

    const content = `## 结算报告（Round ${blackboard.round}）

### 当前状态
- 核心议题: ${blackboard.currentTopic}
- 已验证事实: ${blackboard.verifiedFacts.length} 条
- 待解决争议: ${blackboard.coreClashes.length} 个

### 评分
- 逻辑严密性: ${score.logic}/30
- 漏洞修复: ${score.fixes}/30
- 实际价值: ${score.value}/40
- **总分: ${score.total}/100**

${score.total >= 85 ? '✅ 达到终止条件，准备输出最终报告' : '⏳ 继续下一轮讨论'}`;

    return {
      content,
      metadata: { score }
    };
  }

  /**
   * 计算分数
   */
  private calculateScore(blackboard: GlobalBlackboard): {
    logic: number;
    fixes: number;
    value: number;
    total: number;
  } {
    // 基于黑板状态计算分数
    const logic = Math.min(30, 10 + blackboard.verifiedFacts.length * 5);
    const fixes = Math.max(0, 30 - blackboard.coreClashes.length * 10);
    const value = Math.min(40, Object.keys(blackboard.agentInsights).length * 10);

    return {
      logic,
      fixes,
      value,
      total: logic + fixes + value
    };
  }

  /**
   * 生成最终报告
   */
  generateFinalReport(
    blackboard: GlobalBlackboard,
    speeches: AgentSpeech[]
  ): string {
    return `# 最终分析决议报告

## 核心结论
${blackboard.currentTopic}

## 多维分析视角
${Object.entries(blackboard.agentInsights)
  .filter(([role]) => role === 'proposer' || role === 'expert')
  .map(([role, insight]) => `- **${role}**: ${insight}`)
  .join('\n')}

## 潜在风险提示
${blackboard.coreClashes.map(clash => `- ${clash}`).join('\n') || '无'}

## 事实依据
${blackboard.verifiedFacts.map(fact => `- ${fact}`).join('\n') || '无'}

---
总轮次: ${blackboard.round} | 最终得分: ${blackboard.consensusScore}/100`;
  }
}

/**
 * Agent B: 建构者/正方 (The Proposer)
 *
 * 职责: 提出建设性、创新性、大胆的解决方案
 * 性格: 目标导向，负责"破局"
 */
export class ProposerAgent extends BaseAgent {
  constructor() {
    super({
      name: 'Proposer',
      role: 'proposer',
      description: '建构者/正方，提出建设性方案',
      systemPrompt: loadPrompt('proposer')
    });

    // 注册能力
    this.capabilities = [
      {
        name: 'propose',
        description: '提出建设性解决方案',
        inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
        tags: ['debate', 'solution', 'proposal']
      }
    ];
  }

  async invoke(context: AgentContext): Promise<AgentResponse> {
    // 这里应该调用 LLM 生成发言
    // 当前返回模板，实际使用时需要接入 LLM
    const content = `## 建构方观点

基于当前议题 "${context.blackboard.currentTopic}"：

- 核心方案: [需要 LLM 生成]
- 关键优势: [需要 LLM 生成]
- 行动建议: [需要 LLM 生成]`;

    return { content };
  }
}

/**
 * Agent C: 破坏者/反方 (The Skeptic)
 *
 * 职责: 找逻辑漏洞、潜在风险、极端边缘情况
 * 性格: 极度理性、吹毛求疵、悲观主义
 */
export class SkepticAgent extends BaseAgent {
  constructor() {
    super({
      name: 'Skeptic',
      role: 'skeptic',
      description: '破坏者/反方，找漏洞和风险',
      systemPrompt: loadPrompt('skeptic')
    });

    this.capabilities = [
      {
        name: 'critique',
        description: '发现逻辑漏洞和潜在风险',
        inputSchema: { type: 'object', properties: { proposal: { type: 'string' } } },
        tags: ['debate', 'critique', 'risk-analysis']
      }
    ];
  }

  async invoke(context: AgentContext): Promise<AgentResponse> {
    const content = `## 反方质询

针对当前议题 "${context.blackboard.currentTopic}"：

### 致命问题
1. [需要 LLM 生成]
2. [需要 LLM 生成]

### 潜在风险
- [需要 LLM 生成]
- [需要 LLM 生成]`;

    return { content };
  }
}

/**
 * Agent D: 查证员 (The Fact-Checker)
 *
 * 职责: 不参与观点输出，仅核查事实争议
 * 动作: 调用外部工具，得出客观结论
 */
export class FactCheckerAgent extends BaseAgent {
  private toolManager: ToolManager;
  private factCheckTools: string[] = ['web-search', 'web-fetch'];

  constructor(toolManager?: ToolManager) {
    super({
      name: 'FactChecker',
      role: 'fact-checker',
      description: '查证员，核查事实争议',
      systemPrompt: loadPrompt('fact-checker'),
      tools: ['web-search', 'web-fetch']
    });

    this.toolManager = toolManager || globalToolManager;

    this.capabilities = [
      {
        name: 'fact-check',
        description: '核查事实真伪',
        inputSchema: {
          type: 'object',
          properties: {
            claim: { type: 'string', description: '待核查的声明' }
          }
        },
        tags: ['verification', 'search', 'fact-check']
      }
    ];
  }

  async invoke(context: AgentContext): Promise<AgentResponse> {
    const blackboard = context.blackboard;
    const hasDisputes = blackboard.coreClashes.length > 0;

    if (!hasDisputes) {
      return {
        content: `## 事实核查\n\n当前无需核查的事实争议。`,
        metadata: { hasDisputes: false }
      };
    }

    // 提取需要核查的事实
    const claimsToVerify = this.extractClaims(blackboard.coreClashes);
    const toolCalls: ToolCall[] = [];
    const results: string[] = [];

    // 执行核查
    for (const claim of claimsToVerify.slice(0, 3)) { // 最多核查 3 个
      const result = await this.checkFact(claim);
      if (result) {
        toolCalls.push({
          toolName: result.toolName,
          arguments: result.input
        });
        results.push(`### 核查: ${claim}\n${result.output}`);
      }
    }

    return {
      content: `## 事实核查\n\n${results.join('\n\n') || '已完成核查'}`,
      toolCalls,
      metadata: {
        hasDisputes: true,
        verifiedCount: results.filter(r => r.includes('✅')).length,
        disputedCount: results.filter(r => r.includes('❌')).length
      }
    };
  }

  /**
   * 从争议中提取需要核查的声明
   */
  private extractClaims(clashes: string[]): string[] {
    const claims: string[] = [];

    for (const clash of clashes) {
      // 简单提取：将争议点作为待核查声明
      // TODO: 使用 LLM 更智能地提取
      claims.push(clash);
    }

    return claims;
  }

  /**
   * 查证事实（调用工具）
   */
  async checkFact(claim: string): Promise<ToolResult | null> {
    try {
      // 使用 web-search 工具核查
      const result = await this.toolManager.execute({
        toolName: 'web-search',
        arguments: {
          query: `事实核查: ${claim}`,
          numResults: 3
        }
      });

      return result;
    } catch (error) {
      console.error(`[FactChecker] Error checking fact: ${claim}`, error);
      return null;
    }
  }

  /**
   * 获取可用工具列表
   */
  getAvailableTools(): string[] {
    return this.factCheckTools;
  }
}

/**
 * Agent X: 动态专家 (Custom Dynamic Agent)
 *
 * 职责: 完全继承用户赋予的专业背景和性格设定
 * 补充正反方忽略的盲区
 */
export class ExpertAgent extends BaseAgent {
  private customBackground: string;

  constructor(name: string, background: string) {
    // 加载专家模板并替换变量
    const template = loadPrompt('expert');
    const systemPrompt = template
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{background\}\}/g, background);

    super({
      name,
      role: 'expert',
      description: `动态专家: ${background}`,
      systemPrompt
    });

    this.customBackground = background;

    // 从背景中提取能力标签
    this.capabilities = [
      {
        name: 'expert-insight',
        description: `基于 ${background} 提供专业见解`,
        inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
        tags: ['expert', 'domain-knowledge', background.substring(0, 20)]
      }
    ];
  }

  async invoke(context: AgentContext): Promise<AgentResponse> {
    const content = `## ${this.name} 视点

基于 ${this.customBackground} 的专业视角：

- [需要 LLM 生成专业见解]
- [需要 LLM 生成专业见解]`;

    return {
      content,
      metadata: {
        background: this.customBackground
      }
    };
  }
}

/**
 * Agent 工厂
 * 支持创建和管理 Agent 实例
 */
export class AgentFactory {
  private static defaultAgents: Map<DebateRole, BaseAgent> = new Map();

  /**
   * 初始化默认 Agent
   */
  private static initDefaultAgents(): void {
    if (this.defaultAgents.size === 0) {
      this.defaultAgents.set('moderator', new ModeratorAgent());
      this.defaultAgents.set('proposer', new ProposerAgent());
      this.defaultAgents.set('skeptic', new SkepticAgent());
      this.defaultAgents.set('fact-checker', new FactCheckerAgent());
    }
  }

  /**
   * 获取默认 Agent
   */
  static getAgent(role: DebateRole): BaseAgent {
    this.initDefaultAgents();
    const agent = this.defaultAgents.get(role);
    if (!agent) {
      throw new Error(`Unknown agent role: ${role}`);
    }
    return agent;
  }

  /**
   * 创建动态专家
   */
  static createExpert(name: string, background: string): ExpertAgent {
    return new ExpertAgent(name, background);
  }

  /**
   * 从配置创建 Agent
   */
  static createFromConfig(config: AgentConfig & { id?: string }): BaseAgent {
    // 检查是否是默认角色
    if (config.role !== 'expert' && config.role !== 'custom') {
      return this.getAgent(config.role as DebateRole);
    }

    // 创建自定义 Agent
    if (config.role === 'expert') {
      return new ExpertAgent(config.name, config.description);
    }

    // 创建通用自定义 Agent
    throw new Error(`Cannot create agent for role: ${config.role}`);
  }

  /**
   * 获取所有默认 Agent
   */
  static getAllDefaultAgents(): Map<DebateRole, BaseAgent> {
    this.initDefaultAgents();
    return new Map(this.defaultAgents);
  }

  /**
   * 注册自定义 Agent
   */
  static registerAgent(role: DebateRole, agent: BaseAgent): void {
    this.defaultAgents.set(role, agent);
  }
}
