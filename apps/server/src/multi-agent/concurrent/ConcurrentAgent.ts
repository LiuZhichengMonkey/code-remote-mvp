/**
 * 并发Agent - 支持消息队列和异步消息处理
 *
 * 扩展现有BaseAgent，增加:
 * - 消息队列 (mailbox)
 * - 订阅/发布模式
 * - 异步消息处理
 */

import {
  DebateRole,
  AgentConfig,
  GlobalBlackboard,
  AgentContext,
  AgentResponse
} from '../types';
import { BaseAgent } from '../agents';
import {
  EventBus,
  MessageQueue,
  AgentMessage,
  MessageHandler,
  MessageSender,
  MessageRecipient
} from '../bus';

/**
 * 并发Agent配置
 */
export interface ConcurrentAgentConfig extends AgentConfig {
  /** 订阅的主题列表 */
  topics?: string[];
  /** 消息队列最大长度 */
  maxQueueSize?: number;
  /** 是否启用优先级队列 */
  priorityQueue?: boolean;
}

/**
 * 消息处理结果
 */
export interface MessageResult {
  /** 是否处理成功 */
  success: boolean;
  /** 响应消息 (如果有) */
  response?: AgentMessage;
  /** 错误信息 */
  error?: string;
}

/**
 * 并发Agent基类
 */
export abstract class ConcurrentAgent extends BaseAgent {
  /** 消息队列 */
  mailbox: MessageQueue;
  /** 事件总线引用 */
  protected eventBus?: EventBus;
  /** 订阅的主题 */
  protected topics: Set<string>;
  /** 订阅ID */
  protected subscriberId?: string;
  /** 是否正在处理消息 */
  protected isProcessing: boolean = false;

  constructor(config: ConcurrentAgentConfig) {
    super(config);
    this.mailbox = new MessageQueue({
      maxSize: config.maxQueueSize || 100,
      priorityQueue: config.priorityQueue ?? true
    });
    this.topics = new Set(config.topics || []);
  }

  /**
   * 连接到事件总线
   */
  connect(eventBus: EventBus): void {
    this.eventBus = eventBus;
    this.subscriberId = eventBus.register(
      this.role as DebateRole,
      this.createMessageHandler(),
      Array.from(this.topics)
    );
  }

  /**
   * 断开事件总线
   */
  disconnect(): void {
    if (this.eventBus && this.subscriberId) {
      this.eventBus.unregister(this.subscriberId);
      this.subscriberId = undefined;
    }
  }

  /**
   * 创建消息处理器
   */
  protected createMessageHandler(): MessageHandler {
    return async (message: AgentMessage): Promise<AgentMessage | void> => {
      // 消息入队
      this.mailbox.enqueue(message);

      // 如果不在处理中，开始处理
      if (!this.isProcessing) {
        this.processMessages();
      }

      // 如果是请求消息，等待处理结果
      if (message.type === 'request') {
        // 简化处理：立即返回一个响应
        return {
          id: `resp_${Date.now()}`,
          type: 'response',
          from: this.role as MessageSender,
          to: message.from as MessageRecipient,
          payload: { received: true },
          priority: 'normal',
          timestamp: Date.now(),
          correlationId: message.id
        };
      }
    };
  }

  /**
   * 处理队列中的消息
   */
  protected async processMessages(): Promise<void> {
    this.isProcessing = true;

    while (!this.mailbox.isEmpty) {
      const message = this.mailbox.dequeue();
      if (message) {
        try {
          await this.handleMessage(message);
        } catch (error) {
          console.error(`[${this.name}] Error handling message ${message.id}:`, error);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * 处理单个消息 (子类实现)
   */
  protected abstract handleMessage(message: AgentMessage): Promise<MessageResult>;

  /**
   * 发送消息
   */
  async send(
    to: DebateRole | 'all' | 'broadcast',
    payload: any,
    options?: {
      type?: AgentMessage['type'];
      topic?: string;
      priority?: AgentMessage['priority'];
    }
  ): Promise<AgentMessage[]> {
    if (!this.eventBus) {
      throw new Error('Agent not connected to event bus');
    }

    return this.eventBus.publish({
      type: options?.type || 'event',
      from: this.role as MessageSender,
      to: to as MessageRecipient,
      topic: options?.topic,
      payload,
      priority: options?.priority || 'normal'
    });
  }

  /**
   * 发送请求并等待响应
   */
  async request(
    to: DebateRole,
    payload: any,
    timeout?: number
  ): Promise<AgentMessage | null> {
    if (!this.eventBus) {
      throw new Error('Agent not connected to event bus');
    }

    return this.eventBus.request(this.role as MessageSender, to as MessageRecipient, payload, timeout);
  }

  /**
   * 广播消息
   */
  async broadcast(payload: any): Promise<AgentMessage[]> {
    return this.send('broadcast', payload, { type: 'broadcast' });
  }

  /**
   * 订阅主题
   */
  subscribeTopic(topic: string): void {
    this.topics.add(topic);
    if (this.eventBus && this.subscriberId) {
      this.eventBus.subscribe(this.subscriberId, [topic]);
    }
  }

  /**
   * 取消订阅主题
   */
  unsubscribeTopic(topic: string): void {
    this.topics.delete(topic);
    if (this.eventBus && this.subscriberId) {
      this.eventBus.unsubscribe(this.subscriberId, [topic]);
    }
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): {
    length: number;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
  } {
    return this.mailbox.getStatus();
  }
}

/**
 * 创建并发Agent的工厂函数
 */
export function createConcurrentAgent(
  baseAgent: BaseAgent,
  config?: Partial<ConcurrentAgentConfig>
): ConcurrentAgent {
  return new (class extends ConcurrentAgent {
    private handler: (message: AgentMessage) => Promise<MessageResult>;

    constructor() {
      super({
        name: baseAgent.name,
        role: baseAgent.role as DebateRole,
        description: baseAgent.description,
        systemPrompt: baseAgent.systemPrompt,
        tools: baseAgent.tools,
        ...config
      });

      // 复用baseAgent的invoke方法
      this.handler = async (message: AgentMessage) => {
        const context = typeof message.payload === 'string'
          ? message.payload
          : JSON.stringify(message.payload);

        // 调用原Agent的invoke方法
        const response = await baseAgent.invoke({
          blackboard: {} as GlobalBlackboard,
          history: [],
          currentStep: 'proposer',
          round: 0,
          customContext: { message: context }
        });

        return {
          success: true,
          response: {
            id: `resp_${Date.now()}`,
            type: 'response',
            from: this.role as MessageSender,
            to: message.from as MessageRecipient,
            payload: { content: response.content },
            priority: 'normal',
            timestamp: Date.now(),
            correlationId: message.id
          }
        };
      };
    }

    async invoke(context: AgentContext): Promise<AgentResponse> {
      return baseAgent.invoke(context);
    }

    protected async handleMessage(message: AgentMessage): Promise<MessageResult> {
      return this.handler(message);
    }
  })();
}
