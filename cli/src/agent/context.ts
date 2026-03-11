/**
 * Agent 上下文构建器
 * 构建协作模式下的完整上下文
 */

import { AgentContext, AgentCollaboration } from './types';
import { loadAgentContext } from './config';

/**
 * 构建协作上下文
 *
 * @param hostName 主 agent 名称
 * @param expertNames 专家 agent 名称列表
 * @param projectRoot 项目根目录
 */
export function buildCollaborationContext(
  hostName: string,
  expertNames: string[],
  projectRoot?: string
): AgentCollaboration {
  // 加载主 agent
  const host = loadAgentContext(hostName, projectRoot);

  // 加载专家 agent
  const experts: AgentContext[] = [];
  for (const name of expertNames) {
    const expert = loadAgentContext(name, projectRoot);
    if (expert) {
      experts.push(expert);
    } else {
      console.warn(`[Agent] Expert agent not found: ${name}`);
    }
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
function buildSystemPrompt(host: AgentContext | null, experts: AgentContext[]): string {
  const parts: string[] = [];

  // 主 agent 的 system prompt
  if (host?.config.systemPrompt) {
    parts.push(host.config.systemPrompt);
  }

  // 主 agent 的记忆
  if (host?.memory) {
    parts.push(`\n## 记忆\n\n${host.memory}`);
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

      if (expert.config.expertise?.length) {
        expertInfo.push(`专长：${expert.config.expertise.join(', ')}`);
      }

      if (expert.config.systemPrompt) {
        // 截取前 200 字符作为简介
        const brief = expert.config.systemPrompt.substring(0, 200);
        expertInfo.push(`能力简介：${brief}${expert.config.systemPrompt.length > 200 ? '...' : ''}`);
      }

      parts.push(expertInfo.join('\n') + '\n');
    }

    parts.push(`调用方式：当你认为某个专家 Agent 可以帮助解决特定问题时，请在回复中明确说明需要调用哪个专家，并描述需要专家解决的问题。`);
  }

  // 主 agent 的技能
  if (host?.skills?.length) {
    parts.push('\n## 可用技能\n');
    for (const skill of host.skills) {
      parts.push(skill);
    }
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

  // 如果没有指定工具，返回默认工具
  if (tools.size === 0) {
    return [
      'Read', 'Write', 'Edit', 'Bash',
      'Glob', 'Grep', 'WebSearch', 'WebFetch'
    ];
  }

  return Array.from(tools);
}

/**
 * 获取 agent 的 MCP 服务器配置
 */
export function getMcpServers(collaboration: AgentCollaboration): Array<{
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}> {
  const servers: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }> = [];

  // 主 agent 的 MCP 服务器
  if (collaboration.host?.config.mcpServers) {
    servers.push(...collaboration.host.config.mcpServers);
  }

  // 专家 agent 的 MCP 服务器（可选）
  for (const expert of collaboration.experts) {
    if (expert.config.mcpServers) {
      // 避免重复
      for (const server of expert.config.mcpServers) {
        if (!servers.find(s => s.name === server.name)) {
          servers.push(server);
        }
      }
    }
  }

  return servers;
}
