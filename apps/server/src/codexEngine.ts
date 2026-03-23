import { spawn } from 'child_process';
import { ClaudeMessage, LogMessage, ToolResultEvent, ToolUseEvent } from './claude/types';

type ChunkCallback = (
  content: string,
  done: boolean,
  thinking?: string,
  toolEvent?: ToolUseEvent | ToolResultEvent
) => void;

type LogCallback = (log: LogMessage) => void;

const DEFAULT_CODEX_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CODEX_COMPLETION_GRACE_MS = 15 * 1000;

function getConfiguredTimeoutMs(envKey: string, fallback: number): number {
  const rawValue = process.env[envKey];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatCommandResult(item: any): string {
  const parts: string[] = [];

  if (typeof item.command === 'string' && item.command.trim()) {
    parts.push(item.command.trim());
  }

  if (typeof item.aggregated_output === 'string' && item.aggregated_output.trim()) {
    parts.push(item.aggregated_output.trim());
  }

  if (typeof item.exit_code === 'number') {
    parts.push(`Exit code: ${item.exit_code}`);
  }

  return parts.join('\n\n');
}

function parseFunctionArguments(rawArguments: unknown): Record<string, unknown> | undefined {
  if (typeof rawArguments !== 'string' || !rawArguments.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { raw: rawArguments };
  }
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('')
    .trim();
}

export class CodexCodeEngine {
  private cliAvailable: boolean | null = null;
  private currentProcess: ReturnType<typeof spawn> | null = null;
  private intentionallyStopped = false;

  private getCodexCommand(): string {
    return process.env.CODEX_CLI_COMMAND?.trim() || 'codex';
  }

  stop(): boolean {
    if (!this.currentProcess) {
      return false;
    }

    const pid = this.currentProcess.pid;
    this.intentionallyStopped = true;
    console.log('[CodexCodeEngine] Stopping current process, PID:', pid);

    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } catch {
        this.currentProcess.kill();
      }
    } else {
      this.currentProcess.kill('SIGTERM');
    }

    this.currentProcess = null;
    return true;
  }

  isRunning(): boolean {
    return this.currentProcess !== null;
  }

  async detectCodexCLI(): Promise<boolean> {
    if (this.cliAvailable !== null) {
      return this.cliAvailable;
    }

    return new Promise((resolve) => {
      const proc = spawn(this.getCodexCommand(), ['--version'], { shell: true });
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
    _messages: ClaudeMessage[],
    onChunk: ChunkCallback,
    onLog: LogCallback,
    providerSessionId?: string,
    cwd?: string,
    _agentConfig?: { name: string; description?: string; systemPrompt?: string; tools?: string[] } | null,
    imagePaths: string[] = []
  ): Promise<{ response: string; providerSessionId?: string }> {
    const cliAvailable = await this.detectCodexCLI();
    if (!cliAvailable) {
      throw new Error('Codex CLI not found');
    }

    return this.callCodexCLI(message, onChunk, onLog, providerSessionId, cwd, imagePaths);
  }

  private async callCodexCLI(
    prompt: string,
    onChunk: ChunkCallback,
    onLog: LogCallback,
    providerSessionId?: string,
    cwd?: string,
    imagePaths: string[] = []
  ): Promise<{ response: string; providerSessionId?: string }> {
    return new Promise((resolve, reject) => {
      const cliCwd = cwd || process.cwd();
      const timeoutMs = getConfiguredTimeoutMs('CODEX_CLI_TIMEOUT_MS', DEFAULT_CODEX_TIMEOUT_MS);
      const completionGraceMs = getConfiguredTimeoutMs(
        'CODEX_CLI_COMPLETION_GRACE_MS',
        DEFAULT_CODEX_COMPLETION_GRACE_MS
      );
      const sendLog = (level: 'info' | 'debug' | 'warn' | 'error', message: string) => {
        console.log(`[Codex CLI] ${message}`);
        onLog({ level, message, timestamp: Date.now() });
      };

      const imageArgs = imagePaths.flatMap(imagePath => ['--image', imagePath]);
      const sharedArgs = ['--dangerously-bypass-approvals-and-sandbox', '--json'];
      const args = providerSessionId
        ? ['-C', cliCwd, 'exec', 'resume', providerSessionId, ...sharedArgs, ...imageArgs, '-']
        : ['-C', cliCwd, 'exec', ...sharedArgs, ...imageArgs, '-'];

      sendLog('info', providerSessionId ? 'Resuming Codex session...' : 'Starting Codex session...');
      sendLog('debug', `CWD: ${cliCwd}`);
      sendLog('debug', `Images: ${imagePaths.length}`);

      const proc = spawn(this.getCodexCommand(), args, {
        cwd: cliCwd,
        env: { ...process.env },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.currentProcess = proc;
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      let stdoutBuffer = '';
      let stderr = '';
      let fullResponse = '';
      let responseSessionId = providerSessionId;
      let settled = false;
      let completionTimer: NodeJS.Timeout | null = null;
      let lastCommentaryText = '';
      let lastAssistantText = '';

      const clearCompletionTimer = () => {
        if (completionTimer) {
          clearTimeout(completionTimer);
          completionTimer = null;
        }
      };

      const clearAllTimers = () => {
        clearTimeout(timeout);
        clearCompletionTimer();
      };

      const resolveOnce = () => {
        if (settled) {
          return;
        }

        settled = true;
        clearAllTimers();

        if (this.currentProcess === proc) {
          this.currentProcess = null;
        }

        onChunk('', true);
        resolve({
          response: fullResponse,
          providerSessionId: responseSessionId
        });
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearAllTimers();

        if (this.currentProcess === proc) {
          this.currentProcess = null;
        }

        reject(error);
      };

      const handleLine = (line: string) => {
        if (settled || !line.trim()) {
          return;
        }

        try {
          const entry: any = JSON.parse(line);

          if (entry.type === 'thread.started' && entry.thread_id) {
            responseSessionId = entry.thread_id;
            return;
          }

          if (entry.type === 'turn.completed') {
            sendLog('debug', 'Turn completed');
            clearCompletionTimer();
            completionTimer = setTimeout(() => {
              sendLog('warn', `Codex CLI did not exit within ${completionGraceMs}ms after turn completion; returning collected response.`);
              proc.kill();
              resolveOnce();
            }, completionGraceMs);
            return;
          }

          if (entry.type === 'item.started' && entry.item?.type === 'command_execution') {
            const toolEvent: ToolUseEvent = {
              type: 'tool_use',
              toolName: 'Shell',
              toolInput: {
                command: entry.item.command
              },
              toolUseId: entry.item.id
            };
            onChunk('', false, undefined, toolEvent);
            return;
          }

          if (entry.type === 'item.completed' && entry.item?.type === 'command_execution') {
            const toolEvent: ToolResultEvent = {
              type: 'tool_result',
              toolUseId: entry.item.id,
              result: formatCommandResult(entry.item),
              isError: typeof entry.item.exit_code === 'number' ? entry.item.exit_code !== 0 : false
            };
            onChunk('', false, undefined, toolEvent);
            return;
          }

          if (
            entry.type === 'response_item'
            && (entry.payload?.type === 'function_call' || entry.payload?.type === 'custom_tool_call')
          ) {
            const toolEvent: ToolUseEvent = {
              type: 'tool_use',
              toolName: entry.payload.name || 'tool',
              toolInput: parseFunctionArguments(entry.payload.arguments),
              toolUseId: entry.payload.call_id || entry.payload.id
            };
            onChunk('', false, undefined, toolEvent);
            lastCommentaryText = '';
            return;
          }

          if (
            entry.type === 'response_item'
            && (entry.payload?.type === 'function_call_output' || entry.payload?.type === 'custom_tool_call_output')
          ) {
            const toolEvent: ToolResultEvent = {
              type: 'tool_result',
              toolUseId: entry.payload.call_id || entry.payload.id,
              result: typeof entry.payload.output === 'string' ? entry.payload.output : undefined,
              isError: false
            };
            onChunk('', false, undefined, toolEvent);
            lastCommentaryText = '';
            return;
          }

          if (entry.type === 'event_msg' && entry.payload?.type === 'task_started') {
            sendLog('info', 'Codex started working');
            lastCommentaryText = '';
            return;
          }

          if (entry.type === 'event_msg' && entry.payload?.type === 'task_complete') {
            sendLog('info', 'Codex completed the response');
            lastCommentaryText = '';
            return;
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
            sendLog('debug', 'Codex generated internal reasoning');
            lastCommentaryText = '';
            return;
          }

          if (entry.type === 'event_msg' && entry.payload?.type === 'agent_message') {
            const phase = typeof entry.payload.phase === 'string' ? entry.payload.phase : '';
            const text = typeof entry.payload.message === 'string' ? entry.payload.message.trim() : '';
            if (text && phase && phase !== 'final_answer' && text !== lastCommentaryText) {
              lastCommentaryText = text;
              sendLog('info', text);
            }
            return;
          }

          if (
            entry.type === 'response_item'
            && entry.payload?.type === 'message'
            && entry.payload?.role === 'assistant'
          ) {
            const phase = typeof entry.payload.phase === 'string' ? entry.payload.phase : '';
            const text = extractAssistantText(entry.payload.content);
            if (!text) {
              return;
            }

            if (phase && phase !== 'final_answer') {
              if (text !== lastCommentaryText) {
                lastCommentaryText = text;
                sendLog('info', text);
              }
              return;
            }

            if (text === lastAssistantText) {
              return;
            }

            lastAssistantText = text;
            lastCommentaryText = '';
            const chunk = fullResponse ? `\n\n${text}` : text;
            fullResponse += chunk;
            onChunk(chunk, false);
            return;
          }

          if (entry.type === 'item.completed' && entry.item?.type === 'agent_message' && typeof entry.item.text === 'string') {
            const text = entry.item.text.trim();
            if (!text || text === lastAssistantText) {
              return;
            }

            lastAssistantText = text;
            lastCommentaryText = '';
            const chunk = fullResponse ? `\n\n${text}` : text;
            fullResponse += chunk;
            onChunk(chunk, false);
            return;
          }

          if (entry.type === 'error') {
            const errorMessage = entry.message || entry.error || 'Codex CLI error';
            rejectOnce(new Error(errorMessage));
            proc.kill();
          }
        } catch {
          // Ignore non-JSON lines.
        }
      };

      proc.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        lines.forEach(handleLine);
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill();
        rejectOnce(new Error(`Codex CLI timeout (${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);

      proc.on('error', (error) => {
        rejectOnce(new Error(`Codex CLI error: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (settled) {
          return;
        }

        clearAllTimers();

        if (stdoutBuffer.trim()) {
          handleLine(stdoutBuffer.trim());
        }

        if (this.currentProcess === proc) {
          this.currentProcess = null;
        }

        const wasIntentionallyStopped = this.intentionallyStopped;
        this.intentionallyStopped = false;

        if (code !== 0 && !wasIntentionallyStopped) {
          rejectOnce(new Error(`Codex CLI exited with code ${code}: ${stderr}`.trim()));
          return;
        }

        if (wasIntentionallyStopped) {
          sendLog('info', 'Response stopped by user');
        } else {
          sendLog('info', 'Response completed');
        }

        resolveOnce();
      });
    });
  }
}
