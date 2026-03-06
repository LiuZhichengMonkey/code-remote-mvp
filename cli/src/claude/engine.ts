import { spawn } from 'child_process';
import { ClaudeConfig, ClaudeMessage, DEFAULT_CONFIG } from './types';

export class ClaudeCodeEngine {
  private config: ClaudeConfig;
  private cliAvailable: boolean | null = null;

  constructor(config: Partial<ClaudeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async detectClaudeCLI(): Promise<boolean> {
    if (this.cliAvailable !== null) return this.cliAvailable;

    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { shell: true });
      proc.on('close', (code) => {
        this.cliAvailable = code === 0;
        resolve(code === 0);
      });
      proc.on('error', () => {
        this.cliAvailable = false;
        resolve(false);
      });
      // 超时处理
      setTimeout(() => {
        proc.kill();
        this.cliAvailable = false;
        resolve(false);
      }, 5000);
    });
  }

  async sendMessage(
    message: string,
    messages: ClaudeMessage[],
    onChunk: (content: string, done: boolean) => void
  ): Promise<string> {
    const useCLI = this.config.preferCLI && await this.detectClaudeCLI();

    if (useCLI) {
      return this.callClaudeCLI(message, onChunk);
    } else {
      return this.callAnthropicAPI(messages, onChunk);
    }
  }

  private async callClaudeCLI(
    prompt: string,
    onChunk: (content: string, done: boolean) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // 使用 --print 和 --output-format stream-json
      const proc = spawn('claude', ['--print', prompt], {
        shell: true,
        cwd: process.cwd(),
        env: { ...process.env, ANTHROPIC_DISABLE_STREAMING: '0' }
      });

      let fullResponse = '';
      let buffer = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        buffer += text;

        // 实时模式：直接推送
        if (this.config.streamMode === 'realtime') {
          onChunk(text, false);
        }
        fullResponse += text;
      });

      proc.stderr.on('data', (data) => {
        console.error('[Claude CLI stderr]', data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // 分段模式：完整推送
          if (this.config.streamMode === 'segmented') {
            onChunk(fullResponse, true);
          } else {
            onChunk('', true);
          }
          resolve(fullResponse);
        } else {
          reject(new Error(`Claude CLI exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start Claude CLI: ${err.message}`));
      });
    });
  }

  private async callAnthropicAPI(
    messages: ClaudeMessage[],
    onChunk: (content: string, done: boolean) => void
  ): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('API Key not configured. Set ANTHROPIC_API_KEY environment variable or configure in config.');
    }

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.config.apiKey });

      const formattedMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      let fullResponse = '';

      const stream = await client.messages.stream({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 4096,
        messages: formattedMessages
      });

      stream.on('text', (text: string) => {
        fullResponse += text;
        if (this.config.streamMode === 'realtime') {
          onChunk(text, false);
        }
      });

      await stream.finalMessage();

      if (this.config.streamMode === 'segmented') {
        onChunk(fullResponse, true);
      } else {
        onChunk('', true);
      }

      return fullResponse;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Anthropic API error: ${error.message}`);
      }
      throw error;
    }
  }

  updateConfig(config: Partial<ClaudeConfig>): void {
    this.config = { ...this.config, ...config };
    // 重置 CLI 检测状态
    if (config.preferCLI !== undefined) {
      this.cliAvailable = null;
    }
  }

  getConfig(): ClaudeConfig {
    return { ...this.config };
  }
}
