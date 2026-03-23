/**
 * 讨论系统模块
 *
 * 支持 @语法 触发多智能体讨论
 *
 * @example
 * ```typescript
 * import { DiscussionOrchestrator, AgentParser } from './discussion';
 *
 * // 创建协调器
 * const orchestrator = new DiscussionOrchestrator({ maxRounds: 3 });
 *
 * // 解析输入
 * const input = '@代码审查 @架构师 这个 API 设计是否合理？';
 * const { mentions, templates, task } = orchestrator.parseInput(input);
 *
 * // 创建并运行讨论
 * const session = orchestrator.createSession(input);
 * const result = await orchestrator.run(session.id);
 *
 * console.log(result.conclusion);
 * ```
 */

// 类型导出
export type {
  AgentTemplate,
  AgentMention,
  DiscussionParticipant,
  DiscussionMessage,
  DiscussionConfig,
  DiscussionSession,
  DiscussionEvent,
  DiscussionResult,
  DiscussionSubscriber,
  DiscussionMode,
  TerminationMode
} from './types';

// 常量导出
export { DEFAULT_DISCUSSION_CONFIG } from './types';

// 解析器
export { AgentParser, BUILTIN_TEMPLATES, globalAgentParser } from './AgentParser';

// 模式检测器
export { ModeDetector, createModeDetector } from './ModeDetector';
export type { ModeDetectionResult, TopicAnalysis } from './ModeDetector';

// 协调器
export {
  DiscussionOrchestrator,
  createDiscussionOrchestrator,
  globalDiscussionOrchestrator
} from './DiscussionOrchestrator';

// Subagent 会话管理器
export {
  SubagentSessionManager,
  createSubagentSessionManager
} from './SubagentSessionManager';
export type { SubagentSession, SubagentManagerConfig } from './SubagentSessionManager';
