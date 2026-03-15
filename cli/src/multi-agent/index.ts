/**
 * 多智能体对抗与分析引擎
 * Multi-Agent Adversarial Analysis Engine
 *
 * 通过对抗与辩论机制，对复杂问题进行多维度深度剖析
 *
 * v2.0 新增并发支持:
 * - EventBus: 消息总线，支持Agent并发通信
 * - MessageQueue: 消息队列，Agent邮箱
 * - LockManager: 异步锁，黑板并发安全
 * - ParallelOrchestrator: 并行执行器
 *
 * v2.1 统一 Agent 接口:
 * - UnifiedAgent: 统一的 Agent 接口
 * - AgentContext: Agent 执行上下文
 * - AgentResponse: Agent 执行结果
 * - AgentCapability: Agent 能力描述
 *
 * v2.2 工具系统:
 * - ToolManager: 工具注册和执行
 * - 内置工具: web-search, web-fetch, calculator, datetime
 *
 * v2.3 状态管理:
 * - StateManager: 统一状态管理
 * - 状态快照与恢复
 * - 事件驱动通知
 *
 * v2.4 讨论系统:
 * - DiscussionOrchestrator: 多Agent讨论协调
 * - AgentParser: @语法解析
 * - 内置模板: 代码审查、架构师、测试专家等
 */

export * from './types';
export * from './blackboard';
export * from './agents';
export * from './orchestrator';
export * from './llm-adapter';
export * from './prompt-loader';

// 导出并发模块
export * from './bus';
export * from './concurrent';

// 导出工具系统
export * from './tools';

// 导出状态管理模块
export * from './state';

// 导出讨论系统模块
export * from './discussion';

// 导出 TokenUsage 类型
export type { TokenUsage } from './orchestrator';

// 导出统一接口类型
export type {
  UnifiedAgent,
  AgentContext,
  AgentResponse,
  AgentCapability,
  ToolCall
} from './types';
