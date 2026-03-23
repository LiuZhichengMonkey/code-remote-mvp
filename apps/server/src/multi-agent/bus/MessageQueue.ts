/**
 * 消息队列 - Agent邮箱
 *
 * 每个Agent维护一个消息队列，支持:
 * - 消息堆积
 * - 优先级排序
 * - 消息过滤
 */

import { AgentMessage, MessagePriority } from './EventBus';

/**
 * 队列配置
 */
export interface MessageQueueConfig {
  /** 最大队列长度 */
  maxSize: number;
  /** 是否按优先级排序 */
  priorityQueue: boolean;
  /** 消息过期时间 (ms) */
  messageTTL: number;
}

const DEFAULT_CONFIG: MessageQueueConfig = {
  maxSize: 100,
  priorityQueue: true,
  messageTTL: 5 * 60 * 1000 // 5分钟
};

/**
 * 消息队列
 */
export class MessageQueue {
  private queue: AgentMessage[] = [];
  private config: MessageQueueConfig;

  constructor(config?: Partial<MessageQueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 入队
   */
  enqueue(message: AgentMessage): boolean {
    // 检查队列长度
    if (this.queue.length >= this.config.maxSize) {
      // 移除最老的消息
      this.queue.shift();
    }

    // 检查过期
    if (message.expiresAt && message.expiresAt < Date.now()) {
      return false;
    }

    // 设置默认过期时间
    if (!message.expiresAt) {
      message = {
        ...message,
        expiresAt: Date.now() + this.config.messageTTL
      };
    }

    this.queue.push(message);

    // 按优先级排序
    if (this.config.priorityQueue) {
      this.sortByPriority();
    }

    return true;
  }

  /**
   * 出队
   */
  dequeue(): AgentMessage | undefined {
    return this.queue.shift();
  }

  /**
   * 查看队首消息
   */
  peek(): AgentMessage | undefined {
    return this.queue[0];
  }

  /**
   * 获取所有消息
   */
  getAll(): AgentMessage[] {
    return [...this.queue];
  }

  /**
   * 按条件过滤消息
   */
  filter(predicate: (msg: AgentMessage) => boolean): AgentMessage[] {
    return this.queue.filter(predicate);
  }

  /**
   * 按类型获取消息
   */
  getByType(type: AgentMessage['type']): AgentMessage[] {
    return this.queue.filter(msg => msg.type === type);
  }

  /**
   * 按发送者获取消息
   */
  getBySender(from: AgentMessage['from']): AgentMessage[] {
    return this.queue.filter(msg => msg.from === from);
  }

  /**
   * 按主题获取消息
   */
  getByTopic(topic: string): AgentMessage[] {
    return this.queue.filter(msg => msg.topic === topic);
  }

  /**
   * 移除消息
   */
  remove(messageId: string): boolean {
    const index = this.queue.findIndex(msg => msg.id === messageId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 队列长度
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * 是否为空
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 按优先级排序
   */
  private sortByPriority(): void {
    const priorityOrder: Record<MessagePriority, number> = {
      high: 0,
      normal: 1,
      low: 2
    };

    this.queue.sort((a, b) => {
      // 先按优先级
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // 再按时间戳
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * 清理过期消息
   */
  cleanup(): number {
    const now = Date.now();
    const originalLength = this.queue.length;
    this.queue = this.queue.filter(
      msg => !msg.expiresAt || msg.expiresAt > now
    );
    return originalLength - this.queue.length;
  }

  /**
   * 获取队列状态
   */
  getStatus(): {
    length: number;
    maxSize: number;
    byPriority: Record<MessagePriority, number>;
    byType: Record<string, number>;
  } {
    const byPriority: Record<MessagePriority, number> = {
      high: 0,
      normal: 0,
      low: 0
    };

    const byType: Record<string, number> = {};

    for (const msg of this.queue) {
      byPriority[msg.priority]++;
      byType[msg.type] = (byType[msg.type] || 0) + 1;
    }

    return {
      length: this.queue.length,
      maxSize: this.config.maxSize,
      byPriority,
      byType
    };
  }
}
