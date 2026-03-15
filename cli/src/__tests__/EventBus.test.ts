/**
 * EventBus 单元测试
 */

import { EventBus, AgentMessage, MessageStats } from '../multi-agent/bus/EventBus';
import { DebateRole } from '../multi-agent/types';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('register', () => {
    test('应该成功注册 Agent', () => {
      const handler = jest.fn();
      const id = eventBus.register('moderator', handler);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(eventBus.getSubscribers()).toContain('moderator');
    });

    test('应该支持注册多个相同角色的 Agent', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const id1 = eventBus.register('moderator', handler1);
      const id2 = eventBus.register('moderator', handler2);

      expect(id1).not.toBe(id2);
      expect(eventBus.getSubscribers()).toContain('moderator');
    });

    test('应该支持订阅主题', () => {
      const handler = jest.fn();
      eventBus.register('moderator', handler, ['topic1', 'topic2']);

      // 通过发布主题消息来验证
      eventBus.emit('system', 'topic1', { data: 'test' });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    test('应该成功注销 Agent', () => {
      const handler = jest.fn();
      const id = eventBus.register('moderator', handler);

      eventBus.unregister(id);

      expect(eventBus.getSubscribers()).not.toContain('moderator');
    });

    test('注销后不应收到消息', async () => {
      const handler = jest.fn();
      const id = eventBus.register('moderator', handler);

      eventBus.unregister(id);

      await eventBus.broadcast('system', { test: 'data' });

      expect(handler).not.toHaveBeenCalled();
    });

    test('应该清理主题订阅', async () => {
      const handler = jest.fn();
      const id = eventBus.register('moderator', handler, ['topic1']);

      eventBus.unregister(id);

      await eventBus.emit('system', 'topic1', { data: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    test('应该发送单播消息', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      eventBus.register('proposer', handler);
      eventBus.register('opponent', jest.fn());

      await eventBus.publish({
        type: 'request',
        from: 'moderator',
        to: 'proposer',
        payload: { question: 'test' },
        priority: 'normal'
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('应该广播消息给所有订阅者', async () => {
      const handler1 = jest.fn().mockResolvedValue(undefined);
      const handler2 = jest.fn().mockResolvedValue(undefined);
      const handler3 = jest.fn().mockResolvedValue(undefined);

      eventBus.register('proposer', handler1);
      eventBus.register('opponent', handler2);
      eventBus.register('reviewer', handler3);

      await eventBus.broadcast('moderator', { announcement: 'test' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });

    test('广播不应发送给发送者自己', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      eventBus.register('proposer', handler);

      await eventBus.broadcast('proposer', { test: 'data' });

      expect(handler).not.toHaveBeenCalled();
    });

    test('应该发送主题消息', async () => {
      const handler1 = jest.fn().mockResolvedValue(undefined);
      const handler2 = jest.fn().mockResolvedValue(undefined);

      eventBus.register('proposer', handler1, ['research']);
      eventBus.register('opponent', handler2, ['other']);

      await eventBus.emit('system', 'research', { data: 'test' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('request', () => {
    test('应该返回响应', async () => {
      const handler = jest.fn().mockImplementation(async (msg: AgentMessage) => {
        return {
          ...msg,
          type: 'response' as const,
          from: msg.to as DebateRole,
          to: msg.from,
          payload: { answer: 'response' }
        };
      });

      eventBus.register('proposer', handler);

      const response = await eventBus.request(
        'moderator',
        'proposer',
        { question: 'test' }
      );

      expect(response).toBeDefined();
      expect(response?.payload).toEqual({ answer: 'response' });
    });

    test('应该在超时后返回 null', async () => {
      const handler = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return undefined;
      });

      eventBus.register('proposer', handler);

      const response = await eventBus.request(
        'moderator',
        'proposer',
        { question: 'test' },
        100 // 100ms 超时
      );

      expect(response).toBeNull();
    });
  });

  describe('subscribe/unsubscribe', () => {
    test('应该动态订阅主题', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const id = eventBus.register('proposer', handler);

      // 订阅新主题
      eventBus.subscribe(id, ['new-topic']);

      await eventBus.emit('system', 'new-topic', { data: 'test' });

      expect(handler).toHaveBeenCalled();
    });

    test('应该取消订阅主题', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const id = eventBus.register('proposer', handler, ['topic1']);

      eventBus.unsubscribe(id, ['topic1']);

      await eventBus.emit('system', 'topic1', { data: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('应该返回正确的统计信息', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      eventBus.register('proposer', handler);

      await eventBus.broadcast('system', { test: 'data' });
      await eventBus.publish({
        type: 'request',
        from: 'system',
        to: 'proposer',
        payload: {},
        priority: 'normal'
      });

      const stats = eventBus.getStats();

      expect(stats.totalSent).toBe(2);
      expect(stats.totalDelivered).toBe(2);
      expect(stats.totalFailed).toBe(0);
    });

    test('应该统计失败的消息', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('test error'));
      eventBus.register('proposer', errorHandler);

      await eventBus.publish({
        type: 'request',
        from: 'system',
        to: 'proposer',
        payload: {},
        priority: 'normal'
      });

      const stats = eventBus.getStats();

      expect(stats.totalSent).toBe(1);
      expect(stats.totalDelivered).toBe(0);
      expect(stats.totalFailed).toBe(1);
    });

    test('resetStats 应该重置统计', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      eventBus.register('proposer', handler);

      await eventBus.broadcast('system', { test: 'data' });

      eventBus.resetStats();
      const stats = eventBus.getStats();

      expect(stats.totalSent).toBe(0);
    });
  });

  describe('cleanup', () => {
    test('应该清理过期消息', () => {
      // EventBus 内部管理消息队列
      // cleanup 方法应该在调用时正常工作
      expect(() => eventBus.cleanup()).not.toThrow();
    });
  });

  describe('配置', () => {
    test('应该接受自定义配置', () => {
      const customBus = new EventBus({
        maxQueueSize: 500,
        messageTTL: 60000,
        enablePersistence: true,
        maxRetries: 5
      });

      expect(customBus).toBeDefined();
    });
  });
});
