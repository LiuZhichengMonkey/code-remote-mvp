/**
 * 工具注册表 - 管理和执行工具
 *
 * 提供统一的工具注册、发现和执行接口
 */

import { Tool, ToolDefinition, ToolResult, ToolRegistryConfig } from './types';

// 重新导出类型供外部使用
export { Tool, ToolDefinition, ToolResult, ToolRegistryConfig, ToolParameterSchema } from './types';

/**
 * 工具注册表
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private config: ToolRegistryConfig;

  constructor(config?: ToolRegistryConfig) {
    this.config = {
      allowOverride: false,
      timeout: 30000,
      ...config
    };
  }

  /**
   * 注册工具
   * @param tool 工具实例
   * @throws 如果工具已存在且不允许覆盖
   */
  register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name) && !this.config.allowOverride) {
      throw new Error(`Tool "${name}" already registered. Set allowOverride to true to replace.`);
    }
    this.tools.set(name, tool);
  }

  /**
   * 批量注册工具
   * @param tools 工具列表
   */
  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 注销工具
   * @param name 工具名称
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 获取工具
   * @param name 工具名称
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 检查工具是否存在
   * @param name 工具名称
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具定义
   */
  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * 按标签查找工具
   * @param tags 标签列表
   */
  findByTags(tags: string[]): ToolDefinition[] {
    return this.getAllDefinitions().filter(def =>
      def.tags?.some(tag => tags.includes(tag))
    );
  }

  /**
   * 执行工具
   * @param name 工具名称
   * @param input 输入参数
   * @returns 执行结果
   */
  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        toolName: name,
        input,
        output: '',
        success: false,
        error: `Tool "${name}" not found`,
        timestamp: Date.now()
      };
    }

    // 验证参数
    if (tool.validate) {
      const validation = tool.validate(input);
      if (!validation.valid) {
        return {
          toolName: name,
          input,
          output: '',
          success: false,
          error: `Validation failed: ${validation.errors?.join(', ')}`,
          timestamp: Date.now()
        };
      }
    }

    // 执行工具（带超时）
    try {
      const result = await this.executeWithTimeout(
        tool.execute(input),
        this.config.timeout!
      );
      return result;
    } catch (error) {
      return {
        toolName: name,
        input,
        output: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    }
  }

  /**
   * 带超时执行
   */
  private async executeWithTimeout(
    promise: Promise<ToolResult>,
    timeout: number
  ): Promise<ToolResult> {
    return Promise.race([
      promise,
      new Promise<ToolResult>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
      )
    ]);
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * 全局工具注册表实例
 */
export const globalToolRegistry = new ToolRegistry();

/**
 * 创建工具的辅助函数
 */
export function createTool(
  definition: ToolDefinition,
  executeFn: (input: Record<string, unknown>) => Promise<ToolResult>
): Tool {
  return {
    definition,
    execute: executeFn,
    validate: (input) => {
      const errors: string[] = [];

      // 检查必需参数
      if (definition.required) {
        for (const param of definition.required) {
          if (!(param in input) || input[param] === undefined) {
            errors.push(`Missing required parameter: ${param}`);
          }
        }
      }

      // 基本类型检查
      for (const [key, value] of Object.entries(input)) {
        const schema = definition.parameters[key];
        if (schema) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== schema.type && schema.type !== 'object') {
            errors.push(`Parameter "${key}" should be ${schema.type}, got ${actualType}`);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
      };
    }
  };
}
