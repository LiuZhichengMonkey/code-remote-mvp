/**
 * 并发模块
 *
 * 提供多Agent并发执行能力:
 * - ConcurrentAgent: 支持消息队列的并发Agent
 * - ParallelOrchestrator: 并行执行器
 */

export { ConcurrentAgent, createConcurrentAgent } from './ConcurrentAgent';
export type {
  ConcurrentAgentConfig,
  MessageResult
} from './ConcurrentAgent';

export {
  ParallelOrchestrator,
  createParallelOrchestrator
} from './ParallelOrchestrator';
export type {
  ParallelResult,
  RoundResult,
  ParallelOrchestratorConfig
} from './ParallelOrchestrator';
