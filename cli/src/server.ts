import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync } from 'fs';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { ImageSuccessResponse, ImageErrorResponse } from './types/image';
import { ClaudeHandler } from './handlers/claude';

export interface Client {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  connectedAt: Date;
  imageTransfer?: {
    inProgress: boolean;
    meta: import('./types/image').ImageMeta | null;
    startTime: number;
  } | undefined;
}

export interface ServerMessage {
  type: 'auth_success' | 'auth_failed' | 'message' | 'error' | 'pong';
  clientId?: string;
  content?: string;
  timestamp?: number;
}

export interface ClientMessage {
  type: 'auth' | 'message' | 'ping' | 'image_meta' | 'claude' | 'session';
  token?: string;
  content?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  timestamp?: number;
  action?: 'new' | 'resume' | 'list' | 'delete' | 'list_projects' | 'list_by_project' | 'rename';
  sessionId?: string;
  projectId?: string;
  title?: string;
  stream?: boolean;
}

export class CodeRemoteServer {
  private wss: WebSocketServer;
  private httpServer: ReturnType<typeof createServer>;
  private clients: Map<string, Client> = new Map();
  private token: string;
  private port: number;
  private messageHandler?: (clientId: string, content: string) => void;
  private connectionHandler?: (clientId: string) => void;
  private disconnectHandler?: (clientId: string) => void;
  private claudeHandler: ClaudeHandler;
  private workspaceRoot: string;
  private staticPath?: string;
  private imageConfig = {
    savePath: 'E:/CodeRemote/Uploads',
    maxSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: ['*'], // 允许所有文件类型
    createDirectory: true
  };

  constructor(port: number = 8080, token?: string, workspaceRoot?: string, staticPath?: string) {
    this.port = port;
    this.token = token || uuidv4();
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.staticPath = staticPath;
    this.claudeHandler = new ClaudeHandler(this.workspaceRoot);

    // Create HTTP server for static files and WebSocket
    this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupServer();
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
      return;
    }

    // Serve static files if staticPath is configured
    if (this.staticPath && req.url) {
      let filePath = req.url === '/' ? '/index.html' : req.url;
      const fullPath = join(this.staticPath, filePath);

      if (existsSync(fullPath)) {
        const ext = extname(fullPath);
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        const { createReadStream } = require('fs');
        createReadStream(fullPath).pipe(res);
        return;
      }
    }

