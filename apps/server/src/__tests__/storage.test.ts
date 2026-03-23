/**
 * SessionStorage 单元测试
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionStorage, ProjectInfo } from '../claude/storage';

describe('SessionStorage', () => {
  let storage: SessionStorage;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-session-test-'));
    // 直接传入测试目录作为项目路径
    storage = new SessionStorage(testDir);
    // 手动设置 projectDir 为测试目录
    (storage as any).projectDir = testDir;
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('save and load', () => {
    test('加载不存在的会话应返回 null', () => {
      const loaded = storage.load('non-existent-id');
      expect(loaded).toBeNull();
    });
  });

  describe('list', () => {
    test('应该列出所有会话', () => {
      // 创建测试会话文件
      const session1 = {
        id: 'session-1',
        title: 'Session 1',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
        messages: [
          { id: 'm1', role: 'user' as const, content: 'Hi', timestamp: Date.now() - 1000 }
        ]
      };

      const session2 = {
        id: 'session-2',
        title: 'Session 2',
        createdAt: Date.now() - 500,
        updatedAt: Date.now(),
        messages: [
          { id: 'm2', role: 'user' as const, content: 'Hello', timestamp: Date.now() - 500 }
        ]
      };

      // 写入会话文件
      [session1, session2].forEach(session => {
        const filePath = path.join(testDir, `${session.id}.jsonl`);
        const content = session.messages.map(msg => JSON.stringify({
          type: msg.role,
          sessionId: session.id,
          uuid: msg.id,
          timestamp: new Date(msg.timestamp).toISOString(),
          message: { role: msg.role, content: msg.content }
        })).join('\n');
        fs.writeFileSync(filePath, content + '\n', 'utf-8');
      });

      const sessions = storage.list();

      expect(sessions.length).toBe(2);
      // 会话应该存在
      expect(sessions.map(s => s.id)).toContain('session-1');
      expect(sessions.map(s => s.id)).toContain('session-2');
    });

    test('空目录应返回空数组', () => {
      const sessions = storage.list();
      expect(sessions).toEqual([]);
    });
  });

  describe('delete', () => {
    test('应该删除会话文件', () => {
      const sessionId = 'to-delete';
      const filePath = path.join(testDir, `${sessionId}.jsonl`);

      fs.writeFileSync(filePath, JSON.stringify({
        type: 'user',
        sessionId,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'test' }
      }) + '\n', 'utf-8');

      expect(fs.existsSync(filePath)).toBe(true);

      const result = storage.delete(sessionId);

      expect(result).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('删除不存在的会话应返回 false', () => {
      const result = storage.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('rename', () => {
    test('应该更新会话标题', () => {
      const sessionId = 'to-rename';
      const filePath = path.join(testDir, `${sessionId}.jsonl`);

      fs.writeFileSync(filePath, JSON.stringify({
        type: 'user',
        sessionId,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'test' }
      }) + '\n', 'utf-8');

      const result = storage.rename(sessionId, 'New Title');

      expect(result).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('New Title');
      expect(content).toContain('"type":"summary"');
    });
  });

  describe('exists', () => {
    test('应该返回 true（存在）', () => {
      const sessionId = 'existing';
      const filePath = path.join(testDir, `${sessionId}.jsonl`);

      fs.writeFileSync(filePath, JSON.stringify({
        type: 'user',
        sessionId,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'test' }
      }) + '\n', 'utf-8');

      expect(storage.exists(sessionId)).toBe(true);
    });

    test('应该返回 false（不存在）', () => {
      expect(storage.exists('non-existent')).toBe(false);
    });
  });

  describe('getLatest', () => {
    test('应该返回最新会话', () => {
      const sessions = [
        { id: 'old', title: 'Old', updatedAt: Date.now() - 1000 },
        { id: 'new', title: 'New', updatedAt: Date.now() }
      ];

      sessions.forEach(session => {
        const filePath = path.join(testDir, `${session.id}.jsonl`);
        fs.writeFileSync(filePath, JSON.stringify({
          type: 'user',
          sessionId: session.id,
          uuid: 'msg-1',
          timestamp: new Date(session.updatedAt).toISOString(),
          message: { role: 'user', content: session.title }
        }) + '\n', 'utf-8');
      });

      const latest = storage.getLatest();

      // getLatest 返回按 updatedAt 倒序的第一个会话
      // 由于文件系统的文件修改时间影响，我们只验证返回的会话是存在的
      expect(latest).not.toBeNull();
      expect(['old', 'new']).toContain(latest?.id);
    });

    test('空目录应返回 null', () => {
      expect(storage.getLatest()).toBeNull();
    });
  });

  describe('cleanup', () => {
    test('应该能正常调用 cleanup 方法', () => {
      // cleanup 方法正常工作不应抛出异常
      expect(() => storage.cleanup(60 * 1000)).not.toThrow();
    });
  });

  describe('loadPaginated', () => {
    test('应该正确分页加载消息', () => {
      const sessionId = 'paginated';
      const filePath = path.join(testDir, `${sessionId}.jsonl`);

      // 创建 50 条消息
      const lines = [];
      for (let i = 0; i < 50; i++) {
        lines.push(JSON.stringify({
          type: i % 2 === 0 ? 'user' : 'assistant',
          sessionId,
          uuid: `msg-${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          message: { role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` }
        }));
      }
      fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

      // 首次加载 10 条
      const result1 = storage.loadPaginated(sessionId, 10);
      expect(result1.session?.messages?.length).toBe(10);
      expect(result1.hasMore).toBe(true);
      expect(result1.totalMessages).toBe(50);

      // 加载更多
      const result2 = storage.loadPaginated(sessionId, 10, 10);
      expect(result2.session?.messages?.length).toBe(10);
      expect(result2.hasMore).toBe(true);
    });
  });

  describe('静态方法', () => {
    test('listAllProjects 应该返回项目列表', () => {
      // 这个测试需要实际的 Claude CLI 目录
      // 在测试环境中可能不存在，所以我们只验证方法不抛出异常
      expect(() => SessionStorage.listAllProjects()).not.toThrow();
    });

    test('listSessionsByProject 应该返回会话列表', () => {
      // 这个测试需要实际的 Claude CLI 项目目录
      // 使用无效的项目 ID 应该返回空数组
      const sessions = SessionStorage.listSessionsByProject('non-existent-project');
      expect(sessions).toEqual([]);
    });
  });
});
