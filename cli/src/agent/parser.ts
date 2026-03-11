/**
 * @ 语法解析器
 * 支持多 agent 协作：@host @expert1 @expert2 消息内容
 */

import { ParsedAgents } from './types';

/**
 * 从消息中解析 @agent 语法
 *
 * 示例：
 * - "@reviewer 检查代码" -> { hostAgent: "reviewer", expertAgents: [], cleanMessage: "检查代码" }
 * - "@host @expert1 @expert2 讨论问题" -> { hostAgent: "host", expertAgents: ["expert1", "expert2"], cleanMessage: "讨论问题" }
 * - "普通消息" -> { hostAgent: null, expertAgents: [], cleanMessage: "普通消息" }
 */
export function parseAgentMentions(message: string): ParsedAgents {
  // 匹配 @agent 名：字母、数字、下划线、连字符
  const agentRegex = /@([a-zA-Z0-9_-]+)/g;
  const matches = [...message.matchAll(agentRegex)];

  if (matches.length === 0) {
    return {
      hostAgent: null,
      expertAgents: [],
      cleanMessage: message.trim()
    };
  }

  // 提取所有 agent 名称
  const agentNames = matches.map(m => m[1].toLowerCase());

  // 第一个是 host，其余是 experts
  const hostAgent = agentNames[0];
  const expertAgents = agentNames.slice(1);

  // 移除所有 @agent 标记
  let cleanMessage = message;
  for (const match of matches) {
    cleanMessage = cleanMessage.replace(match[0], '');
  }
  cleanMessage = cleanMessage.replace(/\s+/g, ' ').trim();

  return {
    hostAgent,
    expertAgents,
    cleanMessage
  };
}

/**
 * 检查消息是否包含 @agent
 */
export function hasAgentMention(message: string): boolean {
  return /@[a-zA-Z0-9_-]+/.test(message);
}

/**
 * 从消息中提取所有 agent 名称
 */
export function extractAgentNames(message: string): string[] {
  const regex = /@([a-zA-Z0-9_-]+)/g;
  const names: string[] = [];
  let match;
  while ((match = regex.exec(message)) !== null) {
    names.push(match[1].toLowerCase());
  }
  return names;
}
