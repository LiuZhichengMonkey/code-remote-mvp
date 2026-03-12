/**
 * 消息总线 - 多Agent并发通信核心
 *
 * 支持三种通信模式:
 * 1. 单播(unicast): 发送给指定Agent
 * 2. 广播(broadcast): 发送给所有Agent
 * 3. 主题订阅(topic): 发送给订阅了特定主题的Agent
 */

import { AgentRole } from '../types';

/**
 * 消息类型
 */
export type MessageType =
  | 'request'      // 请求消息
  | 'response'     // 响应消息
  | 'broadcast'    // 广播消息
  | 'event';       // 事件通知

/**
 * 消息优先级
 */
export type MessagePriority = 'high' | 'normal' | 'low';

/**
 * 消息接收者类型
 */
export type MessageRecipient = AgentRole | 'all' | 'broadcast' | 'system' | 'user';

/**
 * 消息发送者类型
 */
export type MessageSender = AgentRole | 'system' | 'user';

/**
 * Agent消息结构
 */
export interface AgentMessage {
  /** 消息ID */
  id: string;
  /** 消息类型 */
  type: MessageType;
  /** 发送者 */
  from: MessageSender;
  /** 接收者 */
  to: MessageRecipient;
  /** 消息主题 (用于主题订阅) */
  topic?: string;
  /** 消息内容 */
  payload: any;
  /** 优先级 */
  priority: MessagePriority;
  /** 时间戳 */
  timestamp: number;
  /** 关联ID (用于请求-响应模式) */
  correlationId?: string;
  /** 过期时间 */
  expiresAt?: number;
}

/**
 * 消息处理器
 */
export type MessageHandler = (message: AgentMessage) => Promise<AgentMessage | void>;

/**
 * 订阅者信息
 */
interface Subscriber {
  id: string;
  role: AgentRole;
  handler: MessageHandler;
  topics: Set<string>;
}

/**
 * 消息统计
 */
export interface MessageStats {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  byType: Map<MessageType, number>;
  byRole: Map<AgentRole, { sent: number; received: number }>;
}

/**
 * 事件总线配置
 */
export interface EventBusConfig {
  /** 消息队列最大长度 */
  maxQueueSize: number;
  /** 消息过期时间 (ms) */
  messageTTL: number;
  /** 是否启用消息持久化 */
  enablePersistence: boolean;
  /** 重试次数 */
  maxRetries: number;
}

const DEFAULT_CONFIG: EventBusConfig = {
  maxQueueSize: 1000,
  messageTTL: 5 * 60 * 1000, // 5分钟
  enablePersistence: false,
  maxRetries: 3
};

/**
 * 事件总线
 */
export class EventBus {
  private subscribers: Map<string, Subscriber> = new Map();
  private topicSubscribers: Map<string, Set<string>> = new Map();
  private messageQueue: AgentMessage[] = [];
  private config: EventBusConfig;
  private stats: MessageStats = {
    totalSent: 0,
    totalDelivered: 0,
    totalFailed: 0,
    byType: new Map(),
    byRole: new Map()
  };

  constructor(config?: Partial<EventBusConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成消息ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 注册Agent
   */
  register(role: AgentRole, handler: MessageHandler, topics: string[] = []): string {
    const id = `${role}_${Date.now()}`;

    const subscriber: Subscriber = {
      id,
      role,
      handler,
      topics: new Set(topics)
    };

    this.subscribers.set(id, subscriber);

    // 注册主题订阅
    for (const topic of topics) {
      if (!this.topicSubscribers.has(topic)) {
        this.topicSubscribers.set(topic, new Set());
      }
      this.topicSubscribers.get(topic)!.add(id);
    }

    // 初始化角色统计
    if (!this.stats.byRole.has(role)) {
      this.stats.byRole.set(role, { sent: 0, received: 0 });
    }

    return id;
  }

  /**
   * 注销Agent
   */
  unregister(subscriberId: string): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) return;

    // 清理主题订阅
    Array.from(subscriber.topics).forEach(topic => {
      this.topicSubscribers.get(topic)?.delete(subscriberId);
    });

