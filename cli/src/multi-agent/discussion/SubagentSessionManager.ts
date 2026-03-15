/**
 * Subagent 会话管理器
 *
 * 管理多个 Claude CLI 子进程，为每个 Agent 创建独立会话
 * 支持并发执行和实时输出收集
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentTemplate } from './types';

/**
 * Claude 会话文件存储目录
 */
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * 子会话状态
 */
export interface SubagentSession {
  id: string;
  agentId: string;
  agentName: string;
  process: ChildProcess | null;
  status: 'pending' | 'running' | 'completed' | 'error' | 'timeout';
  output: string;
  startTime: number;
  endTime?: number;
  error?: string;
  /** Claude CLI 返回的会话 ID（用于 --resume） */
  claudeSessionId?: string;
  /** Token 使用量 */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** 已发送的内容（用于去重） */
  sentContent?: Set<string>;
}

/**
 * 会话管理器配置
 */
export interface SubagentManagerConfig {
  /** 单个 Agent 超时时间（毫秒） */
  timeout?: number;
  /** 最大并发数 */
  maxConcurrency?: number;
  /** 工作目录 */
  cwd?: string;
  /** MCP 配置文件路径 */
  mcpConfigPath?: string;
}

const DEFAULT_CONFIG: SubagentManagerConfig = {
  timeout: 120000, // 2 分钟
  maxConcurrency: 3,
  cwd: 'E:/code-remote-mvp',
  mcpConfigPath: 'E:/code-remote-mvp/cli/mcp-config.json'
};

/**
 * Subagent 会话管理器
 *
 * 负责启动、管理和监控多个 Claude CLI 子进程
 * 支持会话复用以减少上下文重复
 */
