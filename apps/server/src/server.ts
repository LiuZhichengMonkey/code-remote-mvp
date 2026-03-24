import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync } from 'fs';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { AccessIdentity, TokenAuthorizer, TestTokenConfig } from './accessControl';
import { ImageSuccessResponse, ImageErrorResponse, ImageConfig } from './types/image';
import { ClaudeHandler } from './handlers/claude';
import { DiscussionHandler, DiscussionRequest } from './handlers/discussion';
import { getImageErrorCode, ImageErrorCode } from './imageErrorCode';
import { Provider } from './session/provider';
import { UiPreferences, UiPreferencesStorage } from './uiPreferences';
import {
  listRuntimeProfiles,
  saveRuntimeProfile,
  switchRuntimeProfile
} from './runtimeProfiles';

export interface Client {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  connectedAt: Date;
  accessIdentity: AccessIdentity;
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
    baseUrl?: string;
    authToken?: string;
    model?: string;
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
  private readonly debugLoggingEnabled = process.env.CODEREMOTE_DEBUG === '1';
  private imageConfig: ImageConfig;
  private tokenAuthorizer: TokenAuthorizer;

  constructor(
    port: number = 8080,
    token?: string,
    workspaceRoot?: string,
    staticPath?: string,
    uploadsDir?: string,
    testTokens: TestTokenConfig[] = []
  ) {
    this.port = port;
    this.token = token || uuidv4();
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.staticPath = staticPath;
    this.tokenAuthorizer = new TokenAuthorizer(this.token, testTokens);
    this.imageConfig = {
      savePath: uploadsDir || join(this.workspaceRoot, '.coderemote', 'uploads'),
      maxSize: 50 * 1024 * 1024,
      allowedTypes: ['*'],
      createDirectory: true
    };
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

  private logDebug(...args: unknown[]) {
    if (this.debugLoggingEnabled) {
      console.log(chalk.cyan('[debug]'), ...args);
    }
  }

  private getClientByWebSocket(ws: WebSocket): Client | null {
    for (const [, client] of this.clients) {
      if (client.ws === ws) {
        return client;
      }
    }

    return null;
  }

  private getClientIdByWebSocket(ws: WebSocket): string | null {
    for (const [clientId, client] of this.clients) {
      if (client.ws === ws) {
        return clientId;
      }
    }

    return null;
  }

  private broadcastJson(payload: unknown, shouldSend?: (client: Client) => boolean) {
    const message = JSON.stringify(payload);

    for (const [clientId, client] of this.clients) {
      if (!client.authenticated || (shouldSend && !shouldSend(client))) {
        continue;
      }

      try {
        client.ws.send(message);
      } catch {
        console.error(chalk.red('Error broadcasting to'), clientId);
        this.clients.delete(clientId);
      }
    }
  }

  private setupServer() {
    this.httpServer.listen(this.port, () => {
      console.log(chalk.green('[server]'), chalk.bold('CodeRemote server started'));
      console.log(chalk.gray('-'.repeat(50)));
      console.log(`  Port:      ${chalk.cyan(this.port)}`);
      console.log(`  Token:     ${chalk.yellow(this.token)}`);
      console.log(`  WebSocket: ${chalk.cyan(`ws://localhost:${this.port}`)}`);
      if (this.staticPath) {
        console.log(`  HTTP:      ${chalk.cyan(`http://localhost:${this.port}`)}`);
        console.log(`  Static:    ${chalk.gray(this.staticPath)}`);
      }
      console.log(chalk.gray('-'.repeat(50)));
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientIp = req.socket.remoteAddress || 'unknown';
      console.log(chalk.blue('[ws]'), `New connection from ${clientIp}`);

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        const dataStr = data.toString();

        if (isBinary) {
          this.handleBinaryMessage(ws, data);
          return;
        }

        try {
          const message: ClientMessage = JSON.parse(dataStr);
          this.logDebug(`ws message type=${message.type}`, {
            action: message.action,
            provider: message.provider,
            sessionId: message.sessionId
          });
          this.handleMessage(ws, message);
        } catch (error) {
          console.error(chalk.red('Error:'), 'Failed to parse WebSocket message', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        this.handleDisconnection(ws);
        console.log(chalk.red('[ws]'), `Client disconnected from ${clientIp}`);
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
        this.logDebug('Received chat request', {
          provider: message.provider || 'claude',
          attachments: message.attachments?.length || 0,
          sessionId: message.sessionId
        });
        this.handleClaudeMessage(ws, message);
        break;

      case 'session':
        this.handleSessionAction(ws, message);
        break;

      case 'image_meta':
        this.handleImageMeta(ws, message);
        break;

      case 'stop': {
        const client = this.getClientByWebSocket(ws);
        if (!client || !client.authenticated) {
          this.sendError(ws, 'Not authenticated');
          break;
        }

        console.log(
          chalk.yellow('[chat]'),
          'Received stop request',
          message.sessionId ? `for session: ${message.sessionId}` : '(all)'
        );
        const stopped = message.sessionId
          ? this.claudeHandler.stopSession(message.sessionId, client.accessIdentity, message.projectId, message.provider)
          : this.claudeHandler.stopAccessibleSessions(client.accessIdentity);

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
        console.log(chalk.magenta('[Discussion]'), 'Received discussion request');
        this.discussionHandler.handleRequest(ws, message as any as DiscussionRequest);
        break;

      case 'discussion_get_pending':
        console.log(chalk.blue('[Discussion]'), 'Received request for pending results');
        this.discussionHandler.sendPendingResultsOnRequest(ws);
        break;

      case 'session_focus':
        {
          const client = this.getClientByWebSocket(ws);
          if (!client || !client.authenticated) {
            this.sendError(ws, 'Not authenticated');
            break;
          }

          if (
            message.sessionId
            && !this.claudeHandler.canAccessSession(message.sessionId, client.accessIdentity, message.projectId, message.provider)
          ) {
            this.sendError(ws, 'Session not found');
            break;
          }

          this.logDebug(`Session focus changed to ${message.sessionId || 'none'}`);
          this.claudeHandler.setActiveSession(message.sessionId || null);
        }
        ws.send(JSON.stringify({
          type: 'session_focus_ack',
          sessionId: message.sessionId,
          timestamp: Date.now()
        }));
        break;

      case 'settings':
        this.logDebug('Received settings request', {
          action: message.action,
          provider: message.provider || 'claude'
        });
        this.handleSettingsRequest(ws, message, this.getClientByWebSocket(ws));
        break;

      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleSettingsRequest(ws: WebSocket, message: ClientMessage, client: Client | null) {
    const action = (message as any).action || 'list';
    const provider = message.provider || 'claude';

    if (!client || !client.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    if (!client.accessIdentity.permissions.canManageSettings) {
      ws.send(JSON.stringify({
        type: 'settings_error',
        action,
        provider,
        error: 'Forbidden',
        timestamp: Date.now()
      }));
      return;
    }

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
          provider,
          error: 'Failed to load UI preferences',
          timestamp: Date.now()
        }));
      }
      return;
    }

    if (action === 'save_ui_preferences') {
      try {
        const uiPreferences = this.uiPreferencesStorage.save(message.uiPreferences);
        this.broadcastJson({
          type: 'ui_preferences_saved',
          uiPreferences,
          timestamp: Date.now()
        }, currentClient => currentClient.accessIdentity.permissions.canManageSettings);
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to save UI preferences:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          provider,
          error: 'Failed to save UI preferences',
          timestamp: Date.now()
        }));
      }
      return;
    }

    if (action === 'list') {
      try {
        const result = listRuntimeProfiles(provider);

        ws.send(JSON.stringify({
          type: 'settings_list',
          provider,
          settings: result.profiles,
          activeProfile: result.activeProfile,
          selectedProfileName: result.selectedProfileName,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to list settings:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          provider,
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
          provider,
          error: 'Missing settingsName',
          timestamp: Date.now()
        }));
        return;
      }

      try {
        const result = switchRuntimeProfile(provider, settingsName);

        ws.send(JSON.stringify({
          type: 'settings_switched',
          provider,
          settingsName: result.selectedProfileName,
          activeProfile: result.activeProfile,
          selectedProfileName: result.selectedProfileName,
          message: result.message,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to switch settings:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          provider,
          error: error instanceof Error ? error.message : 'Failed to switch settings',
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
          provider,
          error: 'Missing envDetails',
          timestamp: Date.now()
        }));
        return;
      }

      try {
        const result = saveRuntimeProfile(provider, envDetails);

        ws.send(JSON.stringify({
          type: 'settings_saved',
          provider,
          activeProfile: result.activeProfile,
          selectedProfileName: result.selectedProfileName,
          message: result.message,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(chalk.red('[Settings]'), 'Failed to save settings:', error);
        ws.send(JSON.stringify({
          type: 'settings_error',
          action,
          provider,
          error: 'Failed to save settings',
          timestamp: Date.now()
        }));
      }
      return;
    }

    ws.send(JSON.stringify({
      type: 'settings_error',
      action,
      provider,
      error: `Unsupported settings action: ${action}`,
      timestamp: Date.now()
    }));
  }

  private handleAuth(ws: WebSocket, token?: string) {
    const accessIdentity = this.tokenAuthorizer.resolve(token);
    if (!accessIdentity) {
      const response: ServerMessage = { type: 'auth_failed' };
      ws.send(JSON.stringify(response));
      console.log(chalk.red('[auth]'), 'Authentication failed: invalid token');
      ws.close();
      return;
    }

    const clientId = uuidv4();
    const client: Client = {
      id: clientId,
      ws,
      authenticated: true,
      connectedAt: new Date(),
      accessIdentity
    };
    this.clients.set(clientId, client);

    const response: ServerMessage & {
      accessMode: AccessIdentity['accessMode'];
      ownerId?: string;
      permissions: AccessIdentity['permissions'];
    } = {
      type: 'auth_success',
      clientId,
      accessMode: accessIdentity.accessMode,
      ...(accessIdentity.ownerId ? { ownerId: accessIdentity.ownerId } : {}),
      permissions: accessIdentity.permissions,
      timestamp: Date.now()
    };
    ws.send(JSON.stringify(response));

    console.log(
      chalk.green('[auth]'),
      `Client ${chalk.cyan(clientId)} authenticated as ${accessIdentity.accessMode}${accessIdentity.ownerId ? `:${accessIdentity.ownerId}` : ''}`
    );

    this.claudeHandler.cleanupStaleSessions();

    const runningSessionSummaries = this.claudeHandler.getRunningSessionSummaries(accessIdentity);
    if (runningSessionSummaries.length > 0) {
      console.log(chalk.yellow('[session]'), `Found ${runningSessionSummaries.length} running session(s)`);
      ws.send(JSON.stringify({
        type: 'running_sessions',
        sessions: runningSessionSummaries,
        timestamp: Date.now()
      }));
      this.claudeHandler.updateRunningWebSocket(ws, accessIdentity);
    }

    if (this.discussionHandler.isRunning()) {
      const runningDiscussionId = this.discussionHandler.getRunningDiscussionId();
      if (runningDiscussionId) {
        console.log(chalk.yellow('[discussion]'), `Reconnecting to running discussion: ${runningDiscussionId}`);
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
    const clientId = this.getClientIdByWebSocket(ws);

    if (!clientId || !this.clients.get(clientId)?.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    if (this.messageHandler && content) {
      this.messageHandler(clientId, content);
    }

    this.logDebug('Client message received', { clientId, length: content?.length || 0 });
  }

  private handleClaudeMessage(ws: WebSocket, message: ClientMessage) {
    const clientId = this.getClientIdByWebSocket(ws);
    const client = this.getClientByWebSocket(ws);

    if (!clientId || !client?.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    const content = message.content || '';
    const sessionId = message.sessionId;
    const projectId = message.projectId;
    const attachments = message.attachments;

    console.log(chalk.magenta('[Chat]'), 'Request received', {
      provider: message.provider || 'claude',
      sessionId: sessionId || '(new)',
      projectId: projectId || '(none)',
      attachments: attachments?.length || 0,
      clientId
    });

    this.claudeHandler.handleClaudeMessage(
      ws,
      content,
      (code, errorMsg) => {
        console.log(chalk.red('[chat]'), `Chat error: ${errorMsg}`);
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
      message.provider,
      client.accessIdentity
    );
  }

  private handleSessionAction(ws: WebSocket, message: ClientMessage) {
    const clientId = this.getClientIdByWebSocket(ws);
    const client = this.getClientByWebSocket(ws);

    if (!clientId || !client?.authenticated) {
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
      message.provider,
      client.accessIdentity
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

    console.log(
      chalk.yellow('[image]'),
      `Ready to receive file: ${message.fileName} (${(message.size! / 1024).toFixed(1)} KB)`
    );
    console.log(chalk.gray('  MIME type:'), message.mimeType);
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
      this.sendError(ws, 'Protocol error: unexpected binary data');
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
      console.log(chalk.green('[image]'), `Saved file: ${savedPath}`);
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
      console.log(chalk.red('[image]'), `Failed to process image: ${errorMsg}`);
      client.imageTransfer = undefined;
    }
  }

  private getErrorCode(message: string): ImageErrorCode {
    return getImageErrorCode(message);
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
      console.log(chalk.yellow('[image]'), `Sent image to client ${clientId}: ${meta.fileName}`);
      return true;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red('[image]'), `Failed to send image: ${errorMsg}`);
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
    console.log(chalk.yellow('[server]'), 'Server closed');
  }
}
