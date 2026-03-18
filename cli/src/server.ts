import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { ImageSuccessResponse, ImageErrorResponse } from './types/image';
import { ClaudeHandler } from './handlers/claude';
import { DiscussionHandler, DiscussionRequest } from './handlers/discussion';

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
  type: 'auth_success' | 'auth_failed' | 'message' | 'error';
  clientId?: string;
  content?: string;
  timestamp?: number;
}

export interface ClientMessage {
  type: 'auth' | 'message' | 'image_meta' | 'claude' | 'session' | 'stop' | 'discussion' | 'discussion_get_pending' | 'session_focus' | 'settings';
  token?: string;
  content?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  timestamp?: number;
  action?: 'new' | 'resume' | 'list' | 'delete' | 'list_projects' | 'list_by_project' | 'rename' | 'load_more' | 'list' | 'switch' | 'save';
  settingsName?: string;
  envDetails?: {
    ANTHROPIC_BASE_URL?: string;
    ANTHROPIC_AUTH_TOKEN?: string;
    ANTHROPIC_MODEL?: string;
  };
  sessionId?: string;
  projectId?: string;
  title?: string;
  stream?: boolean;
  limit?: number;      // 分页：每次加载的消息数量
  beforeIndex?: number; // 分页：从哪条消息开始加载
  // 附件（图片）
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    data: string;  // base64 encoded
  }>;
  // 讨论配置
  config?: {
    maxRounds?: number;
    messageTimeout?: number;
  };
  llmEnabled?: boolean;
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
  private discussionHandler: DiscussionHandler;
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
    this.discussionHandler = new DiscussionHandler();
    // 将 ClaudeHandler 的 SessionManager 传递给 DiscussionHandler 用于持久化讨论消息
    this.discussionHandler.setSessionManager(this.claudeHandler.getSessionManager());

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

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        // DEBUG: 记录原始消息的完整信息
        const dataStr = data.toString();
        console.log(chalk.cyan('[DEBUG]'), `=== WS MESSAGE ===`);
        console.log(chalk.cyan('[DEBUG]'), `Total data length: ${data.length}`);
        console.log(chalk.cyan('[DEBUG]'), `isBinary: ${isBinary}`);
        console.log(chalk.cyan('[DEBUG]'), `String length: ${dataStr.length}`);
        console.log(chalk.cyan('[DEBUG]'), `Full raw data:\n${dataStr}`);
        console.log(chalk.cyan('[DEBUG]'), `==================`);

        if (isBinary) {
          this.handleBinaryMessage(ws, data);
        } else {
          try {
            const message: ClientMessage = JSON.parse(dataStr);
            // DEBUG: 记录解析后的消息
            console.log(chalk.cyan('[DEBUG]'), `=== PARSED MESSAGE ===`);
            console.log(chalk.cyan('[DEBUG]'), `type: ${message.type}`);
            console.log(chalk.cyan('[DEBUG]'), `content: ${(message as any).content}`);
            console.log(chalk.cyan('[DEBUG]'), `content length: ${(message as any).content?.length || 0}`);
            console.log(chalk.cyan('[DEBUG]'), `==================`);
            this.handleMessage(ws, message);
          } catch (error) {
            console.error(chalk.red('[DEBUG]'), `JSON parse error:`, error);
            this.sendError(ws, 'Invalid message format');
          }
        }
      });

      ws.on('close', () => {
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

  private handleMessage(ws: WebSocket, message: ClientMessage) {
    switch (message.type) {
      case 'auth':
        this.handleAuth(ws, message.token);
        break;

      case 'message':
        // Treat as claude message for chat-ui compatibility
        this.handleClaudeMessage(ws, message);
        break;

      case 'claude':
        console.log(chalk.yellow('📎'), `Received claude message, attachments:`, message.attachments?.length || 0, '| content:', message.content?.substring(0, 30));
        this.handleClaudeMessage(ws, message);
        break;

      case 'session':
        this.handleSessionAction(ws, message);
        break;

      case 'image_meta':
        this.handleImageMeta(ws, message);
        break;

      case 'stop':
        // 停止指定的会话或所有运行中的 Claude CLI 进程
        console.log(chalk.yellow('⏹'), 'Received stop request', message.sessionId ? `for session: ${message.sessionId}` : '(all)');
        let stopped: boolean;
        if (message.sessionId) {
          // 停止特定会话
          stopped = this.claudeHandler.stopSession(message.sessionId);
        } else {
          // 停止所有
          stopped = this.claudeHandler.stop();
        }
        if (stopped) {
          ws.send(JSON.stringify({
            type: 'stopped',
            sessionId: message.sessionId,
            success: true,
            timestamp: Date.now()
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'stopped',
            sessionId: message.sessionId,
            success: false,
            error: 'No running process to stop',
            timestamp: Date.now()
          }));
        }
        break;

      case 'discussion':
        // 处理多智能体讨论请求
        console.log(chalk.magenta('💬'), 'Received discussion request');
        this.discussionHandler.handleRequest(ws, message as any as DiscussionRequest);
        break;

      case 'discussion_get_pending':
        // 前端请求缓存的讨论结果
        console.log(chalk.blue('[Discussion]'), 'Received request for pending results');
        this.discussionHandler.sendPendingResultsOnRequest(ws);
        break;

      case 'session_focus':
        // 前端切换会话时通知后端，用于优化后台会话的流式传输
        console.log(chalk.blue('🔍'), `Session focus changed to: ${message.sessionId || 'none'}`);
        this.claudeHandler.setActiveSession(message.sessionId || null);
        // 响应确认
        ws.send(JSON.stringify({
          type: 'session_focus_ack',
          sessionId: message.sessionId,
          timestamp: Date.now()
        }));
        break;

      case 'settings':
        // 获取或切换 settings 配置文件
        console.log(chalk.blue('[Settings]'), 'Received settings request, action:', (message as any).action);
        this.handleSettingsRequest(ws, message);
        break;

      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleSettingsRequest(ws: WebSocket, message: ClientMessage) {
    const action = (message as any).action || 'list';
    const claudeDir = path.join(os.homedir(), '.claude');

    if (action === 'list') {
      // 列出所有可用的 settings 配置文件
      try {
        const files = readdirSync(claudeDir).filter(f =>
          f.startsWith('settings_key') && f.endsWith('.json')
        );

        const settingsList = files.map(f => {
          const filePath = path.join(claudeDir, f);
          const content = readFileSync(filePath, 'utf-8');
          const config = JSON.parse(content);
          // 提取关键的 env 配置
          const envKeys = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'];
          const envDetails: Record<string, string> = {};
          if (config.env) {
            for (const key of envKeys) {
              if (config.env[key]) {
                envDetails[key] = config.env[key];
              }
            }
          }
          return {
            name: f.replace('.json', ''),
            // 提取一些关键配置用于显示
            model: config.model || 'default',
            env: config.env ? Object.keys(config.env).length : 0,
            // 添加具体的 env 值
            envDetails
          };
        });

        ws.send(JSON.stringify({
          type: 'settings_list',
          settings: settingsList,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to list settings:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          error: 'Failed to list settings',
          timestamp: Date.now()
        }));
      }
    } else if (action === 'switch') {
      // 切换到指定的 settings 配置文件
      const settingsName = (message as any).settingsName;
      if (!settingsName) {
        ws.send(JSON.stringify({
          type: 'settings_error',
          error: 'Missing settingsName',
          timestamp: Date.now()
        }));
        return;
      }

      const sourcePath = path.join(claudeDir, `${settingsName}.json`);
      const targetPath = path.join(claudeDir, 'settings.json');

      try {
        if (!existsSync(sourcePath)) {
          ws.send(JSON.stringify({
            type: 'settings_error',
            error: `Settings file not found: ${settingsName}`,
            timestamp: Date.now()
          }));
          return;
        }

        // 备份当前的 settings.json
        const backupPath = path.join(claudeDir, 'settings.json.backup');
        if (existsSync(targetPath)) {
          const currentContent = readFileSync(targetPath, 'utf-8');
          // 只有内容不同时才备份
          const newContent = readFileSync(sourcePath, 'utf-8');
          if (currentContent !== newContent) {
            // 读取当前文件时间戳作为备份文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const timedBackup = path.join(claudeDir, `settings.json.${timestamp}.backup`);
            // 不再创建带时间戳的备份，直接复制当前 settings.json
            // 这里简单处理：复制新配置到 settings.json
            console.log(chalk.blue('[Settings]'), `Switching to ${settingsName}.json`);
          }
        }

        // 复制新配置到 settings.json
        const newContent = readFileSync(sourcePath, 'utf-8');
        // 备份当前 settings.json
        if (existsSync(targetPath)) {
          const backupContent = readFileSync(targetPath, 'utf-8');
          writeFileSync(backupPath, backupContent, 'utf-8');
          console.log(chalk.blue('[Settings]'), `Backed up current settings.json`);
        }
        // 写入新配置到 settings.json
        writeFileSync(targetPath, newContent, 'utf-8');
        console.log(chalk.green('[Settings]'), `Switched to ${settingsName}.json`);

        ws.send(JSON.stringify({
          type: 'settings_switched',
          settingsName,
          message: `配置已切换到 ${settingsName}，请重启 Claude Code 以应用新配置`,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to switch settings:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          error: 'Failed to switch settings',
          timestamp: Date.now()
        }));
      }
    } else if (action === 'save') {
      // 手动保存配置到 settings.json
      const envDetails = (message as any).envDetails;
      if (!envDetails) {
        ws.send(JSON.stringify({
          type: 'settings_error',
          error: 'Missing envDetails',
          timestamp: Date.now()
        }));
        return;
      }

      const targetPath = path.join(claudeDir, 'settings.json');
      const backupPath = path.join(claudeDir, 'settings.json.backup');

      try {
        // 构建配置对象
        const config = {
          env: {
            ANTHROPIC_BASE_URL: envDetails.ANTHROPIC_BASE_URL || '',
            ANTHROPIC_AUTH_TOKEN: envDetails.ANTHROPIC_AUTH_TOKEN || '',
            ANTHROPIC_MODEL: envDetails.ANTHROPIC_MODEL || ''
          },
          model: envDetails.ANTHROPIC_MODEL || 'opus[1m]',
          permissions: {
            defaultMode: 'bypassPermissions'
          },
          skipDangerousModePermissionPrompt: true
        };

        // 备份当前 settings.json
        if (existsSync(targetPath)) {
          const backupContent = readFileSync(targetPath, 'utf-8');
          writeFileSync(backupPath, backupContent, 'utf-8');
          console.log(chalk.blue('[Settings]'), `Backed up current settings.json`);
        }

        // 写入新配置到 settings.json
        writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green('[Settings]'), `Saved manual config to settings.json`);

        ws.send(JSON.stringify({
          type: 'settings_saved',
          message: '配置已保存，请重启 Claude Code 以应用新配置',
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to save settings:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          error: 'Failed to save settings',
          timestamp: Date.now()
        }));
      }
    }
  }

  private handleAuth(ws: WebSocket, token?: string) {
    if (token === this.token) {
      const clientId = uuidv4();
      const client: Client = {
        id: clientId,
        ws,
        authenticated: true,
        connectedAt: new Date()
      };
      this.clients.set(clientId, client);

      const response: ServerMessage = {
        type: 'auth_success',
        clientId,
        timestamp: Date.now()
      };
      ws.send(JSON.stringify(response));

      console.log(chalk.green('✓'), `Client ${chalk.cyan(clientId)} authenticated`);

      // 先清理无效的运行状态（进程已结束但状态残留）
      this.claudeHandler.cleanupStaleSessions();

      // 检查是否有运行中的会话，发送所有运行中会话的信息
      const runningSessionIds = this.claudeHandler.getAllRunningSessionIds();
      if (runningSessionIds.length > 0) {
        console.log(chalk.yellow('🔄'), `Found ${runningSessionIds.length} running session(s)`);

        // 获取每个运行中会话的详细信息
        const sessionStorage = this.claudeHandler.getSessionStorage();
        const currentProjectId = sessionStorage.getProjectId();
        const runningSessions = runningSessionIds.map(sessionId => {
          // 尝试加载会话获取标题
          let title = sessionId.substring(0, 12); // 默认使用 ID 前12位
          let projectId: string | undefined = currentProjectId; // 默认使用当前项目

          try {
            // 首先尝试从当前项目加载
            const sessionData = sessionStorage.load(sessionId);
            if (sessionData && sessionData.title) {
              title = sessionData.title;
              console.log(chalk.gray(`  Found session ${sessionId.substring(0, 8)} in current project: ${title}`));
            } else {
              // 当前项目没找到，尝试从所有项目查找
              const SessionStorageClass = require('./claude/storage').SessionStorage;
              const projects = SessionStorageClass.listAllProjects();
              for (const project of projects) {
                try {
                  const projectSession = SessionStorageClass.loadSessionFromProject(project.id, sessionId);
                  if (projectSession) {
                    if (projectSession.title) title = projectSession.title;
                    projectId = project.id;
                    console.log(chalk.gray(`  Found session ${sessionId.substring(0, 8)} in project ${project.id}: ${title}`));
                    break;
                  }
                } catch (e) {
                  // 忽略加载错误
                }
              }
            }
          } catch (e) {
            console.log(chalk.gray(`  Error loading session ${sessionId}: ${e}`));
          }

          return { sessionId, title, projectId };
        });

        // 发送所有运行中会话的信息
        ws.send(JSON.stringify({
          type: 'running_sessions',
          sessions: runningSessions,
          timestamp: Date.now()
        }));

        // 更新所有运行中会话的 WebSocket 连接
        this.claudeHandler.updateRunningWebSocket(ws);
      }

      // 检查讨论会话
      if (this.discussionHandler.isRunning()) {
        const runningDiscussionId = this.discussionHandler.getRunningDiscussionId();
        if (runningDiscussionId) {
          console.log(chalk.yellow('🔄'), `Reconnecting to running discussion: ${runningDiscussionId}`);
          this.discussionHandler.updateRunningWebSocket(ws);

          // 通知客户端有运行中的讨论
          ws.send(JSON.stringify({
            type: 'discussion_running',
            discussionId: runningDiscussionId,
            timestamp: Date.now()
          }));
        }
      } else {
        // 讨论可能已完成但有缓存的结果需要发送
        console.log(chalk.blue('[Discussion]'), 'No running discussion, checking for pending results...');
        const hadPending = this.discussionHandler.updateRunningWebSocket(ws);
        console.log(chalk.blue('[Discussion]'), `updateRunningWebSocket returned: ${hadPending}`);
      }

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
    const attachments = message.attachments;

    // Debug logging
    console.log(chalk.gray('   📎 Attachments in handleClaudeMessage:'), attachments?.length || 0);
    console.log(chalk.magenta('🤖'), `Claude request received:`);
    console.log(chalk.gray('   Content:'), content.substring(0, 100));
    console.log(chalk.gray('   SessionId:'), sessionId);
    console.log(chalk.gray('   ProjectId:'), projectId || '(none)');
    console.log(chalk.gray('   Attachments:'), attachments?.length || 0);
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
          sessionId,  // Include sessionId so frontend can route correctly
          timestamp: Date.now()
        }));
      },
      sessionId,
      projectId,
      attachments
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
      message.title,
      message.limit,
      message.beforeIndex
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
