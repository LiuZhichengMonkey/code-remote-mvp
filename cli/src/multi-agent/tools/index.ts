/**
 * 工具系统模块
 *
 * 提供多 Agent 系统的工具调用能力
 */

// 导出新的 ToolManager
export { ToolManager, globalToolManager, createToolManager } from './ToolManager';
export type { ToolDefinition as ToolManagerToolDefinition, ToolManagerConfig } from './ToolManager';

// 导出原有的工具注册表系统
export { ToolRegistry, globalToolRegistry, createTool } from './registry';
// 注意: ToolResult 和 ToolDefinition 在 ../types.ts 中也有定义
// 这里导出扩展的类型（带 metadata 和 error）
export type { Tool, ToolRegistryConfig, ToolParameterSchema } from './types';
export type { ToolResult as ExtendedToolResult, ToolDefinition as ExtendedToolDefinition } from './types';

// 导出内置工具
export { webSearchTool, registerWebSearchTool } from './web-search';
export { webFetchTool, registerWebFetchTool } from './web-fetch';

/**
 * 注册所有内置工具
 */
export function registerBuiltinTools(): void {
  const { globalToolRegistry } = require('./registry');
  const { webSearchTool } = require('./web-search');
  const { webFetchTool } = require('./web-fetch');

  if (!globalToolRegistry.has('web-search')) {
    globalToolRegistry.register(webSearchTool);
  }
  if (!globalToolRegistry.has('web-fetch')) {
    globalToolRegistry.register(webFetchTool);
  }
}
