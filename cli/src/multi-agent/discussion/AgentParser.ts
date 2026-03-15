/**
 * Agent 解析器 - 解析 @语法
 *
 * 支持格式:
 * - @agentName 单个提及
 * - @agent1 @agent2 多个提及
 * - @代码审查 @架构师 中文提及
 */

import { AgentMention, AgentTemplate } from './types';

/**
 * Agent 解析器
 */
export class AgentParser {
  private templates: Map<string, AgentTemplate> = new Map();
  private aliases: Map<string, string> = new Map();

  /**
   * 注册 Agent 模板
   */
  registerTemplate(template: AgentTemplate): void {
    this.templates.set(template.id, template);

    // 注册名称映射（支持空格分隔的中文名）
    const normalizedName = this.normalizeName(template.name);
    this.aliases.set(normalizedName, template.id);

    // 注册角色别名
    if (template.role) {
      const normalizedRole = this.normalizeName(template.role);
      this.aliases.set(normalizedRole, template.id);
    }
  }

  /**
   * 批量注册模板
   */
  registerTemplates(templates: AgentTemplate[]): void {
    for (const template of templates) {
      this.registerTemplate(template);
    }
  }

  /**
   * 获取模板
   */
  getTemplate(idOrName: string): AgentTemplate | undefined {
    // 先尝试 ID 查找
    const template = this.templates.get(idOrName);
    if (template) return template;

    // 再尝试别名查找
    const normalized = this.normalizeName(idOrName);
    const id = this.aliases.get(normalized);
    return id ? this.templates.get(id) : undefined;
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): AgentTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 解析文本中的 @提及
   *
   * @param text 输入文本
   * @returns 提及列表
   */
  parse(text: string): AgentMention[] {
    const mentions: AgentMention[] = [];
    const regex = /@([^\s@]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      const normalized = this.normalizeName(name);
      const template = this.getTemplate(name);

      mentions.push({
        name,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        valid: template !== undefined
      });
    }

    return mentions;
  }

  /**
   * 解析并去重
   */
  parseUnique(text: string): AgentMention[] {
    const mentions = this.parse(text);
    const seen = new Set<string>();
    return mentions.filter(m => {
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });
  }

  /**
   * 解析并获取有效的模板列表
   */
  parseValidTemplates(text: string): AgentTemplate[] {
    const mentions = this.parseUnique(text);
    const templates: AgentTemplate[] = [];

    for (const mention of mentions) {
      if (mention.valid) {
        const template = this.getTemplate(mention.name);
        if (template) {
          templates.push(template);
        }
      }
    }

    return templates;
  }

  /**
   * 检查文本是否包含有效的 @提及
   */
  hasValidMention(text: string): boolean {
    const mentions = this.parse(text);
    return mentions.some(m => m.valid);
  }

  /**
   * 统计提及数量
   */
  countMentions(text: string): number {
    return this.parseUnique(text).length;
  }

