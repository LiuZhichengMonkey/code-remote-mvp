/**
 * 工具系统 - 类型定义
 *
 * 定义工具的统一接口，支持 Agent 调用外部工具
 */

/**
 * 工具参数 Schema (JSON Schema 子集)
 */
export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 Schema */
  parameters: Record<string, ToolParameterSchema>;
  /** 必需参数列表 */
  required?: string[];
  /** 工具标签 */
  tags?: string[];
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 工具名称 */
  toolName: string;
  /** 输入参数 */
  input: Record<string, unknown>;
  /** 输出内容 */
  output: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 执行时间戳 */
  timestamp: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 工具接口
 */
export interface Tool {
  /** 工具定义 */
  definition: ToolDefinition;

  /**
   * 执行工具
   * @param input 输入参数
   * @returns 执行结果
   */
  execute(input: Record<string, unknown>): Promise<ToolResult>;

  /**
   * 验证参数
   * @param input 输入参数
   * @returns 验证结果
   */
  validate?(input: Record<string, unknown>): { valid: boolean; errors?: string[] };
}

/**
 * 工具注册表配置
 */
export interface ToolRegistryConfig {
  /** 是否允许覆盖同名工具 */
  allowOverride?: boolean;
  /** 工具超时时间 (ms) */
  timeout?: number;
}
