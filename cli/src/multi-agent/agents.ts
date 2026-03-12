/**
 * Agent 角色定义
 *
 * 定义多智能体系统中的各种角色：
 * - Moderator: 裁判与主持人
 * - Proposer: 建构者/正方
 * - Skeptic: 破坏者/反方
 * - FactChecker: 查证员
 * - Expert: 动态专家
 */

import {
  AgentRole,
  AgentConfig,
  AgentSpeech,
  GlobalBlackboard,
  DebateStep,
  ToolResult
} from './types';
import { loadPrompt } from './prompt-loader';

/**
 * Agent 基类
 */
export abstract class BaseAgent {
  name: string;
  role: AgentRole;
  description: string;
  systemPrompt: string;
  tools: string[];

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.role = config.role;
    this.description = config.description;
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools || [];
  }

  /**
   * 生成发言
   */
  abstract generateSpeech(
    blackboard: GlobalBlackboard,
    context?: string
  ): Promise<string>;

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

  async generateSpeech(
    blackboard: GlobalBlackboard,
    context?: string
  ): Promise<string> {
    // Moderator 的发言是状态更新和打分
    const score = this.calculateScore(blackboard);

    return `## 结算报告（Round ${blackboard.round}）

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
  }

  async generateSpeech(
    blackboard: GlobalBlackboard,
    context?: string
  ): Promise<string> {
    // 这里应该调用 LLM 生成发言
    // 当前返回模板，实际使用时需要接入 LLM
    return `## 建构方观点

基于当前议题 "${blackboard.currentTopic}"：

- 核心方案: [需要 LLM 生成]
- 关键优势: [需要 LLM 生成]
- 行动建议: [需要 LLM 生成]`;
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
  }

  async generateSpeech(
    blackboard: GlobalBlackboard,
    context?: string
  ): Promise<string> {
    return `## 反方质询

针对当前议题 "${blackboard.currentTopic}"：

### 致命问题
1. [需要 LLM 生成]
2. [需要 LLM 生成]

### 潜在风险
- [需要 LLM 生成]
- [需要 LLM 生成]`;
  }
}

/**
 * Agent D: 查证员 (The Fact-Checker)
 *
 * 职责: 不参与观点输出，仅核查事实争议
 * 动作: 调用外部工具，得出客观结论
 */
export class FactCheckerAgent extends BaseAgent {
  constructor() {
    super({
      name: 'FactChecker',
      role: 'fact-checker',
      description: '查证员，核查事实争议',
      systemPrompt: loadPrompt('fact-checker')
    });
  }

  async generateSpeech(
    blackboard: GlobalBlackboard,
    context?: string
  ): Promise<string> {
    // FactChecker 需要判断是否有事实争议
    return `## 事实核查

当前无需核查的事实争议。`;
  }

  /**
   * 查证事实
   */
  async checkFact(claim: string): Promise<ToolResult | null> {
    // 这里应该调用工具进行事实核查
    // 当前返回 null，实际使用时需要接入搜索等工具
    return null;
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
  }

  async generateSpeech(
    blackboard: GlobalBlackboard,
    context?: string
  ): Promise<string> {
    return `## ${this.name} 视点

基于 ${this.customBackground} 的专业视角：

- [需要 LLM 生成专业见解]
- [需要 LLM 生成专业见解]`;
  }
}

/**
 * Agent 工厂
 */
export class AgentFactory {
  private static defaultAgents = {
    moderator: new ModeratorAgent(),
    proposer: new ProposerAgent(),
    skeptic: new SkepticAgent(),
    factChecker: new FactCheckerAgent()
  };

  /**
   * 获取默认 Agent
   */
  static getAgent(role: AgentRole): BaseAgent {
    switch (role) {
      case 'moderator':
        return this.defaultAgents.moderator;
      case 'proposer':
        return this.defaultAgents.proposer;
      case 'skeptic':
        return this.defaultAgents.skeptic;
      case 'fact-checker':
        return this.defaultAgents.factChecker;
      default:
        throw new Error(`Unknown agent role: ${role}`);
    }
  }

  /**
   * 创建动态专家
   */
  static createExpert(name: string, background: string): ExpertAgent {
    return new ExpertAgent(name, background);
  }
}
