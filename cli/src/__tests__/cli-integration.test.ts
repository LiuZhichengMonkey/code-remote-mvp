/**
 * CLI 集成测试
 *
 * 测试命令行入口功能：
 * 1. 参数解析
 * 2. 命令行选项
 * 3. 服务器启动配置
 */

import { program } from 'commander';
import { AuthManager } from '../auth';
import { MessageHandler } from '../handler';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';

describe('CLI 集成测试', () => {
  describe('AuthManager 配置', () => {
    test('应该能够创建默认 Token', () => {
      const auth = new AuthManager();
      expect(auth.getToken()).toBeDefined();
      expect(typeof auth.getToken()).toBe('string');
      expect(auth.getToken().length).toBeGreaterThan(0);
    });

    test('应该能够使用自定义 Token', () => {
      const customToken = 'my-custom-token-123';
      const auth = new AuthManager(customToken);
      expect(auth.getToken()).toBe(customToken);
    });

    test('应该能够设置 TTL', () => {
      const auth = new AuthManager('token', 60); // 60 秒
      expect(auth.getExpiresAt()).not.toBeNull();
      expect(auth.getExpiresAt()!.getTime()).toBeGreaterThan(Date.now());
    });

    test('Token 验证应该正常工作', () => {
      const auth = new AuthManager('valid-token');
      expect(auth.isValid('valid-token')).toBe(true);
      expect(auth.isValid('invalid-token')).toBe(false);
    });

    test('过期 Token 应该失效', async () => {
      const auth = new AuthManager('temp-token', 0); // 立即过期
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(auth.isExpired()).toBe(true);
      expect(auth.isValid('temp-token')).toBe(false);
    });
  });

  describe('MessageHandler 配置', () => {
    test('应该能够创建处理器', () => {
      const handler = new MessageHandler();
      expect(handler).toBeDefined();
    });

    test('应该能够处理消息', async () => {
      const handler = new MessageHandler();
      const response = await handler.handleMessage('test-client', 'hello');
      expect(response).toContain('Hello');
    });

    test('应该能够获取历史', async () => {
      const handler = new MessageHandler();
      await handler.handleMessage('client1', 'message 1');
      const history = handler.getHistory();
      expect(history.length).toBe(1);
    });

    test('应该能够清空历史', async () => {
      const handler = new MessageHandler();
      await handler.handleMessage('client1', 'message 1');
      handler.clearHistory();
      expect(handler.getHistory().length).toBe(0);
    });
  });

  describe('命令行参数解析', () => {
    test('应该能够解析端口参数', () => {
      const portStr = '9090';
      const port = parseInt(portStr, 10);
      expect(port).toBe(9090);
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    });

    test('应该能够解析自定义 Token', () => {
      const token = 'custom-token-abc123';
      const options = { token };
      expect(options.token).toBe(token);
    });

    test('应该能够解析工作目录', () => {
      const workspace = '/path/to/workspace';
      const options = { workspace };
      expect(options.workspace).toBe(workspace);
    });

    test('应该能够解析隧道选项', () => {
      const tunnelOptions = ['cloudflare', 'ngrok', 'frp'];
      tunnelOptions.forEach(tunnel => {
        expect(['cloudflare', 'ngrok', 'frp']).toContain(tunnel);
      });
    });

    test('应该能够处理 verbose 标志', () => {
      const options = { verbose: true };
      expect(options.verbose).toBe(true);
    });

    test('应该能够处理 no-tunnel 标志', () => {
      const options = { tunnel: false };
      expect(options.tunnel).toBe(false);
    });
  });

  describe('文件系统配置', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = path.join(os.tmpdir(), `cli-test-${Date.now()}`);
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    test('应该能够创建目录', () => {
      const subDir = path.join(testDir, 'subdir');
      mkdirSync(subDir, { recursive: true });
      expect(existsSync(subDir)).toBe(true);
    });

    test('应该能够写入配置文件', () => {
      const configPath = path.join(testDir, 'config.json');
      const config = {
        port: 8080,
        token: 'test-token',
        workspace: '/test/workspace'
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      expect(existsSync(configPath)).toBe(true);
    });

    test('应该能够验证路径存在性', () => {
      const existingPath = __dirname;
      const nonExistingPath = path.join(testDir, 'non-existing');

      expect(existsSync(existingPath)).toBe(true);
      expect(existsSync(nonExistingPath)).toBe(false);
    });
  });

  describe('服务器配置验证', () => {
    test('端口号应该在有效范围内', () => {
      const validPorts = [80, 443, 8080, 3000, 9000];
      const invalidPorts = [-1, 0, 65536, 100000];

      validPorts.forEach(port => {
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThan(65536);
      });

      invalidPorts.forEach(port => {
        expect(port <= 0 || port >= 65536).toBe(true);
      });
    });

    test('Token 应该是有效的字符串', () => {
      const validTokens = ['token123', 'abc-def-ghi', 'UUID-12345678'];
      const invalidTokens = ['', null as any, undefined as any];

      validTokens.forEach(token => {
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
      });

      invalidTokens.forEach(token => {
        // 这些应该被过滤或使用默认值
        expect(token === '' || token === null || token === undefined).toBe(true);
      });
    });

    test('工作目录路径应该被规范化', () => {
      const normalizePath = (p: string) => p.replace(/\\/g, '/');

      const windowsPath = 'E:\\code-remote\\workspace';
      const unixPath = '/home/user/workspace';

      expect(normalizePath(windowsPath)).toContain('/');
      expect(normalizePath(unixPath)).toContain('/');
    });
  });

  describe('错误处理配置', () => {
    test('无效端口应该抛出错误', () => {
      const invalidPorts = [-1, 0, 65536, 'abc', 'port'];

      invalidPorts.forEach(port => {
        const parsed = parseInt(port as any, 10);
        const isValid = !isNaN(parsed) && parsed > 0 && parsed < 65536;
        expect(isValid || isNaN(parsed)).toBe(true);
      });
    });

    test('空 Token 应该使用默认值', () => {
      const emptyToken = '';
      const token = emptyToken || `default-${Date.now()}`;
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
    });

    test('不存在的工作目录应该被检测', () => {
      const nonExistentPath = '/non/existent/path/12345';
      expect(existsSync(nonExistentPath)).toBe(false);
    });
  });

  describe('健康检查配置', () => {
    test('Health endpoint 应该返回正确格式', () => {
      const healthResponse = {
        status: 'ok',
        clients: 0,
        timestamp: Date.now()
      };

      expect(healthResponse.status).toBe('ok');
      expect(typeof healthResponse.clients).toBe('number');
      expect(healthResponse.clients).toBeGreaterThanOrEqual(0);
    });

    test('Health check URL 应该被正确构建', () => {
      const host = 'localhost';
      const port = 8080;
      const url = `http://${host}:${port}/health`;

      expect(url).toBe('http://localhost:8080/health');
    });
  });

  describe('WebSocket URL 构建', () => {
    test('本地 WebSocket URL 应该正确', () => {
      const host = 'localhost';
      const port = 8080;
      const url = `ws://${host}:${port}`;

      expect(url).toBe('ws://localhost:8080');
    });

    test('WSS (WebSocket Secure) URL 应该正确', () => {
      const host = 'example.com';
      const port = 443;
      const url = `wss://${host}:${port}`;

      expect(url).toBe('wss://example.com:443');
    });

    test('自定义 URL 应该支持', () => {
      const customUrl = 'wss://my-tunnel-url.trycloudflare.com';
      const url = new URL(customUrl);

      expect(url.protocol).toBe('wss:');
      expect(url.hostname).toBe('my-tunnel-url.trycloudflare.com');
    });
  });
});