  /**
   * 移除 @提及
   */
  removeMentions(text: string): string {
    return text.replace(/@[^\s@]+/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * 替换 @提及
   */
  replaceMentions(text: string, replacement: (mention: AgentMention) => string): string {
    const mentions = this.parse(text);
    let result = text;
    let offset = 0;

    for (const mention of mentions) {
      const replaceText = replacement(mention);
      result = result.slice(0, mention.startIndex + offset) +
               replaceText +
               result.slice(mention.endIndex + offset);
      offset += replaceText.length - (mention.endIndex - mention.startIndex);
    }

    return result;
  }

  /**
   * 格式化提及列表（用于显示）
   */
  formatMentions(text: string): string {
    return this.replaceMentions(text, (mention) => {
      if (mention.valid) {
        return `**@${mention.name}**`;
      }
      return `*@${mention.name}*`;
    });
  }

  /**
   * 标准化名称（用于匹配）
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[-_\s]+/g, '')
      .trim();
  }

  /**
   * 清除所有模板
   */
  clear(): void {
    this.templates.clear();
    this.aliases.clear();
  }

  /**
   * 获取模板数量
   */
  get size(): number {
    return this.templates.size;
  }
}

/**
 * 预定义的 Agent 模板
 */
export const BUILTIN_TEMPLATES: AgentTemplate[] = [
  {
    id: 'code-reviewer',
    name: '代码审查',
    role: 'Code Reviewer',
    systemPrompt: `你是一位专业的代码审查专家。你的职责是:
- 识别代码中的潜在问题和 bug
- 检查代码风格和最佳实践
- 评估代码的可维护性和可读性
- 提出具体的改进建议

请用简洁、专业的语言发表你的观点。每个论点控制在 50 字以内。`,
    tools: ['glob', 'grep', 'read'],
    capabilities: [
      { name: 'code-review', description: '审查代码质量', inputSchema: { type: 'object', properties: { code: { type: 'string' } } } }
    ],
    avatar: { icon: '🔍', color: '#4CAF50' }
  },
  {
    id: 'architect',
    name: '架构师',
    role: 'Architect',
    systemPrompt: `你是一位资深软件架构师。你的职责是:
- 分析系统架构和设计模式
- 评估技术方案的可行性
- 识别架构层面的风险
- 提出架构优化建议

请用简洁、专业的语言发表你的观点。每个论点控制在 50 字以内。`,
    tools: ['glob', 'grep', 'read'],
    capabilities: [
      { name: 'architecture-analysis', description: '分析系统架构', inputSchema: { type: 'object', properties: { scope: { type: 'string' } } } }
    ],
    avatar: { icon: '🏗️', color: '#2196F3' }
  },
  {
    id: 'tester',
    name: '测试专家',
    role: 'QA Engineer',
    systemPrompt: `你是一位测试工程专家。你的职责是:
- 分析测试覆盖率和测试质量
- 识别边缘情况和潜在 bug
- 评估错误处理和边界条件
- 提出测试改进建议

请用简洁、专业的语言发表你的观点。每个论点控制在 50 字以内。`,
    tools: ['glob', 'grep', 'read'],
    capabilities: [
      { name: 'test-analysis', description: '分析测试覆盖', inputSchema: { type: 'object', properties: { target: { type: 'string' } } } }
    ],
    avatar: { icon: '🧪', color: '#FF9800' }
  },
  {
    id: 'security',
    name: '安全专家',
    role: 'Security Expert',
    systemPrompt: `你是一位安全工程专家。你的职责是:
- 识别安全漏洞和风险
- 检查认证和授权机制
- 评估数据保护和隐私
- 提出安全加固建议

请用简洁、专业的语言发表你的观点。每个论点控制在 50 字以内。`,
    tools: ['glob', 'grep', 'read'],
    capabilities: [
      { name: 'security-audit', description: '安全审计', inputSchema: { type: 'object', properties: { scope: { type: 'string' } } } }
    ],
    avatar: { icon: '🔒', color: '#F44336' }
  },
  {
    id: 'performance',
    name: '性能专家',
    role: 'Performance Expert',
    systemPrompt: `你是一位性能优化专家。你的职责是:
- 分析性能瓶颈
- 评估算法和复杂度
- 检查资源使用效率
- 提出性能优化建议

请用简洁、专业的语言发表你的观点。每个论点控制在 50 字以内。`,
    tools: ['glob', 'grep', 'read'],
    capabilities: [
      { name: 'performance-analysis', description: '性能分析', inputSchema: { type: 'object', properties: { target: { type: 'string' } } } }
    ],
    avatar: { icon: '⚡', color: '#9C27B0' }
  },
  {
    id: 'product',
    name: '产品经理',
    role: 'Product Manager',
    systemPrompt: `你是一位产品经理。你的职责是:
- 分析功能需求和用户体验
- 评估功能的商业价值
- 识别潜在的用户痛点
- 提出产品优化建议

请用简洁、专业的语言发表你的观点。每个论点控制在 50 字以内。`,
    capabilities: [
      { name: 'product-analysis', description: '产品分析', inputSchema: { type: 'object', properties: { feature: { type: 'string' } } } }
    ],
    avatar: { icon: '📊', color: '#00BCD4' }
  },
  {
    id: 'devops',
    name: '运维专家',
    role: 'DevOps Engineer',
    systemPrompt: `你是一位运维工程专家。你的职责是:
- 分析部署和运维需求
- 评估系统的可观测性
- 检查容灾和备份策略
- 提出运维优化建议

请用简洁、专业的语言发表你的观点。每个论点控制在 50 字以内。`,
    capabilities: [
      { name: 'devops-analysis', description: '运维分析', inputSchema: { type: 'object', properties: { scope: { type: 'string' } } } }
    ],
    avatar: { icon: '🚀', color: '#607D8B' }
  }
];

/**
 * 全局解析器实例
 */
export const globalAgentParser = new AgentParser();

// 注册内置模板
globalAgentParser.registerTemplates(BUILTIN_TEMPLATES);