    // 404 for other requests
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private setupServer() {
    this.httpServer.listen(this.port, () => {
      console.log(chalk.green('✓'), chalk.bold('CodeRemote Server Started'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Port:      ${chalk.cyan(this.port)}`);
      console.log(`  Token:     ${chalk.yellow(this.token)}`);
      console.log(`  WebSocket: ${chalk.cyan(`ws://localhost:${this.port}`)}`);
      if (this.staticPath) {
        console.log(`  HTTP:      ${chalk.cyan(`http://localhost:${this.port}`)}`);
        console.log(`  Static:    ${chalk.gray(this.staticPath)}`);
      }
      console.log(chalk.gray('─'.repeat(50)));
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientIp = req.socket.remoteAddress || 'unknown';
      console.log(chalk.blue('→'), `New connection from ${clientIp}`);

      // Ping/Pong for connection health
      let pingInterval: NodeJS.Timeout;
      let isAlive = true;

      ws.on('pong', () => {
        isAlive = true;
      });

      pingInterval = setInterval(() => {
        if (!isAlive) {
          ws.terminate();
          return;
        }
        isAlive = false;
        ws.ping();
      }, 30000);

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          this.handleBinaryMessage(ws, data);
        } else {
          try {
            const message: ClientMessage = JSON.parse(data.toString());
            this.handleMessage(ws, message, pingInterval);
          } catch (error) {
            this.sendError(ws, 'Invalid message format');
          }
        }
      });

      ws.on('close', () => {
        clearInterval(pingInterval);
        this.handleDisconnection(ws);
        console.log(chalk.red('×'), `Client disconnected from ${clientIp}`);
      });

      ws.on('error', (error) => {
        console.error(chalk.red('Error:'), error.message);
      });
    });

    this.wss.on('error', (error) => {
      if ((error as any).code === 'EADDRINUSE') {
        console.error(chalk.red('Error:'), `Port ${this.port} is already in use`);
        console.error(chalk.yellow('Hint:'), `Try a different port with --port <number>`);
        process.exit(1);
      }
    });
  }

  private handleMessage(ws: WebSocket, message: ClientMessage, pingInterval?: NodeJS.Timeout) {
    switch (message.type) {
      case 'auth':
        this.handleAuth(ws, message.token, pingInterval);
        break;

      case 'message':
        // Treat as claude message for chat-ui compatibility
        this.handleClaudeMessage(ws, message);
        break;

      case 'claude':
        this.handleClaudeMessage(ws, message);
        break;

      case 'session':
        this.handleSessionAction(ws, message);
        break;

      case 'image_meta':
        this.handleImageMeta(ws, message);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleAuth(ws: WebSocket, token?: string, pingInterval?: NodeJS.Timeout) {
    if (token === this.token) {
      const clientId = uuidv4();
      const client: Client = {
        id: clientId,
        ws,
        authenticated: true,
        connectedAt: new Date()
      };
      this.clients.set(clientId, client);

      // Clear ping interval for authenticated connections (let client manage)
      if (pingInterval) clearInterval(pingInterval);

      const response: ServerMessage = {
        type: 'auth_success',
        clientId,
        timestamp: Date.now()
      };
      ws.send(JSON.stringify(response));

      console.log(chalk.green('✓'), `Client ${chalk.cyan(clientId)} authenticated`);

      if (this.connectionHandler) {
        this.connectionHandler(clientId);
      }
    } else {
      const response: ServerMessage = { type: 'auth_failed' };
      ws.send(JSON.stringify(response));
      console.log(chalk.red('✗'), 'Authentication failed - invalid token');
      ws.close();
    }
  }

  private handleClientMessage(ws: WebSocket, content?: string) {
    // Find client by ws
    let clientId: string | null = null;
    for (const [id, client] of this.clients) {
      if (client.ws === ws) {
        clientId = id;
        break;
      }
    }

    if (!clientId || !this.clients.get(clientId)?.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    if (this.messageHandler && content) {
      this.messageHandler(clientId, content);
    }

    // Echo for MVP - in real app, this would process with Claude Code
    console.log(chalk.blue('Message:'), content);
  }

  private handleClaudeMessage(ws: WebSocket, message: ClientMessage) {
    // Find client
    let clientId: string | null = null;
    for (const [id, c] of this.clients) {
      if (c.ws === ws) {
        clientId = id;
        break;
      }
    }

    if (!clientId || !this.clients.get(clientId)?.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    const content = message.content || '';
    const sessionId = message.sessionId;
    const projectId = message.projectId;

    // Debug logging
    console.log(chalk.magenta('🤖'), `Claude request received:`);
    console.log(chalk.gray('   Content:'), content.substring(0, 100));
    console.log(chalk.gray('   SessionId:'), sessionId);
    console.log(chalk.gray('   ProjectId:'), projectId || '(none)');
    console.log(chalk.gray('   ClientId:'), clientId);

    this.claudeHandler.handleClaudeMessage(
      ws,
      content,
      (code, errorMsg) => {
        console.log(chalk.red('✗'), `Claude error: ${errorMsg}`);
        ws.send(JSON.stringify({
          type: 'claude_error',
          error: errorMsg,
          code,
          timestamp: Date.now()
        }));
      },
      sessionId,
      projectId
    );
  }

  private handleSessionAction(ws: WebSocket, message: ClientMessage) {
    // Find client
    let clientId: string | null = null;
    for (const [id, c] of this.clients) {
      if (c.ws === ws) {
        clientId = id;
        break;
      }
    }

    if (!clientId || !this.clients.get(clientId)?.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    this.claudeHandler.handleSessionAction(
      ws,
      (message.action || 'list') as any,
      message.sessionId,
      message.projectId,
      message.title
    );
  }

  private handleImageMeta(ws: WebSocket, message: ClientMessage) {
    // Find client
    let client: Client | null = null;
    for (const [id, c] of this.clients) {
      if (c.ws === ws) {
        client = c;
        break;
      }
    }

    if (!client || !client.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    // Set image transfer state
    client.imageTransfer = {
      inProgress: true,
      meta: {
        fileName: message.fileName!,
        mimeType: message.mimeType!,
        size: message.size!,
        timestamp: message.timestamp || Date.now()
      },
      startTime: Date.now()
    };

    console.log(chalk.yellow('📁'), `准备接收文件: ${message.fileName} (${(message.size! / 1024).toFixed(1)} KB)`);
    console.log(chalk.gray('   MIME类型:'), message.mimeType);
  }

  private handleDisconnection(ws: WebSocket) {
    let clientId: string | null = null;
    for (const [id, client] of this.clients) {
      if (client.ws === ws) {
        clientId = id;
        break;
      }
    }

    if (clientId) {
      this.clients.delete(clientId);
      if (this.disconnectHandler) {
        this.disconnectHandler(clientId);
      }
    }
  }

  private async handleBinaryMessage(ws: WebSocket, data: Buffer) {
    // Find client
    let client: Client | null = null;
    let clientId: string | null = null;
    for (const [id, c] of this.clients) {
      if (c.ws === ws) {
        client = c;
        clientId = id;
        break;
      }
    }

    if (!client || !client.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    if (!client.imageTransfer?.inProgress || !client.imageTransfer?.meta) {
      this.sendError(ws, '协议错误：未预期的二进制数据');
      return;
    }

    try {
      const { ImageHandler } = await import('./imageHandler');
      const imageHandler = new ImageHandler(this.imageConfig);

      const savedPath = await imageHandler.handleImage(
        clientId!,
        data,
        client.imageTransfer.meta
      );

      const response: ImageSuccessResponse = {
        type: 'image_saved',
        path: savedPath,
        timestamp: Date.now()
      };

      client.ws.send(JSON.stringify(response));
      console.log(chalk.green('✓'), `文件已保存: ${savedPath}`);

      // Reset transfer state
      client.imageTransfer = undefined;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorResponse: ImageErrorResponse = {
        type: 'image_error',
        error: errorMsg,
        code: this.getErrorCode(errorMsg),
        timestamp: Date.now()
      };

      client.ws.send(JSON.stringify(errorResponse));
      console.log(chalk.red('✗'), `图片处理失败: ${errorMsg}`);

      client.imageTransfer = undefined;
    }
  }

  private getErrorCode(message: string): 'TOO_LARGE' | 'INVALID_TYPE' | 'TIMEOUT' | 'DISK_FULL' | 'PROTOCOL_ERROR' {
    if (message.includes('图片过大')) return 'TOO_LARGE';
    if (message.includes('不支持的文件类型')) return 'INVALID_TYPE';
    if (message.includes('磁盘空间')) return 'DISK_FULL';
    return 'PROTOCOL_ERROR';
  }

  private sendError(ws: WebSocket, message: string) {
    const response: ServerMessage = {
      type: 'error',
      content: message,
      timestamp: Date.now()
    };
    try {
      ws.send(JSON.stringify(response));
    } catch (e) {
      // Ignore - connection might be closed
    }
  }

  // Public API
  onMessage(handler: (clientId: string, content: string) => void) {
    this.messageHandler = handler;
  }

  onConnection(handler: (clientId: string) => void) {
    this.connectionHandler = handler;
  }

  onDisconnection(handler: (clientId: string) => void) {
    this.disconnectHandler = handler;
  }

  sendToClient(clientId: string, content: string) {
    const client = this.clients.get(clientId);
    if (client && client.authenticated) {
      const message: ServerMessage = {
        type: 'message',
        content,
        timestamp: Date.now()
      };
      try {
        client.ws.send(JSON.stringify(message));
        return true;
      } catch (e) {
        console.error(chalk.red('Error sending to client:'), e);
        this.clients.delete(clientId);
        return false;
      }
    }
    return false;
  }

  broadcast(message: string) {
    const response: ServerMessage = {
      type: 'message',
      content: message,
      timestamp: Date.now()
    };
    const messageStr = JSON.stringify(response);

    for (const [clientId, client] of this.clients) {
      if (client.authenticated) {
        try {
          client.ws.send(messageStr);
        } catch (e) {
          console.error(chalk.red('Error broadcasting to'), clientId);
          this.clients.delete(clientId);
        }
      }
    }
  }

  getToken() {
    return this.token;
  }

  getAddress() {
    return `ws://localhost:${this.port}`;
  }

  getConnectedClients() {
    return Array.from(this.clients.values())
      .filter(c => c.authenticated)
      .map(c => ({
        id: c.id,
        connectedAt: c.connectedAt
      }));
  }

  async sendImageToClient(clientId: string, imagePath: string): Promise<boolean> {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      return false;
    }

    try {
      const { ImageHandler } = await import('./imageHandler');
      const imageHandler = new ImageHandler(this.imageConfig);

      const { buffer, meta } = await imageHandler.loadImage(imagePath);

      // Send metadata
      client.ws.send(JSON.stringify({
        type: 'image_meta',
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        size: meta.size,
        timestamp: Date.now()
      }));

      // Send binary data
      client.ws.send(buffer);

      console.log(chalk.yellow('📷'), `发送图片到客户端 ${clientId}: ${meta.fileName}`);
      return true;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red('发送图片失败:'), errorMsg);
      return false;
    }
  }

  close() {
    // Close all client connections
    for (const [clientId, client] of this.clients) {
      try {
        client.ws.close();
      } catch (e) {
        // Ignore
      }
    }
    this.clients.clear();

    // Close WebSocket server
    this.wss.close();

    // Close HTTP server
    this.httpServer.close();
    console.log(chalk.yellow('→'), 'Server closed');
  }
}
