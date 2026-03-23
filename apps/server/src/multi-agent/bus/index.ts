/**
 * 消息总线模块
 *
 * 提供多Agent并发通信所需的核心组件:
 * - EventBus: 消息总线，支持单播/广播/主题订阅
 * - MessageQueue: 消息队列，Agent邮箱
 * - LockManager: 异步锁，黑板并发安全
 */

export { EventBus, globalEventBus } from './EventBus';
export type {
  AgentMessage,
  MessageType,
  MessagePriority,
  MessageHandler,
  MessageStats,
  EventBusConfig,
  MessageSender,
  MessageRecipient
} from './EventBus';

export { MessageQueue } from './MessageQueue';
export type { MessageQueueConfig } from './MessageQueue';

export { LockManager, AsyncLock, globalLockManager } from './LockManager';
export type { LockType, LockManagerConfig } from './LockManager';
