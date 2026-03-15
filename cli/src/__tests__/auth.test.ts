/**
 * AuthManager 单元测试
 */

import { AuthManager } from '../auth';

describe('AuthManager', () => {
  let authManager: AuthManager;

  describe('without TTL', () => {
    beforeEach(() => {
      authManager = new AuthManager();
    });

    test('应该生成有效的 token', () => {
      const token = authManager.getToken();
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    test('应该验证正确的 token', () => {
      const token = authManager.getToken();
      expect(authManager.isValid(token)).toBe(true);
    });

    test('应该拒绝错误的 token', () => {
      expect(authManager.isValid('wrong-token')).toBe(false);
    });

    test('应该永不过期', () => {
      expect(authManager.isExpired()).toBe(false);
      expect(authManager.getExpiresAt()).toBeNull();
    });

    test('refresh 应该生成新的 token', () => {
      const oldToken = authManager.getToken();
      authManager.refresh();
      const newToken = authManager.getToken();
      expect(newToken).not.toBe(oldToken);
      expect(authManager.isValid(oldToken)).toBe(false);
      expect(authManager.isValid(newToken)).toBe(true);
    });
  });

  describe('with TTL', () => {
    beforeEach(() => {
      // 1 秒 TTL
      authManager = new AuthManager('test-token', 1);
    });

    test('应该使用提供的 token', () => {
      expect(authManager.getToken()).toBe('test-token');
    });

    test('应该设置过期时间', () => {
      const expiresAt = authManager.getExpiresAt();
      expect(expiresAt).not.toBeNull();
      expect(expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    test('应该在过期后失效', async () => {
      expect(authManager.isValid('test-token')).toBe(true);
      expect(authManager.isExpired()).toBe(false);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(authManager.isExpired()).toBe(true);
      expect(authManager.isValid('test-token')).toBe(false);
    });

    test('refresh 应该保持 TTL', async () => {
      authManager.refresh();
      const newToken = authManager.getToken();
      expect(newToken).not.toBe('test-token');
      expect(authManager.isValid(newToken)).toBe(true);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(authManager.isExpired()).toBe(true);
    });
  });

  describe('displayInfo', () => {
    test('应该正常输出信息（不抛出错误）', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      authManager = new AuthManager('my-token');
      authManager.displayInfo();

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.flat().join(' ');
      expect(output).toContain('my-token');

      consoleSpy.mockRestore();
    });
  });
});
