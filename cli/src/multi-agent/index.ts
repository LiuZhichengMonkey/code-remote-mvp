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

// 导出 TokenUsage 类型
export type { TokenUsage } from './orchestrator';
