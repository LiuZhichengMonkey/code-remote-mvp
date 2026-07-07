import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import fs, { existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { AccessIdentity, TokenAuthorizer, TestTokenConfig } from './accessControl';
import { ImageSuccessResponse, ImageErrorResponse, ImageConfig } from './types/image';
import { ClaudeHandler } from './handlers/claude';
import { DiscussionHandler, DiscussionRequest } from './handlers/discussion';
import { getImageErrorCode, ImageErrorCode } from './imageErrorCode';
import { DEFAULT_PROVIDER, isProvider, Provider, SUPPORTED_PROVIDERS } from './session/provider';
import { UiPreferences, UiPreferencesStorage } from './uiPreferences';
import {
  listRuntimeProfiles,
  saveRuntimeProfile,
  switchRuntimeProfile
} from './runtimeProfiles';
import {
  getMimeTypeForPath,
  listRecentWorkspaceFiles,
  listSessionRecentFiles,
  listWorkspaceEntries,
  resolveAccessibleWorkspaceRoot,
  resolvePathWithinWorkspaceRoot,
  resolveSessionReferencedFile,
  searchWorkspaceFilesByName
} from './fileBrowser';
import {
  assertAllowedLocalProxyTarget,
  filterProxyResponseHeaders,
  LocalHttpProxyError,
  rewriteCssForProxy,
  rewriteHtmlForProxy,
  rewriteProxyLocation
} from './httpProxy';
import { listAvailableSkills } from './skillDiscovery';
import { AccioDemoRouter } from './accio-demo';
import {
  getZipDownloadFileName,
  prepareDirectoryZipArchive,
  streamZipArchive
} from './zipArchive';
import { ClaudeSession } from './claude/types';

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

type FileApiScope = 'session' | 'workspace';

interface FileApiContext {
  workspaceRoot: string;
  scope: FileApiScope;
  session: ClaudeSession | null;
  sessionId: string | null;
  projectId?: string;
  provider?: Provider;
}

export interface ClientMessage {
  type: 'auth' | 'message' | 'image_meta' | 'claude' | 'session' | 'stop' | 'discussion' | 'discussion_get_pending' | 'session_focus' | 'settings' | 'keepalive';
  token?: string;
  content?: string;
  provider?: Provider;
  reason?: string;
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
  cwd?: string;
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
  private accioDemoRouter: AccioDemoRouter;
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
    this.accioDemoRouter = new AccioDemoRouter();
    this.discussionHandler.setSessionManager(this.claudeHandler.getSessionManager());

    this.httpServer = createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupServer();
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');

    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      this.setApiCorsHeaders(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (this.accioDemoRouter.canHandle(requestUrl.pathname)) {
        const accessIdentity = this.getHttpAccessIdentity(req, requestUrl, { allowQueryToken: true });
        if (!accessIdentity) {
          this.sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        const handled = await this.accioDemoRouter.handle(req, res, requestUrl);
        if (handled) {
          return;
        }
      }

      if (
        requestUrl.pathname.startsWith('/api/files/')
        || requestUrl.pathname === '/api/skills'
        || requestUrl.pathname === '/api/proxy/http'
      ) {
        const accessIdentity = this.getHttpAccessIdentity(req, requestUrl);
        if (!accessIdentity) {
          this.sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        if (requestUrl.pathname === '/api/skills') {
          void this.handleSkillsApiRequest(req, res, requestUrl, accessIdentity);
          return;
        }

        if (requestUrl.pathname === '/api/proxy/http') {
          void this.handleHttpProxyRequest(req, res, requestUrl, accessIdentity, 'api');
          return;
        }

        this.handleFileApiRequest(req, res, requestUrl, accessIdentity);
        return;
      }
    }

    if (requestUrl.pathname === '/proxy/http') {
      const accessIdentity = this.getHttpAccessIdentity(req, requestUrl, { allowQueryToken: true });
      if (!accessIdentity) {
        this.sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      void this.handleHttpProxyRequest(req, res, requestUrl, accessIdentity, 'browser');
      return;
    }

    if (this.staticPath && requestUrl.pathname) {
      const filePath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
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
        fs.createReadStream(fullPath).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private setApiCorsHeaders(res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    res.setHeader('Cache-Control', 'no-store');
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
    this.setApiCorsHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  private resolveFileApiContext(
    baseWorkspaceRoot: string,
    requestUrl: URL,
    accessIdentity: AccessIdentity
  ): FileApiContext | null {
    const sessionId = requestUrl.searchParams.get('sessionId');
    const projectId = requestUrl.searchParams.get('projectId') || undefined;
    const provider = requestUrl.searchParams.get('provider') as Provider | null;
    const scope: FileApiScope = requestUrl.searchParams.get('scope') === 'workspace'
      ? 'workspace'
      : 'session';

    if (!sessionId) {
      return {
        workspaceRoot: baseWorkspaceRoot,
        scope: 'workspace',
        session: null,
        sessionId: null,
        projectId,
        provider: provider || undefined
      };
    }

    const session = this.claudeHandler.getSessionForAccess(
      sessionId,
      accessIdentity,
      projectId,
      provider || undefined
    );
    if (!session) {
      return null;
    }

    return {
      workspaceRoot: session.cwd || baseWorkspaceRoot,
      scope,
      session,
      sessionId,
      projectId,
      provider: provider || undefined
    };
  }

  private getHttpAccessIdentity(
    req: IncomingMessage,
    requestUrl: URL,
    options?: {
      allowQueryToken?: boolean;
    }
  ): AccessIdentity | null {
    const authorizationHeader = req.headers.authorization;
    if (authorizationHeader) {
      const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        return this.tokenAuthorizer.resolve(match[1].trim());
      }
    }

    if (options?.allowQueryToken) {
      const queryToken = requestUrl.searchParams.get('token');
      if (queryToken) {
        return this.tokenAuthorizer.resolve(queryToken.trim());
      }
    }

    return null;
  }

  private createProxyRequestHeaders(requestHeaders: IncomingMessage['headers']): Headers {
    const forwardedHeaders = new Headers();
    const allowedRequestHeaders = [
      'accept',
      'accept-language',
      'cache-control',
      'cookie',
      'if-modified-since',
      'if-none-match',
      'user-agent'
    ] as const;

    for (const headerName of allowedRequestHeaders) {
      const headerValue = requestHeaders[headerName];
      if (!headerValue) {
        continue;
      }

      forwardedHeaders.set(
        headerName,
        Array.isArray(headerValue) ? headerValue.join(', ') : headerValue
      );
    }

    return forwardedHeaders;
  }

  private applyResponseHeaders(
    res: ServerResponse,
    headers: Record<string, string | string[]>
  ) {
    for (const [headerName, headerValue] of Object.entries(headers)) {
      res.setHeader(headerName, headerValue);
    }
  }

  private async handleHttpProxyRequest(
    req: IncomingMessage,
    res: ServerResponse,
    requestUrl: URL,
    _accessIdentity: AccessIdentity,
    routeKind: 'api' | 'browser'
  ) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = assertAllowedLocalProxyTarget(requestUrl.searchParams.get('url'));
    } catch (error) {
      if (error instanceof LocalHttpProxyError) {
        switch (error.code) {
          case 'PROXY_MISSING_URL':
          case 'PROXY_INVALID_URL':
            this.sendJson(res, 400, { error: error.message });
            return;
          case 'PROXY_UNSUPPORTED_PROTOCOL':
          case 'PROXY_FORBIDDEN_HOST':
            this.sendJson(res, 403, { error: error.message });
            return;
          default:
            break;
        }
      }

      this.sendJson(res, 500, { error: 'Failed to validate proxy target' });
      return;
    }

    const browserToken = routeKind === 'browser'
      ? requestUrl.searchParams.get('token') || undefined
      : undefined;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), 15000);

    try {
      const upstreamResponse = await fetch(targetUrl.toString(), {
        method: req.method,
        headers: this.createProxyRequestHeaders(req.headers),
        redirect: 'manual',
        signal: abortController.signal
      });
      clearTimeout(timeoutHandle);

      const upstreamLocation = upstreamResponse.headers.get('location');
      const rewrittenLocation = upstreamLocation
        ? rewriteProxyLocation(upstreamLocation, targetUrl, {
            routeKind,
            token: browserToken
          })
        : undefined;
      const responseHeaders = filterProxyResponseHeaders(upstreamResponse.headers, {
        rewrittenLocation
      });
      const contentType = (upstreamResponse.headers.get('content-type') || '').toLowerCase();
      const shouldRewriteHtml = req.method !== 'HEAD' && contentType.includes('text/html');
      const shouldRewriteCss = req.method !== 'HEAD' && contentType.includes('text/css');

      if (shouldRewriteHtml) {
        const html = await upstreamResponse.text();
        const rewrittenHtml = rewriteHtmlForProxy(html, targetUrl, {
          routeKind,
          token: browserToken
        });
        this.applyResponseHeaders(res, responseHeaders);
        res.writeHead(upstreamResponse.status);
        res.end(rewrittenHtml);
        return;
      }

      if (shouldRewriteCss) {
        const css = await upstreamResponse.text();
        const rewrittenCss = rewriteCssForProxy(css, targetUrl, {
          routeKind,
          token: browserToken
        });
        this.applyResponseHeaders(res, responseHeaders);
        res.writeHead(upstreamResponse.status);
        res.end(rewrittenCss);
        return;
      }

      this.applyResponseHeaders(res, responseHeaders);
      res.writeHead(upstreamResponse.status);

      if (req.method === 'HEAD' || upstreamResponse.status === 204 || upstreamResponse.status === 304 || !upstreamResponse.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstreamResponse.body as any).pipe(res);
    } catch (error) {
      clearTimeout(timeoutHandle);

      if (error instanceof Error && error.name === 'AbortError') {
        this.sendJson(res, 504, { error: 'Proxy request timed out' });
        return;
      }

      console.error(chalk.red('[proxy]'), 'HTTP proxy request failed:', error);
      this.sendJson(res, 502, { error: 'Failed to reach local target' });
    }
  }

  private async handleFileApiRequest(
    req: IncomingMessage,
    res: ServerResponse,
    requestUrl: URL,
    accessIdentity: AccessIdentity
  ): Promise<void> {
    if (req.method !== 'GET') {
      this.sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const workspaceRoot = resolveAccessibleWorkspaceRoot(this.workspaceRoot, accessIdentity);
    const pathname = requestUrl.pathname;

    try {
      if (pathname === '/api/files/recent') {
        const entries = listRecentWorkspaceFiles(workspaceRoot);
        this.sendJson(res, 200, { entries });
        return;
      }

      if (pathname === '/api/files/session') {
        const sessionId = requestUrl.searchParams.get('sessionId');
        const projectId = requestUrl.searchParams.get('projectId') || undefined;
        const provider = requestUrl.searchParams.get('provider') as Provider | null;

        if (!sessionId) {
          this.sendJson(res, 200, { entries: [] });
          return;
        }

        const session = this.claudeHandler.getSessionForAccess(
          sessionId,
          accessIdentity,
          projectId,
          provider || undefined
        );
        if (!session) {
          this.sendJson(res, 404, { error: 'Session not found' });
          return;
        }

        const sessionWorkspaceRoot = session.cwd || workspaceRoot;
        const entries = listSessionRecentFiles(sessionWorkspaceRoot, session);
        this.sendJson(res, 200, { entries });
        return;
      }

      if (pathname === '/api/files/list') {
        const relativePath = requestUrl.searchParams.get('path') || '';
        const fileContext = this.resolveFileApiContext(workspaceRoot, requestUrl, accessIdentity);
        if (!fileContext) {
          this.sendJson(res, 404, { error: 'Session not found' });
          return;
        }

        const result = listWorkspaceEntries(fileContext.workspaceRoot, relativePath);
        this.sendJson(res, 200, {
          rootPath: result.rootPath,
          path: result.path,
          parentPath: result.parentPath,
          entries: result.entries
        });
        return;
      }

      if (pathname === '/api/files/search') {
        const name = requestUrl.searchParams.get('name') || '';
        if (!name.trim()) {
          this.sendJson(res, 400, { error: 'Missing name' });
          return;
        }

        const entries = searchWorkspaceFilesByName(workspaceRoot, name);
        this.sendJson(res, 200, { entries });
        return;
      }

      if (pathname === '/api/files/download') {
        if (!requestUrl.searchParams.has('path')) {
          this.sendJson(res, 400, { error: 'Missing path' });
          return;
        }
        const relativePath = requestUrl.searchParams.get('path') || '';

        const sessionId = requestUrl.searchParams.get('sessionId');
        const fileContext = this.resolveFileApiContext(workspaceRoot, requestUrl, accessIdentity);
        if (!fileContext) {
          this.sendJson(res, 404, { error: 'Session not found' });
          return;
        }

        let absolutePath: string;
        if (sessionId && fileContext.scope !== 'workspace') {
          const resolvedReference = fileContext.session
            ? resolveSessionReferencedFile(fileContext.workspaceRoot, fileContext.session, relativePath)
            : null;
          if (!resolvedReference || resolvedReference.entry.available === false || !existsSync(resolvedReference.absolutePath)) {
            this.sendJson(res, 404, { error: 'File not found' });
            return;
          }

          absolutePath = resolvedReference.absolutePath;
        } else {
          absolutePath = resolvePathWithinWorkspaceRoot(fileContext.workspaceRoot, relativePath).absolutePath;
          if (!existsSync(absolutePath)) {
            this.sendJson(res, 404, { error: 'File not found' });
            return;
          }
        }

        const stats = fs.statSync(absolutePath);
        if (stats.isDirectory()) {
          if (sessionId && fileContext.scope !== 'workspace') {
            this.sendJson(res, 400, { error: 'Session downloads only support files' });
            return;
          }

          let archive;
          try {
            archive = await prepareDirectoryZipArchive(absolutePath);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            switch (message) {
              case 'ZIP_TOO_MANY_FILES':
                this.sendJson(res, 413, { error: 'Folder contains too many files to download' });
                return;
              case 'ZIP_TOO_LARGE':
              case 'ZIP_FILE_TOO_LARGE':
                this.sendJson(res, 413, { error: 'Folder is too large to download' });
                return;
              default:
                throw error;
            }
          }

          this.setApiCorsHeaders(res);
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(getZipDownloadFileName(absolutePath))}`
          });

          try {
            await streamZipArchive(archive, res);
          } catch (error) {
            console.error(chalk.red('[files]'), 'Failed to stream folder zip:', error);
            res.destroy(error instanceof Error ? error : undefined);
          }
          return;
        }

        if (!stats.isFile()) {
          this.sendJson(res, 400, { error: 'Path is not a file or folder' });
          return;
        }

        this.setApiCorsHeaders(res);
        res.writeHead(200, {
          'Content-Type': getMimeTypeForPath(absolutePath),
          'Content-Length': stats.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(absolutePath))}`
        });

        const stream = fs.createReadStream(absolutePath);
        stream.on('error', () => {
          if (!res.headersSent) {
            this.sendJson(res, 500, { error: 'Failed to read file' });
            return;
          }

          res.destroy();
        });
        stream.pipe(res);
        return;
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      switch (message) {
        case 'FILE_NOT_FOUND':
          this.sendJson(res, 404, { error: 'File not found' });
          return;
        case 'NOT_A_DIRECTORY':
          this.sendJson(res, 400, { error: 'Path is not a directory' });
          return;
        case 'PATH_OUTSIDE_ROOT':
          this.sendJson(res, 403, { error: 'Forbidden path' });
          return;
        default:
          console.error(chalk.red('[files]'), 'HTTP file API error:', error);
          this.sendJson(res, 500, { error: 'Failed to process file request' });
      }
    }
  }

  private async handleSkillsApiRequest(
    req: IncomingMessage,
    res: ServerResponse,
    requestUrl: URL,
    accessIdentity: AccessIdentity
  ): Promise<void> {
    if (req.method !== 'GET') {
      this.sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const provider = this.validateOptionalProvider(requestUrl.searchParams.get('provider'));
    if (provider === null) {
      this.sendJson(res, 400, {
        error: this.getUnsupportedProviderMessage(requestUrl.searchParams.get('provider')),
        supportedProviders: SUPPORTED_PROVIDERS
      });
      return;
    }

    try {
      const workspaceRoot = resolveAccessibleWorkspaceRoot(this.workspaceRoot, accessIdentity);
      const skills = listAvailableSkills(workspaceRoot, provider || DEFAULT_PROVIDER);
      this.sendJson(res, 200, { skills });
    } catch (error) {
      console.error(chalk.red('[skills]'), 'Failed to load skills:', error);
      this.sendJson(res, 500, { error: 'Failed to load skills' });
    }
  }

  private logDebug(...args: unknown[]) {
    if (this.debugLoggingEnabled) {
      console.log(chalk.cyan('[debug]'), ...args);
    }
  }

  private validateOptionalProvider(value: unknown): Provider | undefined | null {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return typeof value === 'string' && isProvider(value) ? value : null;
  }

  private getUnsupportedProviderMessage(value: unknown): string {
    const requested = typeof value === 'string' && value.trim()
      ? value.trim()
      : String(value);
    return `Unsupported provider "${requested}". Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`;
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
        void this.handleSessionAction(ws, message);
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
        const provider = this.validateOptionalProvider(message.provider);
        if (provider === null) {
          this.sendError(ws, this.getUnsupportedProviderMessage(message.provider));
          break;
        }

        console.log(
          chalk.yellow('[chat]'),
          'Received stop request',
          message.sessionId ? `for session: ${message.sessionId}` : '(all)'
        );
        const stopped = message.sessionId
          ? this.claudeHandler.stopSession(message.sessionId, client.accessIdentity, message.projectId, provider)
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
          const provider = this.validateOptionalProvider(message.provider);
          if (provider === null) {
            this.sendError(ws, this.getUnsupportedProviderMessage(message.provider));
            break;
          }

          if (
            message.sessionId
            && !this.claudeHandler.canAccessSession(message.sessionId, client.accessIdentity, message.projectId, provider)
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

      case 'keepalive':
        {
          const client = this.getClientByWebSocket(ws);
          if (!client || !client.authenticated) {
            break;
          }

          this.logDebug('Received keepalive', {
            clientId: client.id,
            reason: message.reason
          });
        }
        break;

      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleSettingsRequest(ws: WebSocket, message: ClientMessage, client: Client | null) {
    const action = (message as any).action || 'list';
    const validatedProvider = this.validateOptionalProvider(message.provider);
    const provider = validatedProvider || DEFAULT_PROVIDER;

    if (!client || !client.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    if (validatedProvider === null) {
      ws.send(JSON.stringify({
        type: 'settings_error',
        action,
        provider: message.provider,
        error: this.getUnsupportedProviderMessage(message.provider),
        supportedProviders: SUPPORTED_PROVIDERS,
        timestamp: Date.now()
      }));
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
      supportedProviders: Provider[];
    } = {
      type: 'auth_success',
      clientId,
      accessMode: accessIdentity.accessMode,
      ...(accessIdentity.ownerId ? { ownerId: accessIdentity.ownerId } : {}),
      permissions: accessIdentity.permissions,
      supportedProviders: SUPPORTED_PROVIDERS,
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
    const validatedProvider = this.validateOptionalProvider(message.provider);
    if (validatedProvider === null) {
      const errorMessage = this.getUnsupportedProviderMessage(message.provider);
      ws.send(JSON.stringify({
        type: 'claude_error',
        error: errorMessage,
        code: 'UNSUPPORTED_PROVIDER',
        sessionId,
        provider: message.provider,
        supportedProviders: SUPPORTED_PROVIDERS,
        timestamp: Date.now()
      }));
      return;
    }

    const provider = validatedProvider || DEFAULT_PROVIDER;

    console.log(chalk.magenta('[Chat]'), 'Request received', {
      provider,
      sessionId: sessionId || '(new)',
      projectId: projectId || '(none)',
      attachments: attachments?.length || 0,
      clientId
    });

    void this.claudeHandler.handleClaudeMessage(
      ws,
      content,
      (code, errorMsg) => {
        console.log(chalk.red('[chat]'), `Chat error: ${errorMsg}`);
        ws.send(JSON.stringify({
          type: 'claude_error',
          error: errorMsg,
          code,
          sessionId,
          provider,
          timestamp: Date.now()
        }));
      },
      sessionId,
      projectId,
      attachments,
      provider,
      client.accessIdentity
    ).catch((error: unknown) => {
      const normalizedErrorMessage = error instanceof Error ? error.message : 'Failed to process chat request';

      console.error(
        chalk.red('[chat]'),
        `Failed to process request for provider ${provider}:`,
        error
      );

      try {
        ws.send(JSON.stringify({
          type: 'claude_error',
          error: normalizedErrorMessage,
          code: 'STREAM_ERROR',
          sessionId,
          provider,
          timestamp: Date.now()
        }));
      } catch {
        // Ignore closed sockets.
      }
    });
  }

  private handleSessionAction(ws: WebSocket, message: ClientMessage) {
    const clientId = this.getClientIdByWebSocket(ws);
    const client = this.getClientByWebSocket(ws);

    if (!clientId || !client?.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }
    const provider = this.validateOptionalProvider(message.provider);
    if (provider === null) {
      this.sendError(ws, this.getUnsupportedProviderMessage(message.provider));
      return;
    }

    void this.claudeHandler.handleSessionAction(
      ws,
      (message.action || 'list') as any,
      message.sessionId,
      message.projectId,
      message.title,
      message.limit,
      message.beforeIndex,
      provider,
      client.accessIdentity,
      message.cwd
    ).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process session request';
      console.error(
        chalk.red('[session]'),
        `Failed to process "${message.action || 'list'}" action for provider ${provider || DEFAULT_PROVIDER}:`,
        error
      );
      this.sendError(ws, errorMessage);
    });
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
