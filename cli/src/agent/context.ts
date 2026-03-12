/**
 * Agent 上下文构建器
 * 构建协作模式下的完整上下文
 * 使用 Claude Code 原生 subagent 格式
 */

import { AgentContext, AgentCollaboration } from './types';
import { loadAgentContext, listAvailableAgents } from './config';

// 默认工具列表
const DEFAULT_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash',
  'Glob', 'Grep', 'WebSearch', 'WebFetch'
] as const;

/**
 * 安全截断字符串，确保不破坏多字节字符
 */
function safeTruncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  // 使用 Array.from 正确处理 Unicode 字符
  const chars = Array.from(str);
  if (chars.length <= maxLength) {
    return str;
  }
  return chars.slice(0, maxLength).join('');
}

/**
 * 构建协作上下文
 *
 * @param hostName 主 agent 名称
 * @param expertNames 专家 agent 名称列表
 * @param projectRoot 项目根目录
 * @throws Error 如果 host agent 不存在
 */
export function buildCollaborationContext(
  hostName: string,
  expertNames: string[],
  projectRoot?: string
): AgentCollaboration {
  // 加载主 agent
  const host = loadAgentContext(hostName, projectRoot);

  // 如果 host 不存在，抛出明确错误
  if (!host) {
    const availableAgents = listAvailableAgents(projectRoot);
    throw new Error(
      `Host agent '${hostName}' not found. ` +
      `Available agents: ${availableAgents.length > 0 ? availableAgents.join(', ') : 'none'}`
    );
  }

  // 加载专家 agent
  const experts: AgentContext[] = [];
  const notFoundExperts: string[] = [];

  for (const name of expertNames) {
    const expert = loadAgentContext(name, projectRoot);
    if (expert) {
      experts.push(expert);
    } else {
      notFoundExperts.push(name);
    }
  }

  // 警告未找到的专家
  if (notFoundExperts.length > 0) {
    console.warn(`[Agent] Expert agents not found: ${notFoundExperts.join(', ')}`);
  }

  // 构建合并后的 system prompt
  const systemPrompt = buildSystemPrompt(host, experts);

  return {
    host,
    experts,
    systemPrompt
  };
}

/**
 * 构建合并后的 system prompt
 */
function buildSystemPrompt(host: AgentContext, experts: AgentContext[]): string {
  const parts: string[] = [];

  // 主 agent 的 system prompt
  if (host?.config.systemPrompt) {
    parts.push(host.config.systemPrompt);
  }

  // 如果有专家 agent，添加协作指令
  if (experts.length > 0) {
    parts.push('\n## 可调用的专家 Agent\n\n你可以调用以下专家 Agent 来协助完成任务：\n');

    for (const expert of experts) {
      const expertInfo: string[] = [];
      expertInfo.push(`### ${expert.config.name}`);

      if (expert.config.description) {
        expertInfo.push(`描述：${expert.config.description}`);
      }

      if (expert.config.systemPrompt) {
        // 安全截取前 200 字符作为简介（不破坏多字节字符）
        const brief = safeTruncate(expert.config.systemPrompt, 200);
        expertInfo.push(`能力简介：${brief}${expert.config.systemPrompt.length > 200 ? '...' : ''}`);
      }

      parts.push(expertInfo.join('\n') + '\n');
    }

    parts.push(`调用方式：当你认为某个专家 Agent 可以帮助解决特定问题时，请在回复中明确说明需要调用哪个专家，并描述需要专家解决的问题。`);
  }

  return parts.join('\n');
}

/**
 * 获取 agent 的可用工具列表
 */
export function getAvailableTools(collaboration: AgentCollaboration): string[] {
  const tools = new Set<string>();

  // 主 agent 的工具
  if (collaboration.host?.config.tools) {
    collaboration.host.config.tools.forEach(t => tools.add(t));
  }

  // 合并所有专家的工具
  for (const expert of collaboration.experts) {
    if (expert.config.tools) {
      expert.config.tools.forEach(t => tools.add(t));
    }
  }

  // 如果没有指定工具，返回默认工具
  return tools.size > 0 ? Array.from(tools) : [...DEFAULT_TOOLS];
}

/**
 * 检查 agent 是否为 subagent 模式
 * Claude Code 原生格式默认使用 prompt 模式，由 Claude 自动委托
 * @returns 始终返回 true，表示使用 Claude Code 原生 subagent 功能
 */
export function isSubagentMode(_agent: AgentContext): boolean {
  // Claude Code 原生格式使用 prompt 模式
  // 但 isSubagentMode 返回 true 表示需要委托给 subagent
  return true;
}

/**
 * 获取 agent 的调用类型
 */
export function getSubagentType(_agent: AgentContext): string {
  return 'prompt';
}
