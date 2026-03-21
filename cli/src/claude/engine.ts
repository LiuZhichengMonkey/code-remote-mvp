import { spawn, exec } from 'child_process';
import { ClaudeConfig, ClaudeMessage, DEFAULT_CONFIG, ToolUseEvent, ToolResultEvent, LogMessage } from './types';

export class ClaudeCodeEngine {
  private config: ClaudeConfig;
  private cliAvailable: boolean | null = null;
  private maxRetries: number = 3; // 最大重试次数
  private baseRetryDelay: number = 2000; // 基础重试延迟（毫秒）
  private currentProcess: ReturnType<typeof spawn> | null = null; // 当前运行的进程
  private intentionallyStopped: boolean = false; // 标记是否是主动停止

  constructor(config: Partial<ClaudeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // 停止当前运行的 Claude CLI 进程
  stop(): boolean {
    if (this.currentProcess) {
      const pid = this.currentProcess.pid;
      this.intentionallyStopped = true; // 标记为主动停止
      console.log('[ClaudeCodeEngine] Stopping current process, PID:', pid);

      // Windows 上需要使用 taskkill 来杀死进程树
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          // 使用 taskkill /T /F 强制杀死进程及其子进程
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          console.log('[ClaudeCodeEngine] Process killed via taskkill');
        } catch (e) {
          console.log('[ClaudeCodeEngine] taskkill failed, trying proc.kill()');
          this.currentProcess.kill();
        }
      } else {
        this.currentProcess.kill('SIGTERM');
      }

      this.currentProcess = null;
      return true;
    }
    return false;
  }

  // 检查是否有正在运行的进程
  isRunning(): boolean {
    return this.currentProcess !== null;
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
    onChunk: (content: string, done: boolean, thinking?: string, toolEvent?: ToolUseEvent | ToolResultEvent) => void,
    onLog: (log: LogMessage) => void,
    claudeSessionId?: string,
    cwd?: string,
    agentConfig?: { name: string; description?: string; systemPrompt?: string; tools?: string[] } | null,
    _imagePaths: string[] = []
  ): Promise<{ response: string; claudeSessionId?: string }> {
    const useCLI = this.config.preferCLI && await this.detectClaudeCLI();

    // 自动重试逻辑
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (useCLI) {
          return await this.callClaudeCLI(message, onChunk, onLog, claudeSessionId, cwd, agentConfig);
        } else {
          const response = await this.callAnthropicAPI(messages, onChunk, onLog);
          return { response, claudeSessionId };
        }
      } catch (error: any) {
        const errorMsg = error.message || '';
        const is429Error = errorMsg.includes('429') ||
                          errorMsg.includes('rate limit') ||
                          errorMsg.includes('Rate limit') ||
                          errorMsg.includes('overloaded');

        if (is429Error && attempt < this.maxRetries) {
          // 计算重试延迟（指数退避）
          const delay = this.baseRetryDelay * Math.pow(2, attempt);
          console.log(`[Claude] Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);

          // 通知前端重试状态
          onChunk(`[Rate limit] Retrying in ${Math.round(delay / 1000)}s... (attempt ${attempt + 1}/${this.maxRetries})`, false);

          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = error;
        } else {
          throw error;
        }
      }
    }

    // 如果所有重试都失败，抛出最后一个错误
    throw lastError || new Error('Max retries exceeded');
  }

  private async callClaudeCLI(
    prompt: string,
    onChunk: (content: string, done: boolean, thinking?: string, toolEvent?: ToolUseEvent | ToolResultEvent) => void,
    onLog: (log: LogMessage) => void,
    claudeSessionId?: string,
    cwd?: string,
    agentConfig?: { name: string; description?: string; systemPrompt?: string; tools?: string[] } | null
  ): Promise<{ response: string; claudeSessionId?: string }> {
    return new Promise((resolve, reject) => {
      // 删除嵌套会话检测的环境变量
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE;
      delete env.CLAUDE_CODE_SKIP_NESTED_CHECK;

      // 使用会话的原始工作目录，如果没有则使用默认目录
      // 注意：Claude CLI 会在 .claude/projects/<project>/ 目录下查找会话文件
      let cliCwd = cwd || 'E:/code-remote-mvp';

      // 如果 cwd 是 E:\code-remote-mvp\cli，需要转换为项目根目录
      if (cliCwd.endsWith('\\cli') || cliCwd.endsWith('/cli')) {
        cliCwd = cliCwd.replace(/[\\/]cli$/, '');
      }

      // 发送日志到前端
      const sendLog = (level: 'info' | 'debug' | 'warn' | 'error', message: string) => {
        console.log(`[Claude CLI] ${message}`);
        onLog({ level, message, timestamp: Date.now() });
      };

      sendLog('info', 'Starting stream...');
      sendLog('debug', `Prompt: ${prompt}`);
      sendLog('debug', `Resume session: ${claudeSessionId || 'new session'}`);
      sendLog('debug', `CWD: ${cliCwd}`);

      const args = [
        '--print',
        '--verbose',
        '--dangerously-skip-permissions',
        '--permission-mode', 'bypassPermissions',
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--mcp-config', 'E:/code-remote-mvp/cli/mcp-config.json'
      ];

      // 添加 --resume 参数恢复会话
      if (claudeSessionId) {
        args.push('--resume', claudeSessionId);
      }

      // 如果有 agent 配置，使用 --agents 定义 agent
      // Claude Code 会根据 description 匹配并创建独立的 subagent 会话
      if (agentConfig) {
        sendLog('info', `Defining subagent: ${agentConfig.name}`);

        // 构建 agent JSON 配置
        // 支持的字段：description, prompt, tools
        const agentJson: {
          description: string;
          prompt?: string;
          tools?: string[];
        } = {
          // description 非常重要：决定何时触发 subagent
          // 使用强制触发格式，确保一定会调用
          description: `IMMEDIATELY use this agent when the user's request matches. ${agentConfig.description || `${agentConfig.name} agent`}`
        };

        if (agentConfig.systemPrompt) {
          agentJson.prompt = agentConfig.systemPrompt;
        }

        // 工具限制：只允许使用指定的工具
        if (agentConfig.tools && agentConfig.tools.length > 0) {
          agentJson.tools = agentConfig.tools;
        }

        // 使用 --agents 定义 agent（不使用 --agent 切换主会话）
        args.push('--agents', JSON.stringify({ [agentConfig.name]: agentJson }));
      }

      // 打印完整命令便于调试（不包含 prompt）
      console.log('[Claude CLI] Command args: claude ' + args.join(' '));

      // 使用 stdin 传递 prompt，避免 shell 解析多行文本的问题
      const proc = spawn('claude', [...args, '--'], {
        cwd: cliCwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']  // stdin 可写
      });

      // 通过 stdin 写入 prompt
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      // 保存当前进程引用以便后续停止
      this.currentProcess = proc;
      console.log('[ClaudeCodeEngine] Started process with PID:', proc.pid);

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
              sendLog('error', `API Error: ${errorMsg}`);
              reject(new Error(`Claude API error: ${errorMsg}`));
              proc.kill();
              return;
            }

            // 处理流式事件 (使用 --include-partial-messages 时)
            if (json.type === 'stream_event' && json.event?.type === 'content_block_delta') {
              const delta = json.event.delta;
              console.log('[Claude CLI] Delta:', JSON.stringify(delta)?.substring(0, 200));

              // 处理 thinking 内容
              if (delta?.type === 'thinking_delta' && delta.thinking) {
                const thinkingText = delta.thinking;
                console.log('[Claude CLI] Thinking delta (length:', thinkingText.length, 'has newlines:', thinkingText.includes('\n') ? 'YES' : 'NO', ')');
                // 不再每个 delta 都发送 log，避免刷屏
                fullThinking += thinkingText;
                // 发送 thinking 更新
                if (this.config.streamMode === 'realtime') {
                  onChunk('', false, thinkingText);
                }
              }
              // 处理文本内容
              else if (delta?.type === 'text_delta' && delta.text) {
                const text = delta.text;
                // 检查换行符
                const hasNewlines = text.includes('\n');
                console.log('[Claude CLI] Stream text:', text.substring(0, 50), '| has newlines:', hasNewlines);

                // 直接发送文本内容，不收集为工具结果
                // Claude的解释文本应该作为普通内容显示
                fullResponse += text;
                if (this.config.streamMode === 'realtime') {
                  onChunk(text, false);
                }
              }
              // 处理工具输入 (input_json_delta)
              else if (delta?.type === 'input_json_delta' && delta.partial_json) {
                console.log('[Claude CLI] Tool input partial:', delta.partial_json.substring(0, 50));
              }
            }
            // 处理内容块开始事件 (包含 tool_use)
            else if (json.type === 'stream_event' && json.event?.type === 'content_block_start') {
              const contentBlock = json.event.content_block;
              if (contentBlock?.type === 'tool_use') {
                const toolEvent: ToolUseEvent = {
                  type: 'tool_use',
                  toolName: contentBlock.name || 'unknown',
                  toolInput: contentBlock.input,
                  toolUseId: contentBlock.id
                };
                sendLog('info', `🔧 Tool: ${toolEvent.toolName}`);
                if (this.config.streamMode === 'realtime') {
                  onChunk('', false, undefined, toolEvent);
                }
              }
            }
            // 处理完整的 assistant 消息 (作为备用)
            else if (json.type === 'assistant') {
              console.log('[Claude CLI] Assistant message received, has message:', !!json.message, 'has content:', !!json.message?.content);
              if (json.message?.content) {
                for (const block of json.message.content) {
                  console.log('[Claude CLI] Assistant block type:', block.type);
                  // 处理 thinking block - 只有在流式没有发送过时才发送
                  if (block.type === 'thinking' && block.thinking) {
                    const hasNewlines = block.thinking.includes('\n');
                    console.log('[Claude CLI] Assistant thinking block: length=', block.thinking.length, 'has newlines:', hasNewlines, 'fullThinking length=', fullThinking.length);
                    // 如果流式已经发送过 thinking，跳过完整消息中的 thinking
                    if (!fullThinking) {
                      fullThinking = block.thinking;
                      if (this.config.streamMode === 'realtime') {
                        onChunk('', false, block.thinking);
                      }
                    }
                  }
                  // 处理 text block
                  if (block.type === 'text' && block.text) {
                    const text = block.text;
                    const hasNewlines = text.includes('\n');
                    console.log('[Claude CLI] Assistant text block: length=', text.length, 'has newlines:', hasNewlines, 'fullResponse length=', fullResponse.length);
                    // 检查文本是否包含 API 错误
                    if (text.includes('API Error:') || text.includes('429')) {
                      sendLog('error', `API Error in text: ${text.substring(0, 100)}`);
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
            }
            // result 类型包含最终结果
            else if (json.type === 'result') {
              if (json.is_error) {
                reject(new Error(json.result || 'Unknown error'));
                return;
              }
              // 调试：检查 result 中的换行符
              if (json.result) {
                const hasNewlines = json.result.includes('\n');
                console.log('[Claude CLI] Result type: length=', json.result.length, 'has newlines:', hasNewlines);
                if (hasNewlines) {
                  console.log('[Claude CLI] Result newlines count:', (json.result.match(/\n/g) || []).length);
                }
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

      // 设置 5 分钟超时
      const timeout = setTimeout(() => {
        console.error('[Claude CLI] TIMEOUT');
        proc.kill();
        reject(new Error('Claude CLI timeout (300s)'));
      }, 300000);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[Claude CLI] Process error:', err.message);
        reject(new Error(`Claude CLI error: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        console.log('[Claude CLI] Closed, code:', code, 'response length:', fullResponse.length);

        // 清除当前进程引用和停止标记
        if (this.currentProcess === proc) {
          this.currentProcess = null;
        }
        const wasIntentionallyStopped = this.intentionallyStopped;
        this.intentionallyStopped = false; // 重置标记

        // 如果是主动停止，不显示错误
        if (code !== 0 && !fullResponse && !wasIntentionallyStopped) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
          return;
        }

        // 主动停止时，发送完成信号
        if (wasIntentionallyStopped) {
          sendLog('info', '⏹ Response stopped by user');
          if (this.config.streamMode === 'realtime') {
            onChunk('', true);
          } else {
            onChunk(fullResponse, true);
          }
          resolve({
            response: fullResponse,
            claudeSessionId: responseSessionId
          });
          return;
        }

        // 发送完成信号
        sendLog('info', '✅ Response completed');
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
    onChunk: (content: string, done: boolean, thinking?: string) => void,
    onLog: (log: LogMessage) => void
  ): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('API Key not configured. Set ANTHROPIC_API_KEY environment variable or configure in config.');
    }

    // 发送日志到前端
    const sendLog = (level: 'info' | 'debug' | 'warn' | 'error', message: string) => {
      console.log(`[Claude API] ${message}`);
      onLog({ level, message, timestamp: Date.now() });
    };

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.config.apiKey });

      const formattedMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      sendLog('info', 'Starting API stream...');
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
          sendLog('debug', 'Thinking block started');
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

      sendLog('info', '✅ Response completed');
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
