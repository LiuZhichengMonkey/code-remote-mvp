/**
 * Agent 配置类型定义
 */

export interface AgentMcpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentConfig {
  name: string;
  description?: string;
  systemPrompt?: string;
  tools?: string[];           // 可用工具列表
  mcpServers?: AgentMcpServer[];  // MCP 服务器配置
  model?: string;             // 指定模型
  temperature?: number;       // 温度参数
  // 协作配置
  role?: 'host' | 'expert' | 'both';  // 角色：主持人/专家/两者皆可
  expertise?: string[];       // 专长领域
}

export interface AgentContext {
  config: AgentConfig;
  memory?: string;            // 记忆内容
  skills?: string[];          // 技能列表
  basePath: string;           // Agent 目录路径
  source: 'project' | 'user'; // 来源：项目内 or 用户目录
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

// Agent 目录结构
export const AGENT_DIR_NAME = '.agents';
export const USER_AGENT_DIR_NAME = '.coderemote/agents';

// 配置文件名
export const CONFIG_FILE = 'config.yaml';
export const MEMORY_FILE = 'memory.md';
export const SKILLS_DIR = 'skills';
