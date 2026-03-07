#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { CodeRemoteServer } from './server.js';
import { MessageHandler } from './handler.js';
import { AuthManager } from './auth.js';
import { TunnelManager } from './tunnel.js';

// Export ImageHandler and related types
export { ImageHandler } from './imageHandler.js';
export { ImageConfig } from './types/image.js';
export type {
  ImageMeta,
  ImageTransferState,
  ImageSuccessResponse,
  ImageErrorResponse
} from './types/image.js';

// Store server instance for cleanup
let server: CodeRemoteServer | null = null;
let tunnelManager: any = null;

// Cleanup on exit
const cleanup = () => {
  if (tunnelManager) {
    tunnelManager.stop();
  }
  if (server) {
    server.close();
  }
  console.log(chalk.yellow('→'), 'CodeRemote stopped.');
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

program
  .name('code-remote')
  .description('CodeRemote - Control Claude Code from your phone')
  .version('1.0.0');

program
  .command('start')
  .description('Start the CodeRemote server')
  .option('-p, --port <number>', 'Port to listen on', '8080')
  .option('-t, --token <token>', 'Custom auth token')
  .option('-w, --workspace <path>', 'Workspace root directory')
  .option('--tunnel <type>', 'Enable tunnel (cloudflare, ngrok, frp)', 'cloudflare')
  .option('--host <host>', 'Custom tunnel host URL')
  .option('--no-tunnel', 'Disable tunneling')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    console.log();
    console.log(chalk.bold.cyan(`
╔════════════════════════════════════════╗
║         CodeRemote Server            ║
║    Remote Control Your Code          ║
╚════════════════════════════════════════╝
    `));
    console.log();

    const port = parseInt(options.port, 10);
    const verbose = options.verbose;
    const workspace = options.workspace || process.cwd();

    // Create auth manager
    const auth = new AuthManager(options.token);

    // Create server with workspace
    server = new CodeRemoteServer(port, auth.getToken(), workspace);

    // Create message handler
    const messageHandler = new MessageHandler();

    // Set up message handling
    server.onMessage(async (clientId, content) => {
      const response = await messageHandler.handleMessage(clientId, content);
      server!.sendToClient(clientId, response);
    });

    server.onConnection((clientId) => {
      console.log(chalk.green('✓'), `Client ${chalk.cyan(clientId)} connected`);
      server!.sendToClient(clientId, '🎉 Connected to CodeRemote! Send me a message to get started.');
    });

    server.onDisconnection((clientId) => {
      console.log(chalk.yellow('→'), `Client ${chalk.cyan(clientId)} disconnected`);
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 500));

    // Handle tunneling
    if (options.tunnel !== false) {
      const TunnelManagerModule = await import('./tunnel.js');
      const TunnelManagerClass = TunnelManagerModule.TunnelManager;

      const tunnelConfig = {
        enabled: true,
        port,
        type: options.tunnel as 'cloudflare' | 'ngrok' | 'frp' | 'custom',
        host: options.host
      };

      tunnelManager = new TunnelManagerClass(tunnelConfig);
      await tunnelManager.start();
    }

    // Display connection info
    console.log();
    console.log(chalk.bold('📱 Connection Information'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
    console.log(chalk.cyan('Local URL:'), `ws://localhost:${port}`);
    console.log(chalk.yellow('Token:'),     auth.getToken());
    console.log();

    // Display QR code
    const QRCodeGeneratorModule = await import('./qrcode.js');
    const QRCodeGeneratorClass = QRCodeGeneratorModule.QRCodeGenerator;

    QRCodeGeneratorClass.display({
      host: 'localhost',
      port,
      token: auth.getToken()
    });

    // Display instructions
    QRCodeGeneratorClass.displayInstructions();

    // Interactive mode
    if (verbose) {
      console.log(chalk.gray('Press Ctrl+C to stop...'));
    }

    console.log();
    console.log(chalk.green('✓'), 'CodeRemote is ready and waiting for connections!');
    console.log();

    // Keep process alive
    process.stdin.resume();
  });

program
  .command('token')
  .description('Generate a new auth token')
  .option('-l, --length <number>', 'Token length', '32')
  .action((options) => {
    const { v4: uuidv4 } = require('uuid');
    const token = uuidv4().substring(0, parseInt(options.length, 10));
    console.log(chalk.green('Token:'), token);
  });

program
  .command('test')
  .description('Test the WebSocket connection')
  .option('-u, --url <url>', 'Server URL', 'ws://localhost:8080')
  .option('-t, --token <token>', 'Auth token')
  .action(async (options) => {
    const WebSocket = (await import('ws')).default;
    const token = options.token || require('uuid').v4();

    console.log(chalk.blue('→'), `Connecting to ${options.url}...`);

    const ws = new WebSocket(options.url);

    ws.on('open', () => {
      console.log(chalk.green('✓'), 'Connected!');
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      console.log(chalk.cyan('Received:'), message);

      if (message.type === 'auth_success') {
        ws.send(JSON.stringify({ type: 'message', content: 'Hello from test!' }));
        setTimeout(() => {
          ws.close();
          console.log(chalk.green('✓'), 'Test complete!');
        }, 1000);
      }
    });

    ws.on('error', (error) => {
      console.error(chalk.red('Error:'), error.message);
    });

    ws.on('close', () => {
      console.log(chalk.yellow('→'), 'Connection closed');
    });
  });

// Parse arguments
program.parse();
