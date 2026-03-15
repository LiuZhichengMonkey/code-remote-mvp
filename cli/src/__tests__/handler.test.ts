/**
 * MessageHandler 单元测试
 */

import { MessageHandler, MessageContext } from '../handler';

describe('MessageHandler', () => {
  let handler: MessageHandler;

  beforeEach(() => {
    handler = new MessageHandler();
  });

  describe('handleMessage', () => {
    test('应该返回问候响应', async () => {
      const response = await handler.handleMessage('client1', 'hello');
      expect(response).toContain('Hello');
      expect(response).toContain('CodeRemote');
    });

    test('应该响应 hi 问候', async () => {
      const response = await handler.handleMessage('client1', 'Hi there!');
      expect(response).toContain('Hello');
    });

    test('应该返回帮助信息', async () => {
      const response = await handler.handleMessage('client1', 'help');
      expect(response).toContain('Commands');
      expect(response).toContain('MVP');
    });

    test('应该返回状态信息', async () => {
      const response = await handler.handleMessage('client1', 'status');
      expect(response).toContain('Status');
      expect(response).toContain('Running');
    });

    test('应该返回当前时间', async () => {
      const response = await handler.handleMessage('client1', 'time');
      expect(response).toContain('Current time');
    });

    test('应该对未知消息返回默认响应', async () => {
      const response = await handler.handleMessage('client1', 'random message');
      expect(response).toContain('Received');
      expect(response).toContain('random message');
    });

    test('应该区分大小写处理消息', async () => {
      const response = await handler.handleMessage('client1', 'HELP');
      expect(response).toContain('Commands');
    });

    test('应该存储消息历史', async () => {
      await handler.handleMessage('client1', 'message 1');
      await handler.handleMessage('client2', 'message 2');

      const history = handler.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].content).toBe('message 1');
      expect(history[1].content).toBe('message 2');
    });
  });

  describe('getHistory', () => {
    test('应该返回空数组（无历史）', () => {
      const history = handler.getHistory();
      expect(history).toEqual([]);
    });

    test('应该返回指定数量的历史记录', async () => {
      for (let i = 0; i < 10; i++) {
        await handler.handleMessage('client1', `message ${i}`);
      }

      const history = handler.getHistory(5);
      expect(history.length).toBe(5);
      // 应该返回最新的 5 条
      expect(history[0].content).toBe('message 5');
      expect(history[4].content).toBe('message 9');
    });

    test('应该返回历史记录的副本', async () => {
      await handler.handleMessage('client1', 'test');

      const history1 = handler.getHistory();
      const history2 = handler.getHistory();

      expect(history1).not.toBe(history2); // 不同的数组引用
      expect(history1).toEqual(history2); // 但内容相同
    });
  });

  describe('clearHistory', () => {
    test('应该清空历史记录', async () => {
      await handler.handleMessage('client1', 'message 1');
      await handler.handleMessage('client2', 'message 2');

      handler.clearHistory();

      const history = handler.getHistory();
      expect(history.length).toBe(0);
    });
  });

  describe('历史记录限制', () => {
    test('应该限制最大历史记录数', async () => {
      // 默认最大 100 条
      for (let i = 0; i < 150; i++) {
        await handler.handleMessage('client1', `message ${i}`);
      }

      const history = handler.getHistory();
      expect(history.length).toBe(100);
      // 应该保留最新的 100 条
      expect(history[0].content).toBe('message 50');
      expect(history[99].content).toBe('message 149');
    });
  });

  describe('MessageContext', () => {
    test('应该包含正确的上下文信息', async () => {
      await handler.handleMessage('client-123', 'test content');

      const history = handler.getHistory();
      const context = history[0];

      expect(context.clientId).toBe('client-123');
      expect(context.content).toBe('test content');
      expect(context.timestamp).toBeInstanceOf(Date);
    });
  });
});
