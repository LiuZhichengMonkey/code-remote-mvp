/**
 * 工具系统 - Agent 工具调用支持
 *
 * 提供统一的工具注册和调用接口
 * 支持 web-search, web-fetch 等外部工具
 */

import { ToolCall, ToolResult } from '../types';

/**
 * 工具定义接口
 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入参数 Schema */
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  /** 工具执行函数 */
  execute: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * 工具管理器配置
 */
export interface ToolManagerConfig {
  /** 是否允许网络访问 */
  allowNetwork: boolean;
  /** 超时时间 (ms) */
  timeout: number;
  /** 最大重试次数 */
  maxRetries: number;
}

const DEFAULT_CONFIG: ToolManagerConfig = {
  allowNetwork: true,
  timeout: 30000,
  maxRetries: 2
};

/**
 * 工具管理器
 * 负责工具的注册、发现和执行
 */
export class ToolManager {
  private tools: Map<string, ToolDefinition> = new Map();
  private config: ToolManagerConfig;
  private callHistory: ToolResult[] = [];

  constructor(config?: Partial<ToolManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerBuiltinTools();
  }

  /**
   * 注册内置工具
   */
  private registerBuiltinTools(): void {
    // Web Search 工具
    this.register({
      name: 'web-search',
      description: '搜索互联网获取信息。当需要查询实时信息、事实数据或验证声明时使用。',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询词'
          },
          numResults: {
            type: 'number',
            description: '返回结果数量，默认 5'
          }
        },
        required: ['query']
      },
      execute: async (input) => this.executeWebSearch(input.query as string, input.numResults as number)
    });

    // Web Fetch 工具
    this.register({
      name: 'web-fetch',
      description: '获取网页内容。用于深入阅读搜索结果中的具体页面。',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要获取的网页 URL'
          },
          selector: {
            type: 'string',
            description: '可选的 CSS 选择器，提取特定内容'
          }
        },
        required: ['url']
      },
      execute: async (input) => this.executeWebFetch(input.url as string, input.selector as string)
    });

    // Calculator 工具
    this.register({
      name: 'calculator',
      description: '执行数学计算，验证数字和统计数据。',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，如 "2 + 3 * 4"'
          }
        },
        required: ['expression']
      },
      execute: async (input) => this.executeCalculator(input.expression as string)
    });

    // Date/Time 工具
    this.register({
      name: 'datetime',
      description: '获取当前日期时间或计算日期差值。',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '操作类型: now, diff, format',
            enum: ['now', 'diff', 'format']
          },
          date1: {
            type: 'string',
            description: '第一个日期 (ISO 格式)'
          },
          date2: {
            type: 'string',
            description: '第二个日期 (用于 diff 操作)'
          }
        },
        required: ['action']
      },
      execute: async (input) => this.executeDateTime(input)
    });
  }

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取工具定义
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具 Schema (供 LLM 使用)
   */
  getToolSchemas(): Array<{
    name: string;
    description: string;
    input_schema: ToolDefinition['inputSchema'];
  }> {
    return this.getAllTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }

  /**
   * 执行工具调用
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.toolName);
    const timestamp = Date.now();

    if (!tool) {
      const result: ToolResult = {
        toolName: toolCall.toolName,
        input: toolCall.arguments,
        output: `Error: Tool "${toolCall.toolName}" not found`,
        success: false,
        timestamp
      };
      this.callHistory.push(result);
      return result;
    }

    // 验证参数
    const validation = this.validateInput(tool, toolCall.arguments);
    if (!validation.valid) {
      const result: ToolResult = {
        toolName: toolCall.toolName,
        input: toolCall.arguments,
        output: `Error: Invalid input - ${validation.error}`,
        success: false,
        timestamp
      };
      this.callHistory.push(result);
      return result;
    }

    // 执行工具
    try {
      const output = await this.executeWithTimeout(tool, toolCall.arguments);
      const result: ToolResult = {
        toolName: toolCall.toolName,
        input: toolCall.arguments,
        output,
        success: true,
        timestamp
      };
      this.callHistory.push(result);
      return result;
    } catch (error) {
      const result: ToolResult = {
        toolName: toolCall.toolName,
        input: toolCall.arguments,
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        timestamp
      };
      this.callHistory.push(result);
      return result;
    }
  }

  /**
   * 带超时执行
   */
  private async executeWithTimeout(
    tool: ToolDefinition,
    input: Record<string, unknown>
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      tool.execute(input)
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 验证输入参数
   */
  private validateInput(
    tool: ToolDefinition,
    input: Record<string, unknown>
  ): { valid: boolean; error?: string } {
    const { required, properties } = tool.inputSchema;

    // 检查必需参数
    if (required) {
      for (const key of required) {
        if (input[key] === undefined) {
          return { valid: false, error: `Missing required parameter: ${key}` };
        }
      }
    }

    // 检查参数类型
    for (const [key, value] of Object.entries(input)) {
      const prop = properties[key];
      if (prop) {
        const actualType = typeof value;
        if (actualType !== prop.type && !(actualType === 'number' && prop.type === 'integer')) {
          return { valid: false, error: `Parameter ${key} should be ${prop.type}, got ${actualType}` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * 获取调用历史
   */
  getCallHistory(): ToolResult[] {
    return [...this.callHistory];
  }

  /**
   * 清除调用历史
   */
  clearHistory(): void {
    this.callHistory = [];
  }

  // ========== 内置工具实现 ==========

  /**
   * 执行 Web 搜索
   */
  private async executeWebSearch(query: string, numResults?: number): Promise<string> {
    if (!this.config.allowNetwork) {
      return 'Error: Network access is disabled';
    }

    try {
      // 使用 DuckDuckGo Instant Answer API (无需 API Key)
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      const response = await fetch(url);

      if (!response.ok) {
        return `Error: Search failed with status ${response.status}`;
      }

      const data = await response.json() as any;

      // 解析结果
      const results: string[] = [];

      if (data.Abstract) {
        results.push(`摘要: ${data.Abstract}`);
      }

      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const topics = data.RelatedTopics.slice(0, numResults || 5);
        for (const topic of topics) {
          if (topic.Text) {
            results.push(`- ${topic.Text}`);
          }
        }
      }

      if (results.length === 0) {
        return `未找到关于 "${query}" 的相关信息。建议使用更精确的搜索词。`;
      }

      return `## 搜索结果: ${query}\n\n${results.join('\n')}`;
    } catch (error) {
      return `Error: Search failed - ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * 执行网页获取
   */
  private async executeWebFetch(url: string, selector?: string): Promise<string> {
    if (!this.config.allowNetwork) {
      return 'Error: Network access is disabled';
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        return `Error: Fetch failed with status ${response.status}`;
      }

      const html = await response.text();

      // 简单提取文本内容 (移除 HTML 标签)
      let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // 限制长度
      if (content.length > 5000) {
        content = content.substring(0, 5000) + '...(内容已截断)';
      }

      return `## 网页内容\n\nURL: ${url}\n\n${content}`;
    } catch (error) {
      return `Error: Fetch failed - ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * 执行计算
   */
  private async executeCalculator(expression: string): Promise<string> {
    try {
      // 安全的数学表达式计算
      // 只允许数字、运算符、括号和数学函数
      const safeExpr = expression.replace(/[^0-9+\-*/().%\s^]/g, '');

      // 简单计算
      const result = Function(`"use strict"; return (${safeExpr})`)();

      if (typeof result !== 'number' || !isFinite(result)) {
        return `Error: Invalid calculation result`;
      }

      return `${expression} = ${result}`;
    } catch (error) {
      return `Error: Calculation failed - ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * 执行日期时间操作
   */
  private async executeDateTime(input: Record<string, unknown>): Promise<string> {
    const action = input.action as string;

    switch (action) {
      case 'now':
        return `当前时间: ${new Date().toISOString()}`;

      case 'diff': {
        const date1 = new Date(input.date1 as string);
        const date2 = input.date2 ? new Date(input.date2 as string) : new Date();

        if (isNaN(date1.getTime())) {
          return 'Error: Invalid date format';
        }

        const diffMs = Math.abs(date2.getTime() - date1.getTime());
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        return `时间差: ${diffDays} 天 ${diffHours} 小时`;
      }

      case 'format': {
        const date = input.date1 ? new Date(input.date1 as string) : new Date();

        if (isNaN(date.getTime())) {
          return 'Error: Invalid date format';
        }

        return `格式化日期: ${date.toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long'
        })}`;
      }

      default:
        return `Error: Unknown action: ${action}`;
    }
  }
}

/**
 * 全局工具管理器实例
 */
export const globalToolManager = new ToolManager();

/**
 * 创建工具管理器
 */
export function createToolManager(config?: Partial<ToolManagerConfig>): ToolManager {
  return new ToolManager(config);
}
