/**
 * LLM 适配器接口
 *
 * 支持接入不同的 LLM 提供商：
 * - Claude CLI (复用 Code-Remote 现有的 engine)
 * - Anthropic API
 * - OpenAI API
 * - 其他兼容接口
 */

import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCodeEngine } from '../claude';
import { GlobalBlackboard } from './types';
import { DEFAULT_MULTI_AGENT_SESSIONS_DIR } from './runtimePaths';

/**
 * LLM 调用结果
 */
export interface LLMResult {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model?: string;
  /** 会话 ID（用于复用会话上下文） */
  sessionId?: string;
}

/**
 * LLM 适配器接口
 */
export interface LLMAdapter {
  /**
   * 调用 LLM
   * @param systemPrompt 系统提示词
   * @param userPrompt 用户提示词
   * @param options 可选配置
   */
  invoke(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMInvokeOptions
  ): Promise<LLMResult>;

  /**
   * 流式调用 LLM
   * @param systemPrompt 系统提示词
   * @param userPrompt 用户提示词
   * @param onChunk 流式回调
   * @param options 可选配置
   */
  invokeStream?(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string) => void,
    options?: LLMInvokeOptions
  ): Promise<LLMResult>;
}

/**
 * LLM 调用选项
 */
export interface LLMInvokeOptions {
  /** 模型名称 */
  model?: string;
  /** 最大输出 tokens */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 停止词 */
  stopSequences?: string[];
  /** 额外配置 */
  extra?: Record<string, unknown>;
  /** 会话 ID（用于复用会话上下文） */
  sessionId?: string;
  /** Agent 角色（用于会话管理） */
  agentRole?: string;
}

/**
 * Claude CLI 适配器
 * 复用 Code-Remote 现有的 ClaudeCodeEngine
 *
 * 支持会话复用：每个 Agent 角色维护独立的会话 ID
 * 支持会话持久化：会话元数据保存到文件，可跨进程复用
 */
export class ClaudeCLIAdapter implements LLMAdapter {
  private engine: ClaudeCodeEngine;
  private defaultMaxTokens: number;
  private totalUsage: { inputTokens: number; outputTokens: number; requests: number } = {
    inputTokens: 0,
    outputTokens: 0,
    requests: 0
  };

  /** 会话管理：每个 Agent 角色对应一个会话 ID */
  private sessions: Map<string, string> = new Map();

  /** 系统提示词缓存：每个角色第一次调用时设置 */
  private systemPrompts: Map<string, string> = new Map();

  /** 会话存储目录 */
  private sessionsDir: string;

  /** 会话元数据文件路径 */
  private sessionsFile: string;

  /** 辩论会话 ID（用于区分不同的辩论实例） */
  private debateSessionId: string;

  constructor(options?: { maxTokens?: number; sessionsDir?: string; debateSessionId?: string }) {
    this.engine = new ClaudeCodeEngine();
    this.defaultMaxTokens = options?.maxTokens || 4096;
    this.debateSessionId = options?.debateSessionId || this.generateDebateId();

    // 会话存储目录
    this.sessionsDir = options?.sessionsDir || DEFAULT_MULTI_AGENT_SESSIONS_DIR;
    this.sessionsFile = `${this.sessionsDir}/${this.debateSessionId}.json`;

    // 加载已有会话
    this.loadSessions();
  }

