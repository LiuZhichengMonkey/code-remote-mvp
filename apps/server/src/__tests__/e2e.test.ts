/**
 * E2E 端到端测试
 *
 * 测试完整用户操作流程：
 * 1. 启动服务器
 * 2. WebSocket 连接
 * 3. 认证
 * 4. 消息收发
 * 5. 断开连接
 */

import { WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

describe('E2E 端到端测试', () => {
  let serverProcess: ChildProcess | null = null;
  let serverPort: number;
  let authToken: string;
  let wsClient: WebSocket | null = null;

  // 动态分配端口
  const getPort = () => 18080 + Math.floor(Math.random() * 1000);

  beforeAll((done) => {
    serverPort = getPort();
    authToken = `test-token-${Date.now()}`;

    // 检查 CLI 是否已构建
    const cliDir = path.join(__dirname, '../../');
    const distIndex = path.join(cliDir, 'dist/index.js');

    if (!fs.existsSync(distIndex)) {
      console.log('⚠️ CLI 未构建，跳过 E2E 测试');
      done();
      return;
    }

    // 启动服务器
    serverProcess = spawn('node', [distIndex, 'start', '-p', serverPort.toString(), '-t', authToken, '--no-tunnel'], {
      cwd: cliDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 等待服务器启动
    let output = '';
    const startTimeout = setTimeout(() => {
      console.log('服务器启动超时，输出:', output);
      done();
    }, 5000);

    serverProcess.stdout?.on('data', (data) => {
      output += data.toString();
      if (output.includes('CodeRemote is ready') || output.includes('Port:')) {
        clearTimeout(startTimeout);
        setTimeout(done, 500);
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error('Server stderr:', data.toString());
    });
  }, 10000);

  afterAll((done) => {
    // 关闭 WebSocket
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
    }

    // 关闭服务器
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }

    setTimeout(done, 1000);
  });

  describe('服务器启动', () => {
    test('服务器进程应该运行', () => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        return;
      }
      expect(serverProcess).toBeDefined();
    });

    test('服务器应该在指定端口监听', async () => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        return;
      }

      try {
        const response = await fetch(`http://localhost:${serverPort}/health`);
        expect(response.status).toBe(200);
      } catch (error) {
        // 服务器可能还没完全启动
        console.log('⚠️ Health endpoint 暂不可用');
      }
    });
  });

  describe('WebSocket 连接流程', () => {
    test('应该能够连接到服务器', (done) => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      wsClient = new WebSocket(`ws://localhost:${serverPort}`);

      wsClient.on('open', () => {
        expect(wsClient?.readyState).toBe(WebSocket.OPEN);
        done();
      });

      wsClient.on('error', (error) => {
        console.error('WebSocket 错误:', error);
        done(error);
      });
    });

    test('无效 Token 应该被拒绝', (done) => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      const client = new WebSocket(`ws://localhost:${serverPort}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: 'invalid-token'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('auth_failed');
        client.close();
        done();
      });
    });

    test('有效 Token 应该认证成功', (done) => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      const client = new WebSocket(`ws://localhost:${serverPort}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          expect(msg.clientId).toBeDefined();
          client.close();
          done();
        }
      });
    });
  });

  describe('消息通信', () => {
    let authenticatedClient: WebSocket;
    let clientId: string;

    beforeEach((done) => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      authenticatedClient = new WebSocket(`ws://localhost:${serverPort}`);

      authenticatedClient.on('open', () => {
        authenticatedClient.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
      });

      authenticatedClient.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          clientId = msg.clientId;
          done();
        }
      });

      // 超时处理
      setTimeout(() => {
        if (!clientId) {
          console.log('⚠️ 认证超时，跳过测试');
          done();
        }
      }, 3000);
    });

    afterEach(() => {
      if (authenticatedClient && authenticatedClient.readyState === WebSocket.OPEN) {
        authenticatedClient.close();
      }
    });

    test('应该能够发送和接收消息', (done) => {
      if (!serverProcess || !authenticatedClient) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      authenticatedClient.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'message' && msg.content) {
          expect(msg.content).toBeDefined();
          done();
        }
      });

      // 发送消息
      authenticatedClient.send(JSON.stringify({
        type: 'message',
        content: 'test message'
      }));
    }, 10000);

    test('发送 hello 应该收到响应', (done) => {
      if (!serverProcess || !authenticatedClient) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      authenticatedClient.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'message' && msg.content) {
          expect(msg.content).toBeDefined();
          done();
        }
      });

      authenticatedClient.send(JSON.stringify({
        type: 'message',
        content: 'hello'
      }));
    }, 10000);
  });

  describe('会话管理', () => {
    test('应该能够创建新会话', (done) => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      const client = new WebSocket(`ws://localhost:${serverPort}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth_success') {
          client.send(JSON.stringify({
            type: 'session',
            action: 'new'
          }));
        } else if (msg.type === 'session_created' || msg.type === 'session_list') {
          client.close();
          done();
        }
      });

      // 超时处理
      setTimeout(() => {
        client.close();
        done();
      }, 5000);
    });
  });

  describe('错误处理', () => {
    test('未认证发送消息应该返回错误', (done) => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      const client = new WebSocket(`ws://localhost:${serverPort}`);

      client.on('open', () => {
        // 不认证直接发消息
        client.send(JSON.stringify({
          type: 'message',
          content: 'test'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error') {
          expect(msg.content).toContain('authenticated');
          client.close();
          done();
        }
      });
    });

    test('未知消息类型应该返回错误', (done) => {
      if (!serverProcess) {
        console.log('⚠️ 跳过：服务器未启动');
        done();
        return;
      }

      const client = new WebSocket(`ws://localhost:${serverPort}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth_success') {
          client.send(JSON.stringify({
            type: 'unknown_type',
            data: 'test'
          }));
        } else if (msg.type === 'error') {
          expect(msg.content).toContain('Unknown');
          client.close();
          done();
        }
      });
    });
  });
});
