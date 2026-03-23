/**
 * EventBus 消息总线使用示例
 *
 * 展示如何使用 EventBus 进行 Agent 间通信
 */

import { EventBus, AgentMessage } from '../../apps/server/src/multi-agent/bus/EventBus';

// ============================================
// 示例 1: 基础注册和广播
// ============================================

async function basicEventBus() {
  console.log('=== 基础 EventBus 示例 ===\n');

  const eventBus = new EventBus();

  // 注册 Agent
  const proposerId = eventBus.register('proposer', async (message) => {
    console.log(`[Proposer] 收到消息:`, message.payload);
    // 处理消息...
  });

  const skepticId = eventBus.register('skeptic', async (message) => {
    console.log(`[Skeptic] 收到消息:`, message.payload);
    // 处理消息...
  });

  // 广播消息（所有 Agent 都会收到，除了发送者）
  await eventBus.broadcast('moderator', {
    announcement: '辩论开始！'
  });

  // 单播消息（只有目标 Agent 收到）
  await eventBus.publish({
    type: 'request',
    from: 'moderator',
    to: 'proposer',
    payload: { question: '请提出你的观点' },
    priority: 'high'
  });

  // 清理
  eventBus.unregister(proposerId);
  eventBus.unregister(skepticId);
}

// ============================================
// 示例 2: 请求-响应模式
// ============================================

async function requestResponsePattern() {
  console.log('=== 请求-响应模式示例 ===\n');

  const eventBus = new EventBus();

  // 注册响应者
  eventBus.register('responder', async (message) => {
    console.log(`[Responder] 收到请求:`, message.payload);

    // 返回响应
    return {
      ...message,
      type: 'response' as const,
      from: message.to,
      to: message.from,
      payload: { answer: '这是我的回答' }
    };
  });

  // 发送请求并等待响应
  const response = await eventBus.request(
    'requester',
    'responder',
    { question: '你好吗？' },
    5000 // 超时时间（毫秒）
  );

  if (response) {
    console.log('收到响应:', response.payload);
  } else {
    console.log('请求超时');
  }
}

// ============================================
// 示例 3: 主题订阅
// ============================================

async function topicSubscription() {
  console.log('=== 主题订阅示例 ===\n');

  const eventBus = new EventBus();

  // 注册 Agent 并订阅特定主题
  const researcherId = eventBus.register(
    'researcher',
    async (message) => {
      console.log(`[Researcher] 收到研究主题消息:`, message.payload);
    },
    ['research', 'analysis'] // 订阅的主题
  );

  const developerId = eventBus.register(
    'developer',
    async (message) => {
      console.log(`[Developer] 收到开发主题消息:`, message.payload);
    },
    ['development', 'testing']
  );

  // 发送到特定主题
  await eventBus.emit('system', 'research', {
    topic: 'AI 发展趋势研究'
  });

  await eventBus.emit('system', 'development', {
    task: '实现新功能'
  });

  // 动态添加订阅
  eventBus.subscribe(researcherId, ['development']);

  // 清理
  eventBus.unregister(researcherId);
  eventBus.unregister(developerId);
}

// ============================================
// 示例 4: 优先级消息
// ============================================

async function priorityMessages() {
  console.log('=== 优先级消息示例 ===\n');

  const eventBus = new EventBus();

  eventBus.register('worker', async (message) => {
    console.log(`[Worker] 处理消息 (优先级: ${message.priority}):`, message.payload);
  });

  // 发送不同优先级的消息
  await eventBus.publish({
    type: 'task',
    from: 'system',
    to: 'worker',
    payload: { task: '普通任务 1' },
    priority: 'normal'
  });

  await eventBus.publish({
    type: 'task',
    from: 'system',
    to: 'worker',
    payload: { task: '紧急任务' },
    priority: 'high'
  });

  await eventBus.publish({
    type: 'task',
    from: 'system',
    to: 'worker',
    payload: { task: '低优先级任务' },
    priority: 'low'
  });
}