    this.subscribers.delete(subscriberId);
  }

  /**
   * 订阅主题
   */
  subscribe(subscriberId: string, topics: string[]): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) return;

    for (const topic of topics) {
      subscriber.topics.add(topic);
      if (!this.topicSubscribers.has(topic)) {
        this.topicSubscribers.set(topic, new Set());
      }
      this.topicSubscribers.get(topic)!.add(subscriberId);
    }
  }

  /**
   * 取消订阅主题
   */
  unsubscribe(subscriberId: string, topics: string[]): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) return;

    for (const topic of topics) {
      subscriber.topics.delete(topic);
      this.topicSubscribers.get(topic)?.delete(subscriberId);
    }
  }

  /**
   * 发送消息
   */
  async publish(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<AgentMessage[]> {
    const fullMessage: AgentMessage = {
      ...message,
      id: this.generateId(),
      timestamp: Date.now()
    };

    // 更新统计
    this.stats.totalSent++;
    const typeCount = this.stats.byType.get(message.type) || 0;
    this.stats.byType.set(message.type, typeCount + 1);

    // 发送者统计
    if (message.from !== 'system' && message.from !== 'user') {
      const roleStats = this.stats.byRole.get(message.from);
      if (roleStats) {
        roleStats.sent++;
      }
    }

    // 根据目标类型路由
    const results: AgentMessage[] = [];

    if (message.to === 'all' || message.to === 'broadcast') {
      // 广播给所有订阅者
      const promises: Promise<void>[] = [];

      Array.from(this.subscribers.entries()).forEach(([id, subscriber]) => {
        // 不发送给自己
        if (subscriber.role === message.from) return;

        promises.push(this.deliver(subscriber, fullMessage, results));
      });

      await Promise.allSettled(promises);
    } else if (message.topic) {
      // 主题订阅
      const subscriberIds = this.topicSubscribers.get(message.topic) || new Set();
      const promises: Promise<void>[] = [];

      Array.from(subscriberIds).forEach(id => {
        const subscriber = this.subscribers.get(id);
        if (subscriber && subscriber.role !== message.from) {
          promises.push(this.deliver(subscriber, fullMessage, results));
        }
      });

      await Promise.allSettled(promises);
    } else {
      // 单播给指定角色
      Array.from(this.subscribers.entries()).forEach(([id, subscriber]) => {
        if (subscriber.role === message.to) {
          this.deliver(subscriber, fullMessage, results);
          return; // 只发送给第一个匹配的
        }
      });
    }

    return results;
  }

  /**
   * 投递消息
   */
  private async deliver(
    subscriber: Subscriber,
    message: AgentMessage,
    results: AgentMessage[]
  ): Promise<void> {
    try {
      const response = await subscriber.handler(message);

      // 更新统计
      this.stats.totalDelivered++;
      const roleStats = this.stats.byRole.get(subscriber.role);
      if (roleStats) {
        roleStats.received++;
      }

      if (response) {
        results.push(response);
      }
    } catch (error) {
      this.stats.totalFailed++;
      console.error(`[EventBus] Failed to deliver message ${message.id} to ${subscriber.role}:`, error);
    }
  }

  /**
   * 请求-响应模式
   */
  async request(
    from: MessageSender,
    to: AgentRole,
    payload: any,
    timeout: number = 30000
  ): Promise<AgentMessage | null> {
    const correlationId = this.generateId();

    return new Promise(async (resolve) => {
      // 设置超时
      const timer = setTimeout(() => {
        resolve(null);
      }, timeout);

      // 发送请求
      const responses = await this.publish({
        type: 'request',
        from,
        to,
        payload,
        priority: 'normal',
        correlationId
      });

      clearTimeout(timer);

      if (responses.length > 0) {
        resolve(responses[0]);
      } else {
        resolve(null);
      }
    });
  }

  /**
   * 广播消息
   */
  async broadcast(
    from: MessageSender,
    payload: any,
    priority: MessagePriority = 'normal'
  ): Promise<AgentMessage[]> {
    return this.publish({
      type: 'broadcast',
      from,
      to: 'all',
      payload,
      priority
    });
  }

  /**
   * 发送事件通知
   */
  async emit(
    from: AgentRole | 'system',
    topic: string,
    payload: any
  ): Promise<AgentMessage[]> {
    return this.publish({
      type: 'event',
      from,
      to: 'broadcast',
      topic,
      payload,
      priority: 'normal'
    });
  }

  /**
   * 获取统计信息
   */
  getStats(): MessageStats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      byType: new Map(),
      byRole: new Map()
    };
  }

  /**
   * 获取所有订阅者
   */
  getSubscribers(): AgentRole[] {
    return Array.from(new Set(
      Array.from(this.subscribers.values()).map(s => s.role)
    ));
  }

  /**
   * 清理过期消息
   */
  cleanup(): void {
    const now = Date.now();
    this.messageQueue = this.messageQueue.filter(
      msg => !msg.expiresAt || msg.expiresAt > now
    );
  }
}

/**
 * 创建全局事件总线实例
 */
export const globalEventBus = new EventBus();
