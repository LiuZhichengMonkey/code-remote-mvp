/**
 * SessionManager 单元测试
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionManager } from '../claude/session';

// Mock SessionStorage
jest.mock('../claude/storage');

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockStorage: any;

  beforeEach(() => {
    // 创建模拟存储
    mockStorage = {
      list: jest.fn().mockReturnValue([]),
      listInfo: jest.fn().mockReturnValue([]),
      load: jest.fn().mockReturnValue(null),
      loadPaginated: jest.fn().mockReturnValue({ session: null, hasMore: false, totalMessages: 0 }),
      save: jest.fn(),
      delete: jest.fn().mockReturnValue(true),
      rename: jest.fn().mockReturnValue(true),
      getLatest: jest.fn().mockReturnValue(null),
      exists: jest.fn().mockReturnValue(false)
    };

    // Mock SessionStorage 构造函数
    const SessionStorageMock = require('../claude/storage').SessionStorage;
    SessionStorageMock.mockImplementation(() => mockStorage);

    manager = new SessionManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    test('应该创建新会话', () => {
      const session = manager.create('Test Session');

      expect(session).toBeDefined();
      expect(session.title).toBe('Test Session');
      expect(session.id).toBeDefined();
      expect(session.messages).toEqual([]);
    });

    test('创建会话后应该设置为当前会话', () => {
      const session = manager.create('New Chat');

      const current = manager.getCurrent();
      expect(current?.id).toBe(session.id);
    });

    test('应该使用默认标题', () => {
      const session = manager.create();
      expect(session.title).toBe('New Chat');
    });
  });

  describe('resume', () => {
    test('应该恢复已存在的会话', () => {
      const mockSession = {
        id: 'existing-session',
        title: 'Existing',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now(),
        messages: []
      };
      mockStorage.load.mockReturnValue(mockSession);

      const session = manager.resume('existing-session');

      expect(session).toBeDefined();
      expect(session?.id).toBe('existing-session');
      expect(manager.getCurrent()?.id).toBe('existing-session');
    });

    test('恢复不存在的会话应返回 null', () => {
      mockStorage.load.mockReturnValue(null);

      const session = manager.resume('non-existent');

      expect(session).toBeNull();
    });
  });

  describe('resumePaginated', () => {
    test('应该分页加载会话', () => {
      const mockSession = {
        id: 'paginated-session',
        title: 'Paginated',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [{ id: 'm1', role: 'user', content: 'test', timestamp: Date.now() }]
      };
      mockStorage.loadPaginated.mockReturnValue({
        session: mockSession,
        hasMore: true,
        totalMessages: 50
      });

      const result = manager.resumePaginated('paginated-session', 20);

      expect(result.session).toBeDefined();
      expect(result.hasMore).toBe(true);
      expect(result.totalMessages).toBe(50);
    });
  });

  describe('addMessage', () => {
    test('应该添加消息到当前会话', () => {
      manager.create('Test');

      manager.addMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now()
      });

      const current = manager.getCurrent();
      expect(current?.messages.length).toBe(1);
      expect(current?.messages[0].content).toBe('Hello');
    });

    test('没有当前会话时应自动创建', () => {
      manager.addMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now()
      });

      const current = manager.getCurrent();
      expect(current).toBeDefined();
      expect(current?.messages.length).toBe(1);
    });

    test('第一条用户消息应成为标题', () => {
      manager.create();

      manager.addMessage({
        id: 'msg-1',
        role: 'user',
        content: 'This is a very long message that should be truncated to 50 characters',
        timestamp: Date.now()
      });

      const current = manager.getCurrent();
      expect(current?.title.length).toBeLessThanOrEqual(50);
    });
  });

  describe('getCurrent', () => {
    test('没有当前会话应返回 null', () => {
      expect(manager.getCurrent()).toBeNull();
    });

    test('应该返回当前会话', () => {
      manager.create('Current Session');
      const current = manager.getCurrent();

      expect(current).toBeDefined();
      expect(current?.title).toBe('Current Session');
    });
  });

  describe('get', () => {
    test('应该返回指定会话', () => {
      const mockSession = {
        id: 'session-123',
        title: 'Test Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      mockStorage.load.mockReturnValue(mockSession);

      const session = manager.get('session-123');

      expect(session?.id).toBe('session-123');
    });
  });

  describe('list', () => {
    test('应该返回会话列表', () => {
      const mockSessions = [
        { id: 's1', title: 'Session 1', createdAt: Date.now(), messageCount: 5 },
        { id: 's2', title: 'Session 2', createdAt: Date.now(), messageCount: 3 }
      ];
      mockStorage.listInfo.mockReturnValue(mockSessions);

      const sessions = manager.list();

      expect(sessions.length).toBe(2);
      expect(sessions[0].id).toBe('s1');
    });
  });

  describe('delete', () => {
    test('应该删除会话', () => {
      manager.create('To Delete');
      const sessionId = manager.getCurrent()?.id!;

      const result = manager.delete(sessionId);

      expect(result).toBe(true);
      expect(manager.getCurrent()).toBeNull();
    });
  });

  describe('rename', () => {
    test('应该重命名会话', () => {
      const session = manager.create('Old Name');

      const result = manager.rename(session.id, 'New Name');

      expect(result).toBe(true);
      expect(manager.get(session.id)?.title).toBe('New Name');
    });
  });

  describe('clearCurrent', () => {
    test('应该清除当前会话', () => {
      manager.create('Test');
      manager.clearCurrent();

      expect(manager.getCurrent()).toBeNull();
    });
  });

  describe('getMessagesForAPI', () => {
    test('应该返回当前会话的消息', () => {
      manager.create('Test');
      manager.addMessage({ id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now() });
      manager.addMessage({ id: 'm2', role: 'assistant', content: 'Hi', timestamp: Date.now() });

      const messages = manager.getMessagesForAPI();

      expect(messages.length).toBe(2);
    });

    test('没有当前会话应返回空数组', () => {
      const messages = manager.getMessagesForAPI();
      expect(messages).toEqual([]);
    });
  });

  describe('updateSessionId', () => {
    test('应该更新会话 ID', () => {
      const session = manager.create('Test');
      const oldId = session.id;

      mockStorage.load.mockReturnValue({
        ...session,
        id: 'new-session-id'
      });

      manager.updateSessionId('new-session-id');

      const current = manager.getCurrent();
      expect(current?.id).toBe('new-session-id');
    });
  });

  describe('setClaudeSessionId', () => {
    test('应该设置 Claude 会话 ID', () => {
      manager.create('Test');
      manager.setClaudeSessionId('claude-session-123');

      const current = manager.getCurrent();
      expect(current?.claudeSessionId).toBe('claude-session-123');
    });
  });
});