// ============================================
// 示例 5: 消息统计
// ============================================

async function messageStatistics() {
  console.log('=== 消息统计示例 ===\n');

  const eventBus = new EventBus();

  // 注册一个可能失败的处理函数
  eventBus.register('flaky-worker', async (message) => {
    if (Math.random() > 0.5) {
      throw new Error('处理失败');
    }
    console.log('[Worker] 处理成功');
  });

  // 发送多条消息
  for (let i = 0; i < 10; i++) {
    await eventBus.publish({
      type: 'task',
      from: 'system',
      to: 'flaky-worker',
      payload: { task: `任务 ${i}` },
      priority: 'normal'
    });
  }

  // 获取统计信息
  const stats = eventBus.getStats();
  console.log('\n📊 消息统计:');
  console.log('- 发送总数:', stats.totalSent);
  console.log('- 送达成功:', stats.totalDelivered);
  console.log('- 送达失败:', stats.totalFailed);
  console.log('- 订阅者数:', stats.subscriberCount);
}

// ============================================
// 示例 6: 完整的辩论协调器
// ============================================

class SimpleDebateCoordinator {
  private eventBus: EventBus;
  private agents: Map<string, string> = new Map();

  constructor() {
    this.eventBus = new EventBus();
  }

  // 注册 Agent
  registerAgent(role: string, handler: (message: AgentMessage) => Promise<any>) {
    const id = this.eventBus.register(role, async (message) => {
      const response = await handler(message);
      if (response) {
        return response;
      }
    });
    this.agents.set(role, id);
    console.log(`✅ 已注册 Agent: ${role}`);
  }

  // 开始辩论轮次
  async runRound(topic: string): Promise<void> {
    console.log(`\n🔄 开始辩论轮次: ${topic}`);

    // 1. 发送给 Proposer
    await this.eventBus.publish({
      type: 'request',
      from: 'moderator',
      to: 'proposer',
      payload: { topic, step: 'proposer' },
      priority: 'high'
    });

    // 2. 发送给 Skeptic
    await this.eventBus.publish({
      type: 'request',
      from: 'moderator',
      to: 'skeptic',
      payload: { topic, step: 'skeptic' },
      priority: 'high'
    });

    // 3. 广播结束
    await this.eventBus.broadcast('moderator', {
      announcement: '本轮结束'
    });
  }

  // 获取统计
  getStats() {
    return this.eventBus.getStats();
  }

  // 清理
  cleanup() {
    this.agents.forEach((id) => this.eventBus.unregister(id));
  }
}

async function debateCoordinatorExample() {
  console.log('=== 辩论协调器示例 ===\n');

  const coordinator = new SimpleDebateCoordinator();

  // 注册 Agent
  coordinator.registerAgent('proposer', async (message) => {
    console.log('[Proposer] 正方观点: 我认为...');
    return { type: 'response', payload: { view: '正方观点' } };
  });

  coordinator.registerAgent('skeptic', async (message) => {
    console.log('[Skeptic] 反方观点: 我反对...');
    return { type: 'response', payload: { view: '反方观点' } };
  });

  // 运行辩论
  await coordinator.runRound('AI 是否会取代程序员？');

  // 查看统计
  console.log('\n📊 统计:', coordinator.getStats());

  // 清理
  coordinator.cleanup();
}

// ============================================
// 运行示例
// ============================================

async function main() {
  const example = process.argv[2] || 'basic';

  switch (example) {
    case 'basic':
      await basicEventBus();
      break;
    case 'request':
      await requestResponsePattern();
      break;
    case 'topic':
      await topicSubscription();
      break;
    case 'priority':
      await priorityMessages();
      break;
    case 'stats':
      await messageStatistics();
      break;
    case 'coordinator':
      await debateCoordinatorExample();
      break;
    default:
      console.log('用法: npx tsx eventbus-usage.ts [basic|request|topic|priority|stats|coordinator]');
  }
}

main().catch(console.error);