export class SubagentSessionManager {
  private config: SubagentManagerConfig;
  private sessions: Map<string, SubagentSession> = new Map();
  /** Agent ID 到 Claude Session ID 的映射，用于复用会话 */
  private agentSessionMap: Map<string, string> = new Map();
  private onMessageCallback?: (agentId: string, agentName: string, content: string, done: boolean) => void;
  /** 总 Token 统计 */
  private totalTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  constructor(config?: Partial<SubagentManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取总 Token 使用量
   */
  getTotalTokenUsage(): { inputTokens: number; outputTokens: number; totalTokens: number } {
    return { ...this.totalTokenUsage };
  }

  /**
   * 重置 Token 统计
   */
  resetTokenUsage(): void {
    this.totalTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  /**
   * 设置消息回调
   */
  onMessage(callback: (agentId: string, agentName: string, content: string, done: boolean) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * 启动单个 Agent 会话
   * 支持复用已有会话（通过 --resume）
   */
  async startAgentSession(
    agent: AgentTemplate,
    prompt: string,
    context?: string
  ): Promise<string> {
    const sessionId = `subagent_${agent.id}_${Date.now()}`;

    // 创建会话记录
    const session: SubagentSession = {
      id: sessionId,
      agentId: agent.id,
      agentName: agent.name,
      process: null,
      status: 'pending',
      output: '',
      startTime: Date.now()
    };
    this.sessions.set(sessionId, session);

    try {
      // 检查是否有可复用的会话
      const existingClaudeSessionId = this.agentSessionMap.get(agent.id);

      // 构建完整的 prompt（根据是否复用会话决定是否包含完整上下文）
      const fullPrompt = this.buildPrompt(agent, prompt, context, existingClaudeSessionId);

      // 启动 Claude CLI 进程
      await this.spawnClaudeProcess(session, agent, fullPrompt, existingClaudeSessionId);

      return sessionId;
    } catch (error) {
      session.status = 'error';
      session.error = error instanceof Error ? error.message : String(error);
      session.endTime = Date.now();
      throw error;
    }
  }

  /**
   * 构建 Agent 专用的 prompt
   * 如果是复用会话（existingClaudeSessionId），只传递增量任务，避免重复上下文
   */
  private buildPrompt(agent: AgentTemplate, task: string, context?: string, existingClaudeSessionId?: string): string {
    const parts: string[] = [];

    // 如果是复用会话，只传递增量任务，不重复角色说明
    if (existingClaudeSessionId) {
      // 复用会话：只传递新任务
      parts.push(`## 新任务`);
      parts.push(task);
      parts.push('');
      if (context) {
        parts.push(`## 更新信息`);
        parts.push(context);
      }
      parts.push('');
      parts.push('请继续你的角色，针对以上新任务给出你的观点。');
    } else {
      // 新会话：构建完整上下文
      // 添加角色说明
      parts.push(`你是${agent.name}（${agent.role}）。`);
      parts.push('');

      // 添加系统提示
      if (agent.systemPrompt) {
        parts.push(agent.systemPrompt);
        parts.push('');
      }

      // 添加上下文（其他 Agent 的发言）
      if (context) {
        parts.push('## 讨论上下文');
        parts.push(context);
        parts.push('');
      }

      // 添加任务
      parts.push('## 你的任务');
      parts.push(task);
      parts.push('');
      parts.push('请从你的专业角度给出简洁、有价值的观点。直接回答问题，不要重复角色介绍。');
    }

    return parts.join('\n');
  }

  /**
   * 启动 Claude CLI 进程
   * @param existingSessionId 可选的已有会话 ID，用于 --resume
   */
  private async spawnClaudeProcess(
    session: SubagentSession,
    agent: AgentTemplate,
    prompt: string,
    existingSessionId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 删除嵌套会话检测的环境变量
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE;
      delete env.CLAUDE_CODE_SKIP_NESTED_CHECK;

      // 构建 agent 配置
      const agentConfig = {
        description: `${agent.name}: ${agent.role}. Use this agent for tasks related to ${agent.role}.`,
        prompt: agent.systemPrompt || `You are ${agent.name}, a ${agent.role}.`
      };

      // 构建 CLI 参数
      const args = [
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        '--include-partial-messages'
      ];

      // 如果有已有会话，使用 --resume 复用
      if (existingSessionId) {
        args.push('--resume', existingSessionId);
        console.log(`[SubagentManager] Resuming session ${existingSessionId} for ${agent.name}`);
      }

      // 添加 MCP 配置
      if (this.config.mcpConfigPath) {
        args.push('--mcp-config', this.config.mcpConfigPath);
      }

      // 添加 agent 定义
      args.push('--agents', JSON.stringify({ [agent.name]: agentConfig }));

      // 添加 prompt 分隔符
      args.push('--');

      console.log(`[SubagentManager] Starting ${agent.name} with PID placeholder`);
      console.log(`[SubagentManager] Agent config:`, JSON.stringify(agentConfig).substring(0, 100));

      // 启动进程
      const proc = spawn('claude', [...args], {
        cwd: this.config.cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      session.process = proc;
      session.status = 'running';

      // 通过 stdin 写入 prompt
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      console.log(`[SubagentManager] Process started for ${agent.name}, PID: ${proc.pid}`);

      let fullOutput = '';
      let stderr = '';
      let claudeSessionId: string | undefined;
      let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      // 设置超时
      const timeout = setTimeout(() => {
        console.log(`[SubagentManager] Timeout for ${agent.name}`);
        session.status = 'timeout';
        session.endTime = Date.now();
        proc.kill();
        reject(new Error(`Agent ${agent.name} timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      // 处理 stdout
      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        console.log(`[SubagentManager] ${agent.name} stdout:`, chunk.length, 'bytes');

        // 解析 stream-json
        const lines = chunk.split('\n').filter((line: string) => line.trim());
        for (const line of lines) {
          try {
            const json = JSON.parse(line);

            // 调试日志：查看所有 JSON 类型
            if (json.type === 'result') {
              console.log(`[SubagentManager] ${agent.name} result type:`, json.result?.substring?.(0, 100));
            }
            if (json.type === 'stream_event' && json.event?.delta?.type === 'thinking_delta') {
              console.log(`[SubagentManager] ${agent.name} thinking_delta (ignoring):`, json.event.delta.thinking?.substring(0, 100));
            }
            if (json.message?.thinking) {
              console.log(`[SubagentManager] ${agent.name} message.thinking (ignoring):`, json.message.thinking?.substring(0, 100));
            }

            // 提取会话 ID
            if (json.session_id && !claudeSessionId) {
              claudeSessionId = json.session_id;
              console.log(`[SubagentManager] Got session ID: ${claudeSessionId}`);
            }

            // 提取 Token 使用量
            if (json.usage) {
              tokenUsage.inputTokens += json.usage.input_tokens || 0;
              tokenUsage.outputTokens += json.usage.output_tokens || 0;
              tokenUsage.totalTokens += json.usage.total_tokens || 0;
            }
            if (json.message?.usage) {
              tokenUsage.inputTokens += json.message.usage.input_tokens || 0;
              tokenUsage.outputTokens += json.message.usage.output_tokens || 0;
              tokenUsage.totalTokens += json.message.usage.total_tokens || 0;
            }

            const text = this.extractTextFromJson(json, session);
            if (text) {
              fullOutput += text;
              // 回调通知新内容
              if (this.onMessageCallback) {
                this.onMessageCallback(session.agentId, session.agentName, text, false);
              }
            }
          } catch {
            // 非 JSON 行，可能是纯文本输出
            if (line.trim()) {
              fullOutput += line;
              if (this.onMessageCallback) {
                this.onMessageCallback(session.agentId, session.agentName, line, false);
              }
            }
          }
        }
      });

      // 处理 stderr
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log(`[SubagentManager] ${agent.name} stderr:`, data.toString().substring(0, 100));
      });

      // 进程结束
      proc.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[SubagentManager] ${agent.name} closed, code: ${code}`);

        session.output = fullOutput;
        session.endTime = Date.now();

        // 保存会话 ID 用于复用
        if (claudeSessionId) {
          session.claudeSessionId = claudeSessionId;
          this.agentSessionMap.set(session.agentId, claudeSessionId);
          console.log(`[SubagentManager] Saved session ID ${claudeSessionId} for agent ${session.agentId}`);
        }

        // 保存 Token 使用量
        if (tokenUsage.totalTokens > 0) {
          session.tokenUsage = { ...tokenUsage };
          // 累加到总统计
          this.totalTokenUsage.inputTokens += tokenUsage.inputTokens;
          this.totalTokenUsage.outputTokens += tokenUsage.outputTokens;
          this.totalTokenUsage.totalTokens += tokenUsage.totalTokens;
          console.log(`[SubagentManager] ${agent.name} tokens: in=${tokenUsage.inputTokens}, out=${tokenUsage.outputTokens}, total=${tokenUsage.totalTokens}`);
        }

        if (code === 0 || fullOutput) {
          session.status = 'completed';
          // 通知完成
          if (this.onMessageCallback) {
            this.onMessageCallback(session.agentId, session.agentName, '', true);
          }
          resolve();
        } else {
          session.status = 'error';
          session.error = stderr || `Process exited with code ${code}`;
          reject(new Error(session.error));
        }
      });

      // 进程错误
      proc.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[SubagentManager] ${agent.name} error:`, err.message);
        session.status = 'error';
        session.error = err.message;
        session.endTime = Date.now();
        reject(err);
      });

      // 立即 resolve（不等待进程结束）
      resolve();
    });
  }

  /**
   * 从 JSON 输出中提取文本
   * 避免重复提取：跟踪已发送的内容
   */
  private extractTextFromJson(json: any, session: SubagentSession): string {
    let text = '';

    // 处理流式事件
    if (json.type === 'stream_event' && json.event?.type === 'content_block_delta') {
      const delta = json.event.delta;
      // 只处理 text_delta，忽略 thinking_delta（thinking 由流式单独处理）
      if (delta?.type === 'text_delta' && delta.text) {
        // 检查是否已经发送过这个内容（避免重复）
        if (!session.sentContent || !session.sentContent.has(delta.text)) {
          text = delta.text;
          // 记录已发送的内容
          if (!session.sentContent) {
            session.sentContent = new Set();
          }
          session.sentContent.add(delta.text);
        }
      }
    }
    // 处理完整消息 - 只处理 text 内容，忽略 thinking block
    else if (json.type === 'assistant' && json.message?.content) {
      for (const block of json.message.content) {
        // 只提取 text block，跳过 thinking block
        if (block.type === 'text' && block.text) {
          // 检查是否已经发送过这个内容
          if (!session.sentContent || !session.sentContent.has(block.text)) {
            text = block.text;
            // 记录已发送的内容
            if (!session.sentContent) {
              session.sentContent = new Set();
            }
            session.sentContent.add(block.text);
          }
        }
      }
    }
    // 处理 result 类型 - 结果中可能包含完整文本，需去重
    else if (json.type === 'result' && json.result) {
      // result 包含完整输出，检查是否已经发送过
      if (!session.sentContent || !session.sentContent.has(json.result)) {
        text = json.result;
        if (!session.sentContent) {
          session.sentContent = new Set();
        }
        session.sentContent.add(json.result);
      }
    }
    return text;
  }

  /**
   * 并发启动多个 Agent 会话
   */
  async startAllSessions(
    agents: AgentTemplate[],
    prompt: string,
    context?: string
  ): Promise<string[]> {
    const sessionIds: string[] = [];
    const batches: AgentTemplate[][] = [];

    // 分批处理（限制并发数）
    for (let i = 0; i < agents.length; i += this.config.maxConcurrency!) {
      batches.push(agents.slice(i, i + this.config.maxConcurrency!));
    }

    for (const batch of batches) {
      const promises = batch.map(agent =>
        this.startAgentSession(agent, prompt, context)
          .catch(err => {
            console.error(`[SubagentManager] Failed to start ${agent.name}:`, err.message);
            return null;
          })
      );

      const results = await Promise.all(promises);
      sessionIds.push(...results.filter((id): id is string => id !== null));
    }

    return sessionIds;
  }

  /**
   * 等待所有会话完成
   */
  async waitForAll(timeout?: number): Promise<Map<string, SubagentSession>> {
    const startTime = Date.now();
    const maxWait = timeout || this.config.timeout! * 2;

    while (Date.now() - startTime < maxWait) {
      const allDone = Array.from(this.sessions.values()).every(
        s => s.status === 'completed' || s.status === 'error' || s.status === 'timeout'
      );

      if (allDone) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return this.sessions;
  }

  /**
   * 获取会话状态
   */
  getSession(sessionId: string): SubagentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): Map<string, SubagentSession> {
    return new Map(this.sessions);
  }

  /**
   * 获取已完成会话的输出
   */
  getOutput(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.output;
  }

  /**
   * 获取所有输出
   */
  getAllOutputs(): Map<string, string> {
    const outputs = new Map<string, string>();
    for (const [id, session] of this.sessions) {
      if (session.output) {
        outputs.set(id, session.output);
      }
    }
    return outputs;
  }

  /**
   * 停止单个会话
   */
  stopSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session?.process) {
      session.process.kill();
      session.status = 'error';
      session.error = 'Stopped by user';
      session.endTime = Date.now();
      return true;
    }
    return false;
  }

  /**
   * 停止所有会话
   */
  stopAll(): void {
    let stoppedCount = 0;
    for (const session of this.sessions.values()) {
      // 停止正在运行或待处理状态的进程
      if (session.process && (session.status === 'running' || session.status === 'pending')) {
        try {
          session.process.kill();
          session.status = 'error';
          session.error = 'Stopped by cleanup';
          session.endTime = Date.now();
          stoppedCount++;
        } catch (err) {
          console.error(`[SubagentSessionManager] Failed to kill process for ${session.agentName}:`, err);
        }
      }
    }
    if (stoppedCount > 0) {
      console.log(`[SubagentSessionManager] Stopped ${stoppedCount} running processes`);
    }
  }

  /**
   * 清理已完成的会话（但保留会话 ID 映射以供复用）
   */
  cleanup(): void {
    for (const [id, session] of this.sessions) {
      if (session.status !== 'running' && session.status !== 'pending') {
        // 保留会话 ID 映射用于复用
        if (session.claudeSessionId) {
          this.agentSessionMap.set(session.agentId, session.claudeSessionId);
        }
        this.sessions.delete(id);
      }
    }
  }

  /**
   * 清理所有资源（包括会话映射）
   * 会先停止所有正在运行的进程，然后清理数据
   */
  cleanupAll(): void {
    // 先停止所有正在运行的进程
    this.stopAll();

    // 收集需要删除的 Claude 会话 ID
    const claudeSessionIds: string[] = [];

    // 清理所有会话记录
    for (const session of this.sessions.values()) {
      if (session.process && session.status === 'running') {
        // stopAll() 应该已经处理了，但双重检查确保进程被终止
        try {
          session.process.kill();
        } catch {
          // 忽略终止失败
        }
      }
      // 收集 Claude 会话 ID
      if (session.claudeSessionId) {
        claudeSessionIds.push(session.claudeSessionId);
      }
    }

    // 删除磁盘上的专家会话文件
    this.deleteSessionFiles(claudeSessionIds);

    this.sessions.clear();
    this.agentSessionMap.clear();
    this.totalTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    console.log('[SubagentSessionManager] cleanupAll completed: sessions cleared, processes stopped');
  }

  /**
   * 删除磁盘上的会话文件
   */
  private deleteSessionFiles(sessionIds: string[]): void {
    if (sessionIds.length === 0) return;

    let deletedCount = 0;
    let notFoundCount = 0;

    // 遍历所有项目目录
    try {
      const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
      for (const projectDir of projectDirs) {
        const projectPath = path.join(CLAUDE_PROJECTS_DIR, projectDir);
        if (!fs.statSync(projectPath).isDirectory()) continue;

        for (const sessionId of sessionIds) {
          const sessionFile = path.join(projectPath, `${sessionId}.jsonl`);
          if (fs.existsSync(sessionFile)) {
            try {
              fs.unlinkSync(sessionFile);
              deletedCount++;
              console.log(`[SubagentSessionManager] Deleted session file: ${sessionId}.jsonl`);
            } catch (err) {
              console.error(`[SubagentSessionManager] Failed to delete ${sessionId}.jsonl:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error('[SubagentSessionManager] Error scanning project directories:', err);
    }

    console.log(`[SubagentSessionManager] Deleted ${deletedCount} session files, ${notFoundCount} not found`);
  }

  /**
   * 获取 Agent 的会话 ID（用于复用）
   */
  getAgentSessionId(agentId: string): string | undefined {
    return this.agentSessionMap.get(agentId);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    running: number;
    completed: number;
    error: number;
    timeout: number;
  } {
    let running = 0, completed = 0, error = 0, timeout = 0;

    for (const session of this.sessions.values()) {
      switch (session.status) {
        case 'running':
        case 'pending':
          running++;
          break;
        case 'completed':
          completed++;
          break;
        case 'error':
          error++;
          break;
        case 'timeout':
          timeout++;
          break;
      }
    }

    return {
      total: this.sessions.size,
      running,
      completed,
      error,
      timeout
    };
  }
}

/**
 * 创建会话管理器
 */
export function createSubagentSessionManager(
  config?: Partial<SubagentManagerConfig>
): SubagentSessionManager {
  return new SubagentSessionManager(config);
}
