import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

export interface Client {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  connectedAt: Date;
}

export interface ServerMessage {
  type: 'auth_success' | 'auth_failed' | 'message' | 'error' | 'pong';
  clientId?: string;
  content?: string;
  timestamp?: number;
}

export interface ClientMessage {
  type: 'auth' | 'message' | 'ping';
  token?: string;
  content?: string;
  timestamp?: number;
}

export class CodeRemoteServer {
  private wss: WebSocketServer;
  private clients: Map<string, Client> = new Map();
  private token: string;
  private port: number;
  private messageHandler?: (clientId: string, content: string) => void;
  private connectionHandler?: (clientId: string) => void;
  private disconnectHandler?: (clientId: string) => void;

  constructor(port: number = 8080, token?: string) {
    this.port = port;
    this.token = token || uuidv4();
    this.wss = new WebSocketServer({ port });
    this.setupServer();
  }

  private setupServer() {
    this.wss.on('listening', () => {
      const address = this.wss.address() as any;
      console.log(chalk.green('✓'), chalk.bold('CodeRemote Server Started'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Port:      ${chalk.cyan(address.port)}`);
      console.log(`  Token:     ${chalk.yellow(this.token)}`);
      console.log(`  WebSocket: ${chalk.cyan(`ws://localhost:${address.port}`)}`);
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

      ws.on('message', (data: Buffer) => {
        try {
          const message: ClientMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message, pingInterval);
        } catch (error) {
          this.sendError(ws, 'Invalid message format');
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

  private handleMessage(ws: WebSocket, message: ClientMessage, pingInterval: NodeJS.Timeout) {
    switch (message.type) {
      case 'auth':
        this.handleAuth(ws, message.token, pingInterval);
        break;

      case 'message':
        this.handleClientMessage(ws, message.content);
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

    // Close server
    this.wss.close();
    console.log(chalk.yellow('→'), 'Server closed');
  }
}
