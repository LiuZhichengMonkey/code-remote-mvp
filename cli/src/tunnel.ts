import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TunnelConfig {
  enabled: boolean;
  host?: string;
  port: number;
  type: 'cloudflare' | 'frp' | 'ngrok' | 'custom';
}

export interface TunnelStatus {
  active: boolean;
  url?: string;
  type?: string;
}

export class TunnelManager {
  private config: TunnelConfig;
  private process: any = null;

  constructor(config: TunnelConfig) {
    this.config = config;
  }

  async start(): Promise<TunnelStatus> {
    if (!this.config.enabled) {
      console.log(chalk.yellow('[info]'), 'Tunnel disabled. Direct connection only.');
      return { active: false };
    }

    switch (this.config.type) {
      case 'cloudflare':
        return this.startCloudflareTunnel();
      case 'ngrok':
        return this.startNgrokTunnel();
      case 'frp':
        return this.startFrpTunnel();
      case 'custom':
        return this.startCustomTunnel();
      default:
        throw new Error(`Unknown tunnel type: ${this.config.type}`);
    }
  }

  private async checkCommandExists(command: string): Promise<boolean> {
    try {
      await execAsync(`which ${command}`);
      return true;
    } catch {
      // Try Windows
      try {
        await execAsync(`where ${command}`);
        return true;
      } catch {
        return false;
      }
    }
  }

  private async startCloudflareTunnel(): Promise<TunnelStatus> {
    console.log(chalk.blue('[check]'), 'Checking for cloudflared...');

    const exists = await this.checkCommandExists('cloudflared');
    if (!exists) {
      console.log(chalk.red('[error]'), 'cloudflared not found.');
      console.log();
      console.log(chalk.yellow('To install cloudflared:'));
      console.log(chalk.gray('  On macOS:'), 'brew install cloudflared');
      console.log(chalk.gray('  On Linux:'), 'wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64');
      console.log(chalk.gray('              sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared'));
      console.log(chalk.gray('              sudo chmod +x /usr/local/bin/cloudflared'));
      console.log(chalk.gray('  On Windows:'), 'winget install --id Cloudflare.cloudflared');
      console.log();
      console.log(chalk.cyan('Or download from:'), 'https://github.com/cloudflare/cloudflared/releases');
      console.log();

      return { active: false };
    }

    try {
      console.log(chalk.blue('[start]'), 'Starting Cloudflare tunnel...');

      // Start quick tunnel
      this.process = exec(`cloudflared tunnel --url http://localhost:${this.config.port}`);

      this.process.stderr?.on('data', (data: string) => {
        const output = data.toString();
        // Try to extract URL from output
        const urlMatch = output.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
        if (urlMatch) {
          const url = urlMatch[0];
          console.log(chalk.green('[ok]'), `Tunnel URL: ${chalk.cyan(url)}`);
          console.log(chalk.gray('-'.repeat(50)));
        }
      });

      this.process.stdout?.on('data', (data: string) => {
        console.log(data.toString());
      });

      // Wait a bit for the tunnel to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      return { active: true, type: 'cloudflare' };
    } catch (error) {
      console.error(chalk.red('Error starting tunnel:'), error);
      return { active: false };
    }
  }

  private async startNgrokTunnel(): Promise<TunnelStatus> {
    console.log(chalk.blue('[check]'), 'Checking for ngrok...');

    const exists = await this.checkCommandExists('ngrok');
    if (!exists) {
      console.log(chalk.red('[error]'), 'ngrok not found.');
      console.log(chalk.yellow('Please install ngrok from:'), 'https://ngrok.com/download');
      return { active: false };
    }

    try {
      console.log(chalk.blue('[start]'), 'Starting ngrok tunnel...');
      this.process = exec(`ngrok http ${this.config.port}`);

      this.process.stdout?.on('data', (data: string) => {
        const output = data.toString();
        console.log(output);
      });

      await new Promise(resolve => setTimeout(resolve, 3000));

      return { active: true, type: 'ngrok' };
    } catch (error) {
      console.error(chalk.red('Error starting ngrok:'), error);
      return { active: false };
    }
  }

  private async startFrpTunnel(): Promise<TunnelStatus> {
    console.log(chalk.yellow('[info]'), 'FRP requires manual configuration.');
    console.log(chalk.gray('Please configure your frpc client manually.'));
    return { active: false };
  }

  private async startCustomTunnel(): Promise<TunnelStatus> {
    if (!this.config.host) {
      console.log(chalk.red('[error]'), 'Custom tunnel requires a host.');
      return { active: false };
    }

    console.log(chalk.green('[ok]'), `Using custom tunnel: ${this.config.host}`);
    return { active: true, type: 'custom', url: `wss://${this.config.host}` };
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      console.log(chalk.yellow('[stop]'), 'Tunnel stopped.');
    }
  }

  displayInstructions() {
    console.log();
    console.log(chalk.bold.cyan('Tunnel Options'));
    console.log(chalk.gray('-'.repeat(50)));
    console.log();
    console.log(chalk.yellow('1. Cloudflare Tunnel (Recommended - Free)'));
    console.log(chalk.gray('   Install:'), 'brew install cloudflared (macOS)');
    console.log(chalk.gray('            winget install Cloudflare.cloudflared (Windows)'));
    console.log();
    console.log(chalk.yellow('2. ngrok (Free tier available)'));
    console.log(chalk.gray('   Install:'), 'https://ngrok.com/download');
    console.log();
    console.log(chalk.yellow('3. Custom'));
    console.log(chalk.gray('   If you have your own tunnel setup,'), 'use --host');
    console.log();
  }
}
