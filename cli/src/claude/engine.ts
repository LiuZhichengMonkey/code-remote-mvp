import { spawn, exec } from 'child_process';
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

      // 超时处理
      const timeout = setTimeout(() => {
        proc.kill();
        this.cliAvailable = false;
        resolve(false);
      }, 5000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        this.cliAvailable = code === 0;
        resolve(code === 0);
      });
      proc.on('error', () => {
        clearTimeout(timeout);
        this.cliAvailable = false;
        resolve(false);
      });
    });
  }

  async sendMessage(
    message: string,
    messages: ClaudeMessage[],
    onChunk: (content: string, done: boolean, thinking?: string) => void,
    claudeSessionId?: string
  ): Promise<{ response: string; claudeSessionId?: string }> {
    const useCLI = this.config.preferCLI && await this.detectClaudeCLI();

    if (useCLI) {
      return this.callClaudeCLI(message, onChunk, claudeSessionId);
    } else {
      const response = await this.callAnthropicAPI(messages, onChunk);
      return { response, claudeSessionId };
    }
  }

  private async callClaudeCLI(
    prompt: string,
    onChunk: (content: string, done: boolean, thinking?: string) => void,
    claudeSessionId?: string
  ): Promise<{ response: string; claudeSessionId?: string }> {
    return new Promise((resolve, reject) => {
      // 设置环境变量
      const env = {
        ...process.env,
        CLAUDECODE: '',
        CLAUDE_CODE: ''
      };

      console.log('[Claude CLI] Starting stream...');
      console.log('[Claude CLI] Prompt:', prompt.substring(0, 50) + '...');
      console.log('[Claude CLI] Resume session:', claudeSessionId || 'new session');

      const args = [
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        '--include-partial-messages',
      ];

      // 添加 --resume 参数恢复会话
      if (claudeSessionId) {
        args.push('--resume', claudeSessionId);
      }

      args.push(prompt);

      console.log('[Claude CLI] Args:', args.join(' '));

      // 使用 stream-json 格式获取实时流式输出
      const proc = spawn('claude', args, {
        cwd: 'E:/code-remote-mvp',
        env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let fullResponse = '';
      let fullThinking = '';
      let stderr = '';
      let responseSessionId = claudeSessionId;

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        console.log('[Claude CLI] stdout chunk:', chunk.length, 'bytes');

        // 解析 stream-json 格式 - 每行是一个 JSON 对象
        const lines = chunk.split('\n').filter((line: string) => line.trim());
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            console.log('[Claude CLI] JSON type:', json.type, '| event type:', json.event?.type);

            // 检查是否是错误响应
            if (json.type === 'error' || json.is_error) {
              const errorMsg = json.error?.message || json.message || 'Unknown error';
              console.error('[Claude CLI] API Error:', errorMsg);
              reject(new Error(`Claude API error: ${errorMsg}`));
              proc.kill();
              return;
            }

            // 处理流式事件 (使用 --include-partial-messages 时)
            if (json.type === 'stream_event' && json.event?.type === 'content_block_delta') {
              const delta = json.event.delta;
              console.log('[Claude CLI] Delta type:', delta?.type, '| text:', delta?.text?.substring(0, 20));

              // 处理 thinking 内容
              if (delta?.type === 'thinking_delta' && delta.thinking) {
                const thinkingText = delta.thinking;
                console.log('[Claude CLI] Thinking:', thinkingText.substring(0, 50));
                fullThinking += thinkingText;
                // 发送 thinking 更新
                if (this.config.streamMode === 'realtime') {
                  onChunk('', false, thinkingText);
                }
              }
              // 处理文本内容
              else if (delta?.type === 'text_delta' && delta.text) {
                const text = delta.text;
                console.log('[Claude CLI] Stream text:', text);
                fullResponse += text;
                // 实时发送到客户端
                if (this.config.streamMode === 'realtime') {
                  onChunk(text, false);
                }
              }
            }
            // 处理完整的 assistant 消息 (作为备用)
            else if (json.type === 'assistant' && json.message?.content) {
              for (const block of json.message.content) {
                // 处理 thinking block
                if (block.type === 'thinking' && block.thinking) {
                  fullThinking += block.thinking;
                  if (this.config.streamMode === 'realtime') {
                    onChunk('', false, block.thinking);
                  }
                }
                // 处理 text block
                if (block.type === 'text' && block.text) {
                  const text = block.text;
                  // 检查文本是否包含 API 错误
                  if (text.includes('API Error:') || text.includes('429')) {
                    console.error('[Claude CLI] API Error in text:', text.substring(0, 100));
                    reject(new Error(text));
                    proc.kill();
                    return;
                  }
                  // 只有在没有收到流式事件时才使用完整消息
                  if (!fullResponse) {
                    fullResponse = text;
                    if (this.config.streamMode === 'realtime') {
                      onChunk(text, false);
                    }
                  }
                }
              }
            }
            // result 类型包含最终结果
            else if (json.type === 'result') {
              if (json.is_error) {
                reject(new Error(json.result || 'Unknown error'));
                return;
              }
              // 提取 session ID
              if (json.session_id) {
                responseSessionId = json.session_id;
                console.log('[Claude CLI] Session ID:', responseSessionId);
              }
            }
            // 从其他响应中提取 session ID
            if (json.sessionId && !responseSessionId) {
              responseSessionId = json.sessionId;
            }
          } catch (e) {
            // 如果不是 JSON，忽略
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log('[Claude CLI] stderr:', chunk.substring(0, 100));
      });

      // 设置 2 分钟超时
      const timeout = setTimeout(() => {
        console.error('[Claude CLI] TIMEOUT');
        proc.kill();
        reject(new Error('Claude CLI timeout (120s)'));
      }, 120000);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[Claude CLI] Process error:', err.message);
        reject(new Error(`Claude CLI error: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        console.log('[Claude CLI] Closed, code:', code, 'response length:', fullResponse.length);

        if (code !== 0 && !fullResponse) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
          return;
        }

        // 发送完成信号
        if (this.config.streamMode === 'realtime') {
          onChunk('', true);
        } else {
          onChunk(fullResponse, true);
        }

        resolve({
          response: fullResponse,
          claudeSessionId: responseSessionId
        });
      });
    });
  }

  private async callAnthropicAPI(
    messages: ClaudeMessage[],
    onChunk: (content: string, done: boolean, thinking?: string) => void
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
      let fullThinking = '';

      const stream = await client.messages.stream({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 4096,
        // 启用 extended thinking
        thinking: {
          type: 'enabled',
          budget_tokens: 10000
        },
        messages: formattedMessages
      });

      // 监听 thinking 事件
      stream.on('contentBlockStart', (event: any) => {
        if (event.content_block?.type === 'thinking') {
          console.log('[Claude API] Thinking block started');
        }
      });

      stream.on('contentBlockDelta', (event: any) => {
        if (event.delta?.type === 'thinking_delta') {
          const thinking = event.delta.thinking || '';
          fullThinking += thinking;
          if (this.config.streamMode === 'realtime') {
            onChunk('', false, thinking);
          }
        }
      });

      stream.on('text', (text: string) => {
        fullResponse += text;
        if (this.config.streamMode === 'realtime') {
          onChunk(text, false);
        }
      });

      await stream.finalMessage();

      if (this.config.streamMode === 'segmented') {
        onChunk(fullResponse, true, fullThinking);
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