  /**
   * 生成辩论会话 ID
   */
  private generateDebateId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const random = Math.random().toString(36).substring(2, 6);
    return `debate_${timestamp}_${random}`;
  }

  /**
   * 加载已保存的会话
   */
  private loadSessions(): void {
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf-8'));
        if (data.sessions) {
          this.sessions = new Map(Object.entries(data.sessions));
        }
        if (data.systemPrompts) {
          this.systemPrompts = new Map(Object.entries(data.systemPrompts));
        }
        console.log(`[ClaudeCLI] Loaded ${this.sessions.size} sessions from ${this.sessionsFile}`);
      }
    } catch (error) {
      console.warn(`[ClaudeCLI] Failed to load sessions: ${error}`);
    }
  }

  /**
   * 保存会话到文件
   */
  private saveSessions(): void {
    try {
      // 确保目录存在
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      }

      const data = {
        debateSessionId: this.debateSessionId,
        createdAt: new Date().toISOString(),
        sessions: Object.fromEntries(this.sessions),
        systemPrompts: Object.fromEntries(this.systemPrompts),
        totalUsage: this.totalUsage
      };

      fs.writeFileSync(this.sessionsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[ClaudeCLI] Failed to save sessions: ${error}`);
    }
  }

  /**
   * 获取辩论会话 ID
   */
  getDebateSessionId(): string {
    return this.debateSessionId;
  }

  /**
   * 获取会话存储目录
   */
  getSessionsDir(): string {
    return this.sessionsDir;
  }

  /**
   * 获取会话文件路径
   */
  getSessionsFile(): string {
    return this.sessionsFile;
  }

  /**
   * 清除指定角色的会话
   */
  clearSession(role: string): void {
    this.sessions.delete(role);
    this.systemPrompts.delete(role);
    this.saveSessions();
  }

  /**
   * 清除所有会话
   */
  clearAllSessions(): void {
    this.sessions.clear();
    this.systemPrompts.clear();
    this.saveSessions();
  }

  /**
   * 获取指定角色的会话 ID
   */
  getSessionId(role: string): string | undefined {
    return this.sessions.get(role);
  }

  /**
   * 获取所有会话信息
   */
  getAllSessions(): { role: string; sessionId: string }[] {
    const result: { role: string; sessionId: string }[] = [];
    for (const [role, sessionId] of this.sessions) {
      result.push({ role, sessionId });
    }
    return result;
  }

  async invoke(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMInvokeOptions
  ): Promise<LLMResult> {
    const role = options?.agentRole || 'default';
    const existingSessionId = this.sessions.get(role);
    const existingSystemPrompt = this.systemPrompts.get(role);

    // 判断是否需要发送系统提示词
    const isNewSession = !existingSessionId;
    const systemPromptChanged = existingSystemPrompt && existingSystemPrompt !== systemPrompt;

    let prompt: string;
    let sessionId: string | undefined = existingSessionId;

    if (isNewSession || systemPromptChanged) {
      // 新会话或系统提示词变更，发送完整 prompt
      prompt = this.buildPrompt(systemPrompt, userPrompt);
      this.systemPrompts.set(role, systemPrompt);
      console.log(`[ClaudeCLI] New session for role: ${role}`);
    } else {
      // 复用会话，只发送增量信息
      prompt = userPrompt;
      console.log(`[ClaudeCLI] Reusing session ${existingSessionId?.substring(0, 8)}... for role: ${role}`);
    }

    // 估算输入 token
    const estimatedInputTokens = Math.ceil(prompt.length / 4);

    return new Promise((resolve, reject) => {
      this.engine.sendMessage(
        prompt,
        [], // 无历史消息（会话管理由 CLI 处理）
        (chunk: string, done: boolean) => {
          // 流式回调，这里暂不处理
        },
        (log) => {
          console.log(`[ClaudeCLI] ${log.level}: ${log.message}`);
        },
        sessionId, // 传入会话 ID 以复用会话
        undefined, // 使用默认工作目录
        undefined  // 无额外系统提示
      )
        .then((result) => {
          // 保存会话 ID
          if (result.claudeSessionId) {
            this.sessions.set(role, result.claudeSessionId);
            // 持久化会话到文件
            this.saveSessions();
          }

          // 估算输出 token
          const estimatedOutputTokens = Math.ceil(result.response.length / 4);

          // 累计统计
          this.totalUsage.inputTokens += estimatedInputTokens;
          this.totalUsage.outputTokens += estimatedOutputTokens;
          this.totalUsage.requests++;

          resolve({
            content: result.response,
            usage: {
              inputTokens: estimatedInputTokens,
              outputTokens: estimatedOutputTokens
            },
            model: 'claude-cli',
            sessionId: result.claudeSessionId
          });
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  async invokeStream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string) => void,
    options?: LLMInvokeOptions
  ): Promise<LLMResult> {
    const role = options?.agentRole || 'default';
    const existingSessionId = this.sessions.get(role);
    const existingSystemPrompt = this.systemPrompts.get(role);

    const isNewSession = !existingSessionId;
    const systemPromptChanged = existingSystemPrompt && existingSystemPrompt !== systemPrompt;

    let prompt: string;
    let sessionId: string | undefined = existingSessionId;

    if (isNewSession || systemPromptChanged) {
      prompt = this.buildPrompt(systemPrompt, userPrompt);
      this.systemPrompts.set(role, systemPrompt);
    } else {
      prompt = userPrompt;
    }

    const estimatedInputTokens = Math.ceil(prompt.length / 4);

    return new Promise((resolve, reject) => {
      this.engine.sendMessage(
        prompt,
        [],
        (chunk: string, done: boolean) => {
          onChunk(chunk);
        },
        (log) => {
          console.log(`[ClaudeCLI] ${log.level}: ${log.message}`);
        },
        sessionId,
        undefined,
        undefined
      )
        .then((result) => {
          if (result.claudeSessionId) {
            this.sessions.set(role, result.claudeSessionId);
            this.saveSessions();
          }

          const estimatedOutputTokens = Math.ceil(result.response.length / 4);

          this.totalUsage.inputTokens += estimatedInputTokens;
          this.totalUsage.outputTokens += estimatedOutputTokens;
          this.totalUsage.requests++;

          resolve({
            content: result.response,
            usage: {
              inputTokens: estimatedInputTokens,
              outputTokens: estimatedOutputTokens
            },
            model: 'claude-cli',
            sessionId: result.claudeSessionId
          });
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  /**
   * 获取累计 token 使用量（估算）
   */
  getTotalUsage(): { inputTokens: number; outputTokens: number; requests: number; totalTokens: number } {
    return {
      ...this.totalUsage,
      totalTokens: this.totalUsage.inputTokens + this.totalUsage.outputTokens
    };
  }

  /**
   * 重置统计
   */
  resetUsage(): void {
    this.totalUsage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  }

  /**
   * 构建完整提示
   */
  private buildPrompt(systemPrompt: string, userPrompt: string): string {
    return `<system-prompt>
${systemPrompt}
</system-prompt>

${userPrompt}`;
  }
}

/**
 * 简单的 Mock 适配器（用于测试）
 */
export class MockLLMAdapter implements LLMAdapter {
  private responses: Map<string, string> = new Map();
  private defaultResponse: string;

  constructor(defaultResponse?: string) {
    this.defaultResponse = defaultResponse || '这是一个模拟回复。';
  }

  /**
   * 设置特定角色的回复
   */
  setResponse(role: string, response: string): void {
    this.responses.set(role.toLowerCase(), response);
  }

  async invoke(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMInvokeOptions
  ): Promise<LLMResult> {
    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 100));

    const combinedPrompt = (systemPrompt + ' ' + userPrompt).toLowerCase();

    // 按优先级匹配角色（更精确的匹配优先）
    const rolePriority = ['moderator', 'skeptic', 'proposer', 'fact-checker', 'expert'];

    for (const role of rolePriority) {
      if (combinedPrompt.includes(role) || combinedPrompt.includes(role.replace('-', ' '))) {
        const response = this.responses.get(role);
        if (response) {
          return { content: response, model: 'mock' };
        }
      }
    }

    // 检查自定义专家名称
    for (const [role, response] of this.responses) {
      if (!rolePriority.includes(role) && combinedPrompt.includes(role)) {
        return { content: response, model: 'mock' };
      }
    }

    return { content: this.defaultResponse, model: 'mock' };
  }
}

/**
 * OpenAI API 响应类型
 */
interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model: string;
}

/**
 * Anthropic API 响应类型
 */
interface AnthropicResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  model: string;
}

/**
 * OpenAI 兼容适配器（支持 GLM、DeepSeek、Moonshot 等兼容 OpenAI API 的模型）
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private totalUsage: { inputTokens: number; outputTokens: number; requests: number } = {
    inputTokens: 0,
    outputTokens: 0,
    requests: 0
  };

  constructor(options: { apiKey: string; model: string; baseUrl: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
  }

  async invoke(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMInvokeOptions
  ): Promise<LLMResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options?.model || this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        stop: options?.stopSequences
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as OpenAIResponse;

    // 累计 token 统计
    if (data.usage) {
      this.totalUsage.inputTokens += data.usage.prompt_tokens;
      this.totalUsage.outputTokens += data.usage.completion_tokens;
      this.totalUsage.requests++;
    }

    return {
      content: data.choices[0].message.content,
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens
      } : undefined,
      model: data.model
    };
  }

  /**
   * 获取累计 token 使用量
   */
  getTotalUsage(): { inputTokens: number; outputTokens: number; requests: number; totalTokens: number } {
    return {
      ...this.totalUsage,
      totalTokens: this.totalUsage.inputTokens + this.totalUsage.outputTokens
    };
  }

  /**
   * 重置统计
   */
  resetUsage(): void {
    this.totalUsage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  }
}

/**
 * OpenAI 适配器（继承 OpenAICompatibleAdapter）
 */
export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor(options: { apiKey: string; model?: string; baseUrl?: string }) {
    super({
      apiKey: options.apiKey,
      model: options.model || 'gpt-4',
      baseUrl: options.baseUrl || 'https://api.openai.com/v1'
    });
  }
}

/**
 * Anthropic API 适配器
 */
export class AnthropicAdapter implements LLMAdapter {
  private apiKey: string;
  private model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'claude-sonnet-4-6-20250514';
  }

  async invoke(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMInvokeOptions
  ): Promise<LLMResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: options?.model || this.model,
        max_tokens: options?.maxTokens || 4096,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as AnthropicResponse;

    return {
      content: data.content[0].text,
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens
      } : undefined,
      model: data.model
    };
  }
}

/**
 * 创建 LLM 适配器
 */
export function createLLMAdapter(
  type: 'claude-cli' | 'mock' | 'openai' | 'anthropic' | 'openai-compatible',
  options?: Record<string, unknown>
): LLMAdapter {
  switch (type) {
    case 'claude-cli':
      return new ClaudeCLIAdapter(options as { maxTokens?: number });

    case 'mock':
      return new MockLLMAdapter(options?.defaultResponse as string);

    case 'openai':
      if (!options?.apiKey) {
        throw new Error('OpenAI adapter requires apiKey');
      }
      return new OpenAIAdapter(options as { apiKey: string; model?: string; baseUrl?: string });

    case 'anthropic':
      if (!options?.apiKey) {
        throw new Error('Anthropic adapter requires apiKey');
      }
      return new AnthropicAdapter(options as { apiKey: string; model?: string });

    case 'openai-compatible':
      if (!options?.apiKey || !options?.baseUrl || !options?.model) {
        throw new Error('OpenAI-compatible adapter requires apiKey, baseUrl, and model');
      }
      return new OpenAICompatibleAdapter(options as { apiKey: string; model: string; baseUrl: string });

    default:
      throw new Error(`Unknown LLM adapter type: ${type}`);
  }
}
