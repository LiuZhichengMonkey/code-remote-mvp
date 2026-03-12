/**
 * Agent 配置类型定义
 * 简化版：只支持 Claude Code 原生格式
 */

/**
 * Agent 配置（简化版，对应 .claude/agents/*.md 格式）
 */
export interface AgentConfig {
  name: string;
  description?: string;
  systemPrompt?: string;
  tools?: string[];           // 可用工具列表
  // 简化的 subagent 配置
  subagent?: {
    type: 'prompt';  // 使用 prompt 模式，让 Claude Code 自动委托
  };
}

export interface AgentContext {
  config: AgentConfig;
  basePath: string;           // Agent 文件路径
  source: 'project' | 'user' | 'parent'; // 来源
}

export interface ParsedAgents {
  hostAgent: string | null;       // 主 agent（第一个 @）
  expertAgents: string[];         // 专家 agent 列表（后续 @）
  cleanMessage: string;           // 清理后的消息
}

export interface AgentCollaboration {
  host: AgentContext | null;      // 主 agent 上下文
  experts: AgentContext[];        // 专家 agent 上下文列表
  systemPrompt: string;           // 合并后的 system prompt
}

// 目录常量（保留兼容性）
export const AGENT_DIR_NAME = '.claude/agents';
export const USER_AGENT_DIR_NAME = '.claude/agents';
export const CONFIG_FILE = 'agent.md';
export const MEMORY_FILE = 'memory.md';
export const SKILLS_DIR = 'skills';

/**
 * 类型守卫：验证 AgentContext 对象
 */
export function isValidAgentContext(context: unknown): context is AgentContext {
  if (!context || typeof context !== 'object') return false;

  const c = context as AgentContext;
  return (
    typeof c.config === 'object' &&
    c.config !== null &&
    typeof c.config.name === 'string' &&
    c.config.name.length > 0 &&
    typeof c.basePath === 'string' &&
    c.basePath.length > 0 &&
    ['project', 'user', 'parent'].includes(c.source)
  );
}
