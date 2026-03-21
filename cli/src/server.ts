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
import { Provider } from './session/provider';
import { UiPreferences, UiPreferencesStorage } from './uiPreferences';

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
  provider?: Provider;
  fileName?: string;
  mimeType?: string;
  size?: number;
  timestamp?: number;
  action?:
    | 'new'
    | 'resume'
    | 'list'
    | 'delete'
    | 'list_projects'
    | 'list_by_project'
    | 'rename'
    | 'load_more'
    | 'switch'
    | 'save'
    | 'get_ui_preferences'
    | 'save_ui_preferences';
  settingsName?: string;
  uiPreferences?: UiPreferences;
  envDetails?: {
    ANTHROPIC_BASE_URL?: string;
    ANTHROPIC_AUTH_TOKEN?: string;
    ANTHROPIC_MODEL?: string;
  };
  sessionId?: string;
  projectId?: string;
  title?: string;
  stream?: boolean;
  limit?: number;
  beforeIndex?: number;
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    data: string;
  }>;
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
  private uiPreferencesStorage: UiPreferencesStorage;
  private workspaceRoot: string;
  private staticPath?: string;
  private imageConfig = {
    savePath: 'E:/CodeRemote/Uploads',
    maxSize: 50 * 1024 * 1024,
    allowedTypes: ['*'],
    createDirectory: true
  };

  constructor(port: number = 8080, token?: string, workspaceRoot?: string, staticPath?: string) {
    this.port = port;
    this.token = token || uuidv4();
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.staticPath = staticPath;
    this.claudeHandler = new ClaudeHandler(this.workspaceRoot);
    this.discussionHandler = new DiscussionHandler();
    this.uiPreferencesStorage = new UiPreferencesStorage(this.workspaceRoot);
    this.discussionHandler.setSessionManager(this.claudeHandler.getSessionManager());

    this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupServer();
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
      return;
    }

    if (this.staticPath && req.url) {
      const filePath = req.url === '/' ? '/index.html' : req.url;
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
        const dataStr = data.toString();
        console.log(chalk.cyan('[DEBUG]'), '=== WS MESSAGE ===');
        console.log(chalk.cyan('[DEBUG]'), `Total data length: ${data.length}`);
        console.log(chalk.cyan('[DEBUG]'), `isBinary: ${isBinary}`);
        console.log(chalk.cyan('[DEBUG]'), `String length: ${dataStr.length}`);
        console.log(chalk.cyan('[DEBUG]'), `Full raw data:\n${dataStr}`);
        console.log(chalk.cyan('[DEBUG]'), '==================');

        if (isBinary) {
          this.handleBinaryMessage(ws, data);
          return;
        }

        try {
          const message: ClientMessage = JSON.parse(dataStr);
          console.log(chalk.cyan('[DEBUG]'), '=== PARSED MESSAGE ===');
          console.log(chalk.cyan('[DEBUG]'), `type: ${message.type}`);
          console.log(chalk.cyan('[DEBUG]'), `content: ${(message as any).content}`);
          console.log(chalk.cyan('[DEBUG]'), `content length: ${(message as any).content?.length || 0}`);
          console.log(chalk.cyan('[DEBUG]'), '==================');
          this.handleMessage(ws, message);
        } catch (error) {
          console.error(chalk.red('[DEBUG]'), 'JSON parse error:', error);
          this.sendError(ws, 'Invalid message format');
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
        console.error(chalk.yellow('Hint:'), 'Try a different port with --port <number>');
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
        this.handleClaudeMessage(ws, message);
        break;

      case 'claude':
        console.log(
          chalk.yellow('📎'),
          'Received claude message, attachments:',
          message.attachments?.length || 0,
          '| content:',
          message.content?.substring(0, 30)
        );
        this.handleClaudeMessage(ws, message);
        break;

      case 'session':
        this.handleSessionAction(ws, message);
        break;

      case 'image_meta':
        this.handleImageMeta(ws, message);
        break;

      case 'stop': {
        console.log(chalk.yellow('⏹'), 'Received stop request', message.sessionId ? `for session: ${message.sessionId}` : '(all)');
        const stopped = message.sessionId
          ? this.claudeHandler.stopSession(message.sessionId)
          : this.claudeHandler.stop();

        ws.send(JSON.stringify({
          type: 'stopped',
          sessionId: message.sessionId,
          success: stopped,
          ...(stopped ? {} : { error: 'No running process to stop' }),
          timestamp: Date.now()
        }));
        break;
      }

      case 'discussion':
        console.log(chalk.magenta('💬'), 'Received discussion request');
        this.discussionHandler.handleRequest(ws, message as any as DiscussionRequest);
        break;

      case 'discussion_get_pending':
        console.log(chalk.blue('[Discussion]'), 'Received request for pending results');
        this.discussionHandler.sendPendingResultsOnRequest(ws);
        break;

      case 'session_focus':
        console.log(chalk.blue('🔍'), `Session focus changed to: ${message.sessionId || 'none'}`);
        this.claudeHandler.setActiveSession(message.sessionId || null);
        ws.send(JSON.stringify({
          type: 'session_focus_ack',
          sessionId: message.sessionId,
          timestamp: Date.now()
        }));
        break;

      case 'settings':
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

    if (action === 'get_ui_preferences') {
      try {
        const uiPreferences = this.uiPreferencesStorage.load();
        ws.send(JSON.stringify({
          type: 'ui_preferences',
          uiPreferences,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to load UI preferences:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          error: 'Failed to load UI preferences',
          timestamp: Date.now()
        }));
      }
      return;
    }

    if (action === 'save_ui_preferences') {
      try {
        const uiPreferences = this.uiPreferencesStorage.save(message.uiPreferences);
        ws.send(JSON.stringify({
          type: 'ui_preferences_saved',
          uiPreferences,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to save UI preferences:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          error: 'Failed to save UI preferences',
          timestamp: Date.now()
        }));
      }
      return;
    }

    if (action === 'list') {
      try {
        const files = readdirSync(claudeDir).filter(file =>
          file.startsWith('settings_key') && file.endsWith('.json')
        );

        const settingsList = files.map(file => {
          const filePath = path.join(claudeDir, file);
          const content = readFileSync(filePath, 'utf-8');
          const config = JSON.parse(content);
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
            name: file.replace('.json', ''),
            model: config.model || 'default',
            env: config.env ? Object.keys(config.env).length : 0,
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
          action,
          error: 'Failed to list settings',
          timestamp: Date.now()
        }));
      }
      return;
    }

    if (action === 'switch') {
      const settingsName = (message as any).settingsName;
      if (!settingsName) {
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
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
            action,
            error: `Settings file not found: ${settingsName}`,
            timestamp: Date.now()
          }));
          return;
        }

        const backupPath = path.join(claudeDir, 'settings.json.backup');
        if (existsSync(targetPath)) {
          const currentContent = readFileSync(targetPath, 'utf-8');
          const newContent = readFileSync(sourcePath, 'utf-8');
          if (currentContent !== newContent) {
            console.log(chalk.blue('[Settings]'), `Switching to ${settingsName}.json`);
          }
        }

        const newContent = readFileSync(sourcePath, 'utf-8');
        if (existsSync(targetPath)) {
          const backupContent = readFileSync(targetPath, 'utf-8');
          writeFileSync(backupPath, backupContent, 'utf-8');
          console.log(chalk.blue('[Settings]'), 'Backed up current settings.json');
        }

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
          action,
          error: 'Failed to switch settings',
          timestamp: Date.now()
        }));
      }
      return;
    }

    if (action === 'save') {
      const envDetails = (message as any).envDetails;
      if (!envDetails) {
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          error: 'Missing envDetails',
          timestamp: Date.now()
        }));
        return;
      }

      const targetPath = path.join(claudeDir, 'settings.json');
      const backupPath = path.join(claudeDir, 'settings.json.backup');

      try {
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

        if (existsSync(targetPath)) {
          const backupContent = readFileSync(targetPath, 'utf-8');
          writeFileSync(backupPath, backupContent, 'utf-8');
          console.log(chalk.blue('[Settings]'), 'Backed up current settings.json');
        }

        writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green('[Settings]'), 'Saved manual config to settings.json');

        ws.send(JSON.stringify({
          type: 'settings_saved',
          message: '配置已保存，请重启 Claude Code 以应用新配置',
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to save settings:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          error: 'Failed to save settings',
          timestamp: Date.now()
        }));
      }
    }
  }

  private handleAuth(ws: WebSocket, token?: string) {
    if (token !== this.token) {
      const response: ServerMessage = { type: 'auth_failed' };
      ws.send(JSON.stringify(response));
      console.log(chalk.red('✗'), 'Authentication failed - invalid token');
      ws.close();
      return;
    }

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

    this.claudeHandler.cleanupStaleSessions();

    const runningSessionSummaries = this.claudeHandler.getRunningSessionSummaries();
    if (runningSessionSummaries.length > 0) {
      console.log(chalk.yellow('🔄'), `Found ${runningSessionSummaries.length} running session(s)`);
      ws.send(JSON.stringify({
        type: 'running_sessions',
        sessions: runningSessionSummaries,
        timestamp: Date.now()
      }));
      this.claudeHandler.updateRunningWebSocket(ws);
    }

    if (this.discussionHandler.isRunning()) {
      const runningDiscussionId = this.discussionHandler.getRunningDiscussionId();
      if (runningDiscussionId) {
        console.log(chalk.yellow('🔄'), `Reconnecting to running discussion: ${runningDiscussionId}`);
        this.discussionHandler.updateRunningWebSocket(ws);
        ws.send(JSON.stringify({
          type: 'discussion_running',
          discussionId: runningDiscussionId,
          timestamp: Date.now()
        }));
      }
    } else {
      console.log(chalk.blue('[Discussion]'), 'No running discussion, checking for pending results...');
      const hadPending = this.discussionHandler.updateRunningWebSocket(ws);
      console.log(chalk.blue('[Discussion]'), `updateRunningWebSocket returned: ${hadPending}`);
    }

    if (this.connectionHandler) {
      this.connectionHandler(clientId);
    }
  }

  private handleClientMessage(ws: WebSocket, content?: string) {
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

    console.log(chalk.blue('Message:'), content);
  }

  private handleClaudeMessage(ws: WebSocket, message: ClientMessage) {
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

    const content = message.content || '';
    const sessionId = message.sessionId;
    const projectId = message.projectId;
    const attachments = message.attachments;

    console.log(chalk.gray('   📎 Attachments in handleClaudeMessage:'), attachments?.length || 0);
    console.log(chalk.magenta('🤖'), 'Claude request received:');
    console.log(chalk.gray('   Content:'), content.substring(0, 100));
    console.log(chalk.gray('   SessionId:'), sessionId);
    console.log(chalk.gray('   ProjectId:'), projectId || '(none)');
    console.log(chalk.gray('   Provider:'), message.provider || '(default)');
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
          sessionId,
          provider: message.provider,
          timestamp: Date.now()
        }));
      },
      sessionId,
      projectId,
      attachments,
      message.provider
    );
  }

  private handleSessionAction(ws: WebSocket, message: ClientMessage) {
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

    this.claudeHandler.handleSessionAction(
      ws,
      (message.action || 'list') as any,
      message.sessionId,
      message.projectId,
      message.title,
      message.limit,
      message.beforeIndex,
      message.provider
    );
  }

  private handleImageMeta(ws: WebSocket, message: ClientMessage) {
    let client: Client | null = null;
    for (const [, currentClient] of this.clients) {
      if (currentClient.ws === ws) {
        client = currentClient;
        break;
      }
    }

    if (!client || !client.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

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

    if (!clientId) {
      return;
    }

    this.clients.delete(clientId);
    if (this.disconnectHandler) {
      this.disconnectHandler(clientId);
    }
  }

  private async handleBinaryMessage(ws: WebSocket, data: Buffer) {
    let client: Client | null = null;
    let clientId: string | null = null;
    for (const [id, currentClient] of this.clients) {
      if (currentClient.ws === ws) {
        client = currentClient;
        clientId = id;
        break;
      }
    }

    if (!client || !client.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    if (!client.imageTransfer?.inProgress || !client.imageTransfer.meta) {
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
    } catch {
      // Ignore closed sockets.
    }
  }

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
    if (!client || !client.authenticated) {
      return false;
    }

    const message: ServerMessage = {
      type: 'message',
      content,
      timestamp: Date.now()
    };

    try {
      client.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(chalk.red('Error sending to client:'), error);
      this.clients.delete(clientId);
      return false;
    }
  }

  broadcast(message: string) {
    const response: ServerMessage = {
      type: 'message',
      content: message,
      timestamp: Date.now()
    };
    const messageStr = JSON.stringify(response);

    for (const [clientId, client] of this.clients) {
      if (!client.authenticated) {
        continue;
      }

      try {
        client.ws.send(messageStr);
      } catch {
        console.error(chalk.red('Error broadcasting to'), clientId);
        this.clients.delete(clientId);
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
      .filter(client => client.authenticated)
      .map(client => ({
        id: client.id,
        connectedAt: client.connectedAt
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

      client.ws.send(JSON.stringify({
        type: 'image_meta',
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        size: meta.size,
        timestamp: Date.now()
      }));

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
    for (const [, client] of this.clients) {
      try {
        client.ws.close();
      } catch {
        // Ignore close failures.
      }
    }

    this.clients.clear();
    this.wss.close();
    this.httpServer.close();
    console.log(chalk.yellow('→'), 'Server closed');
  }
}
