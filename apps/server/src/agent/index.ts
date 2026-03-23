/**
 * Agent 系统模块
 * 支持多 Agent 协作：@host @expert1 @expert2 消息内容
 * 使用 Claude Code 原生 subagent 格式 (.claude/agents/*.md)
 */

export * from './types';
export * from './parser';
export * from './config';
export * from './context';
