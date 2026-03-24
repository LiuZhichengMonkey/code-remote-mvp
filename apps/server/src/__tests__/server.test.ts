/**
 * WebSocket Server 集成测试
 */

import { WebSocket } from 'ws';
import { CodeRemoteServer } from '../server';

describe('CodeRemoteServer', () => {
  let server: CodeRemoteServer;
  let port: number;
  let token: string;

  beforeAll((done) => {
    // 使用随机端口
    port = 18080 + Math.floor(Math.random() * 1000);
    server = new CodeRemoteServer(port);
    token = server.getToken();
    setTimeout(done, 100);
  });

  afterAll((done) => {
    server.close();
    setTimeout(done, 100);
  });

  describe('服务器启动', () => {
    test('应该返回正确的地址', () => {
      expect(server.getAddress()).toBe(`ws://localhost:${port}`);
    });

    test('应该返回 token', () => {
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    test('初始客户端列表应为空', () => {
      const clients = server.getConnectedClients();
      expect(clients).toEqual([]);
    });
  });

  describe('WebSocket 连接', () => {
    let client: WebSocket;

    afterEach(() => {
      if (client && client.readyState !== WebSocket.CLOSED) {
        client.close();
      }
    });

    test('应该拒绝无效 token', (done) => {
      client = new WebSocket(`ws://localhost:${port}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: 'invalid-token'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('auth_failed');
        done();
      });
    });

    test('应该接受有效 token', (done) => {
      client = new WebSocket(`ws://localhost:${port}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          expect(msg.clientId).toBeDefined();
          expect(msg.timestamp).toBeDefined();
          done();
        }
      });
    });

    test('认证后应出现在客户端列表', (done) => {
      client = new WebSocket(`ws://localhost:${port}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          setTimeout(() => {
            const clients = server.getConnectedClients();
            expect(clients.length).toBe(1);
            expect(clients[0].id).toBe(msg.clientId);
            done();
          }, 50);
        }
      });
    });

    test('断开连接后应从客户端列表移除', (done) => {
      client = new WebSocket(`ws://localhost:${port}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          client.close();
        }
      });

      client.on('close', () => {
        setTimeout(() => {
          const clients = server.getConnectedClients();
          expect(clients.length).toBe(0);
          done();
        }, 100);
      });
    });
  });

  describe('消息处理', () => {
    let client: WebSocket;

    beforeEach((done) => {
      client = new WebSocket(`ws://localhost:${port}`);
      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
        done();
      });
    });

    afterEach(() => {
      if (client && client.readyState !== WebSocket.CLOSED) {
        client.close();
      }
    });

    test('未认证应返回错误', (done) => {
      const unauthenticatedClient = new WebSocket(`ws://localhost:${port}`);

      unauthenticatedClient.on('open', () => {
        unauthenticatedClient.send(JSON.stringify({
          type: 'message',
          content: 'test'
        }));
      });

      unauthenticatedClient.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('error');
        expect(msg.content).toContain('authenticated');
        unauthenticatedClient.close();
        done();
      });
    });

    test('未知消息类型应返回错误', (done) => {
      let authComplete = false;

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth_success') {
          authComplete = true;
          client.send(JSON.stringify({
            type: 'unknown_type'
          }));
        } else if (authComplete && msg.type === 'error') {
          expect(msg.content).toContain('Unknown');
          done();
        }
      });
    });

    test('keepalive 搴旇琚畨闈欏拷鐣?', (done) => {
      let authComplete = false;
      let receivedError = false;

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth_success') {
          authComplete = true;
          client.send(JSON.stringify({
            type: 'keepalive',
            reason: 'test'
          }));

          setTimeout(() => {
            expect(authComplete).toBe(true);
            expect(receivedError).toBe(false);
            expect(client.readyState).toBe(WebSocket.OPEN);
            done();
          }, 50);
        } else if (authComplete && msg.type === 'error') {
          receivedError = true;
        }
      });
    });
  });

  describe('sendToClient', () => {
    test('应该发送消息给指定客户端', (done) => {
      const client = new WebSocket(`ws://localhost:${port}`);
      let clientId: string;

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth_success') {
          clientId = msg.clientId;

          // 从服务器发送消息
          setTimeout(() => {
            const sent = server.sendToClient(clientId, 'Test message from server');
            expect(sent).toBe(true);
          }, 50);
        } else if (msg.type === 'message') {
          expect(msg.content).toBe('Test message from server');
          client.close();
          done();
        }
      });
    });

    test('发送给不存在的客户端应返回 false', () => {
      const result = server.sendToClient('non-existent-client', 'test');
      expect(result).toBe(false);
    });
  });

  describe('broadcast', () => {
    test('应该广播给所有认证客户端', (done) => {
      const clients: WebSocket[] = [];
      let received = 0;

      // 创建两个客户端
      for (let i = 0; i < 2; i++) {
        const client = new WebSocket(`ws://localhost:${port}`);
        clients.push(client);

        client.on('open', () => {
          client.send(JSON.stringify({
            type: 'auth',
            token: token
          }));
        });

        client.on('message', (data) => {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'auth_success' && msg.clientId) {
            // 等待两个客户端都连接
            if (clients.every(c => c.readyState === WebSocket.OPEN)) {
              setTimeout(() => {
                server.broadcast('Broadcast message');
              }, 100);
            }
          } else if (msg.type === 'message' && msg.content === 'Broadcast message') {
            received++;
            if (received === 2) {
              clients.forEach(c => c.close());
              done();
            }
          }
        });
      }
    });
  });

  describe('事件处理器', () => {
    test('onConnection 应该被调用', (done) => {
      const connectionHandler = jest.fn();
      server.onConnection(connectionHandler);

      const client = new WebSocket(`ws://localhost:${port}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          setTimeout(() => {
            expect(connectionHandler).toHaveBeenCalled();
            client.close();
            done();
          }, 50);
        }
      });
    });

    test('onDisconnection 应该被调用', (done) => {
      const disconnectHandler = jest.fn();
      server.onDisconnection(disconnectHandler);

      const client = new WebSocket(`ws://localhost:${port}`);

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          client.close();
        }
      });

      client.on('close', () => {
        setTimeout(() => {
          expect(disconnectHandler).toHaveBeenCalled();
          done();
        }, 100);
      });
    });
  });

  describe('HTTP 端点', () => {
    test('/health 应该返回状态', async () => {
      const response = await fetch(`http://localhost:${port}/health`);
      const data = await response.json() as { status: string; clients: number };

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.clients).toBeDefined();
    });
  });
});
