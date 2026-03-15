/**
 * 讨论系统处理器
 *
 * 处理 WebSocket 消息中的 @语法 讨论请求
 * 支持主持人模式：讨论结束后将结果注入主会话
 */

import { WebSocket } from 'ws';
import {
  DiscussionOrchestrator,
  DiscussionSession,
  DiscussionResult,
  DiscussionEvent,
  AgentTemplate,
  BUILTIN_TEMPLATES,
  createDiscussionOrchestrator,
  SubagentSessionManager,
  createSubagentSessionManager
} from '../multi-agent/discussion';
import { SessionManager, createMessage } from '../claude';
import chalk from 'chalk';

/**
 * 讨论系统 WebSocket 消息类型
 */
export interface DiscussionMessage {
  type: 'discussion_start' | 'discussion_event' | 'discussion_result' | 'discussion_error' | 'discussion_summary' |
        'mode_detected' | 'consensus_update' | 'blackboard_update' | 'fluff_detected';
  sessionId?: string;
  data?: any;
  timestamp: number;
}

/**
 * 讨论请求消息
 */
export interface DiscussionRequest {
  type: 'discussion';
  input: string;
  config?: {
    maxRounds?: number;
    messageTimeout?: number;
    mode?: 'debate' | 'collaborate' | 'auto';
    terminationMode?: 'consensus' | 'rounds' | 'both';
    consensusThreshold?: number;
    enableFluffDetection?: boolean;
    maxContentLength?: number;
    compressionInterval?: number;
    enableEventBus?: boolean;
    enableFactChecker?: boolean;
  };
  llmEnabled?: boolean;
  /** 主持人模式：讨论结束后是否注入主会话 */
  hostMode?: boolean;
}

/**
 * 讨论结果回调类型
 */
export type DiscussionResultCallback = (
  result: DiscussionResult,
  sessionId: string
) => void;

/**
 * 讨论处理器
 */
export class DiscussionHandler {
  private orchestrator: DiscussionOrchestrator;
  private llmInvoker?: (prompt: string, systemPrompt: string) => Promise<string>;
  private activeSessions: Map<string, WebSocket> = new Map();
  private resultCallbacks: Map<string, DiscussionResultCallback[]> = new Map();
  private hostModeEnabled: boolean = true; // 默认开启主持人模式
  private sessionManager?: SessionManager;
  /** 讨论会话到主会话 ID 的映射 */
  private discussionToMainSession: Map<string, string> = new Map();

  constructor() {
    this.orchestrator = createDiscussionOrchestrator({
      maxRounds: 3,
      messageTimeout: 120000,
      autoSummary: true
    });

    // 订阅事件
    this.orchestrator.subscribe(this.handleEvent.bind(this));

    // 默认使用真实 LLM
    console.log(chalk.green('[Discussion] Using real LLM via SubagentSessionManager'));
    console.log(chalk.green('[Discussion] Host mode enabled - results will be injected to main session'));
  }

  /**
   * 设置 SessionManager（用于持久化讨论消息）
   */
  setSessionManager(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager;
    console.log(chalk.blue('[Discussion] SessionManager set for message persistence'));
  }

  /**
   * 设置主持人模式
   */
  setHostMode(enabled: boolean): void {
    this.hostModeEnabled = enabled;
    console.log(chalk.blue('[Discussion] Host mode:'), enabled ? 'enabled' : 'disabled');
  }

  /**
   * 注册讨论结果回调
   */
  onResult(sessionId: string, callback: DiscussionResultCallback): void {
    if (!this.resultCallbacks.has(sessionId)) {
      this.resultCallbacks.set(sessionId, []);
    }
    this.resultCallbacks.get(sessionId)!.push(callback);
  }

  /**
   * 设置 LLM 调用器（外部提供）
   */
  setLLMInvoker(invoker: (prompt: string, systemPrompt: string) => Promise<string>): void {
    this.llmInvoker = invoker;
    this.orchestrator.setLLMInvoker(invoker);
    // 使用外部 LLM 调用器时，禁用内置的真实 LLM
    this.orchestrator.setUseRealLLM(false);
  }

  /**
   * 获取可用模板
   */
  getAvailableTemplates(): AgentTemplate[] {
    return this.orchestrator.getAvailableTemplates();
  }

  /**
   * 处理讨论请求
   */
  async handleRequest(
    ws: WebSocket,
    request: DiscussionRequest
  ): Promise<DiscussionResult | null> {
    try {
      // 解析输入
      const { mentions, templates, task } = this.orchestrator.parseInput(request.input);

      if (templates.length === 0) {
        this.sendError(ws, '未找到有效的 @提及，请使用 @代码审查、@架构师 等');
        return null;
      }

      console.log(chalk.magenta('💬'), `Discussion request received:`);
      console.log(chalk.gray('   Input:'), request.input.substring(0, 100));
      console.log(chalk.gray('   Task:'), task.substring(0, 100));
      console.log(chalk.gray('   Agents:'), templates.map(t => t.name).join(', '));
      console.log(chalk.gray('   Host Mode:'), request.hostMode !== false ? 'enabled' : 'disabled');
      console.log(chalk.gray('   Config:'), JSON.stringify(request.config || {}));

      // 创建会话（使用新配置）
      const session = this.orchestrator.createSession(request.input, {
        maxRounds: request.config?.maxRounds || 3,
        messageTimeout: request.config?.messageTimeout || 120000,
        mode: request.config?.mode || 'auto',
        terminationMode: request.config?.terminationMode || 'both',
        consensusThreshold: request.config?.consensusThreshold || 85,
        enableFluffDetection: request.config?.enableFluffDetection !== false,
        maxContentLength: request.config?.maxContentLength || 500,
        compressionInterval: request.config?.compressionInterval || 2,
        enableEventBus: request.config?.enableEventBus !== false,
        enableFactChecker: request.config?.enableFactChecker !== false,
        autoSummary: true
      });

      this.activeSessions.set(session.id, ws);

      // 持久化讨论开始消息到当前会话
      if (this.sessionManager) {
        const agentNames = templates.map(t =>
          `${this.getAgentIcon(t.name)} ${t.name}`
        ).join('、');
        const modeIcon = session.mode === 'debate' ? '⚔️' : session.mode === 'collaborate' ? '🤝' : '🔄';
        const modeName = session.mode === 'debate' ? '对抗模式' : session.mode === 'collaborate' ? '协作模式' : '自动判断';

        const startMessage = createMessage('assistant',
          `🚀 **开始多智能体讨论**\n\n` +
          `**参与者**: ${agentNames}\n` +
          `**任务**: ${task}\n` +
          `**模式**: ${modeIcon} ${modeName}\n` +
          `---`
        );
        this.sessionManager.addMessage(startMessage);
        console.log(chalk.gray('[Discussion] Saved discussion start message to session'));
      }

      // 发送会话创建消息（包含模式信息）
      this.sendMessage(ws, {
        type: 'discussion_start',
        sessionId: session.id,
        data: {
          agents: templates.map(t => ({
            id: t.id,
            name: t.name,
            role: t.role,
            avatar: t.avatar
          })),
          task,
          maxRounds: session.config.maxRounds,
          hostMode: request.hostMode !== false,
          mode: session.mode,
          modeReason: session.modeReason
        },
        timestamp: Date.now()
      });

      // 发送模式检测事件
      if (session.modeReason) {
        this.sendMessage(ws, {
          type: 'mode_detected',
          sessionId: session.id,
          data: {
            mode: session.mode,
            reason: session.modeReason
          },
          timestamp: Date.now()
        } as any);
      }

      // 运行讨论
      console.log(chalk.blue('[Discussion] Starting orchestrator.run...'));
      const result = await this.orchestrator.run(session.id);
      console.log(chalk.green('[Discussion] Orchestrator.run completed'));
      console.log(chalk.gray('[Discussion] Result:'), {
        sessionId: result.sessionId,
        totalRounds: result.totalRounds,
        totalMessages: result.totalMessages,
        perspectivesCount: result.perspectives?.length,
        conclusionLength: result.conclusion?.length
      });

      // 生成主持人总结（用于注入主会话）
      const hostSummary = this.generateHostSummary(result, templates);
      console.log(chalk.gray('[Discussion] Host summary generated, length:', hostSummary.length));

      // 发送结果
      console.log(chalk.blue('[Discussion] Sending discussion_result...'));
      this.sendMessage(ws, {
        type: 'discussion_result',
        sessionId: session.id,
        data: {
          ...result,
          hostSummary // 添加主持人总结
        },
        timestamp: Date.now()
      });
      console.log(chalk.green('[Discussion] discussion_result sent'));

      // 持久化讨论结论到会话存储
      if (this.sessionManager) {
        const conclusionMessage = this.formatConclusionForStorage(result);
        const message = createMessage('assistant', conclusionMessage);
        this.sessionManager.addMessage(message);
        console.log(chalk.gray('[Discussion] Saved discussion conclusion to session'));
      }

      // 如果开启主持人模式，发送特殊消息供主会话使用
      if (request.hostMode !== false && this.hostModeEnabled) {
        this.sendMessage(ws, {
          type: 'discussion_summary',
          sessionId: session.id,
          data: {
            summary: hostSummary,
            perspectives: result.perspectives,
            recommendations: result.recommendations,
            rawResult: result
          },
          timestamp: Date.now()
        });
      }

      // 触发结果回调
      const callbacks = this.resultCallbacks.get(session.id) || [];
      for (const callback of callbacks) {
        try {
          callback(result, session.id);
        } catch (err) {
          console.error(chalk.red('[Discussion] Callback error:'), err);
        }
      }

      // 清理
      this.activeSessions.delete(session.id);
      this.resultCallbacks.delete(session.id);

      return result;

    } catch (error) {
      console.error(chalk.red('Discussion error:'), error);
      this.sendError(ws, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * 生成主持人总结
   * 格式化为可读的文本，供主会话注入
   */
  private generateHostSummary(
    result: DiscussionResult,
    templates: AgentTemplate[]
  ): string {
    const lines: string[] = [];

    lines.push('## 🎯 多智能体讨论结果');
    lines.push('');
    lines.push(`**主题**: ${result.perspectives[0]?.summary?.split('。')[0] || '讨论完成'}`);
    lines.push(`**参与者**: ${templates.map(t => t.name).join('、')}`);
    lines.push(`**轮次**: ${result.totalRounds} 轮`);
    lines.push('');

    // 各方观点
    lines.push('### 📋 各方观点');
    lines.push('');
    for (const perspective of result.perspectives) {
      lines.push(`**${perspective.agentName}** (${perspective.role}):`);
      lines.push(perspective.summary);
      lines.push('');
    }

    // 结论
    if (result.conclusion) {
      lines.push('### 🏁 讨论结论');
      lines.push('');
      lines.push(result.conclusion);
      lines.push('');
    }

    // 建议
    if (result.recommendations && result.recommendations.length > 0) {
      lines.push('### 💡 建议');
      lines.push('');
      for (const rec of result.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }

    // 主持人引导语
    lines.push('---');
    lines.push('');
    lines.push('以上是各位专家的分析。你有什么想进一步探讨的吗？我可以帮你：');
    lines.push('- 🔍 深入追问某个观点');
    lines.push('- 📝 综合各方意见');
    lines.push('- 🎯 给出执行建议');

    return lines.join('\n');
  }

  /**
   * 处理讨论事件
   */
  private handleEvent(event: DiscussionEvent): void {
    const ws = this.activeSessions.get(event.sessionId);
    if (!ws) return;

    // 持久化 Agent 消息到会话存储
    if (event.type === 'message' && this.sessionManager) {
      const msgData = event.data as any;
      if (msgData && msgData.type === 'agent' && msgData.sender && msgData.content) {
        // 格式化 Agent 消息
        const formattedContent = this.formatAgentMessageForStorage(
          msgData.sender,
          msgData.role,
          msgData.content,
          msgData.round
        );

        // 保存到当前会话
        const message = createMessage('assistant', formattedContent);
        this.sessionManager.addMessage(message);
        console.log(chalk.gray(`[Discussion] Saved message from ${msgData.sender} to session`));
      }
    }

    // 转发所有事件类型
    this.sendMessage(ws, {
      type: 'discussion_event',
      sessionId: event.sessionId,
      data: {
        eventType: event.type,
        data: event.data instanceof Error
          ? { error: event.data.message }
          : event.data
      },
      timestamp: event.timestamp
    });

    // 对于特殊事件类型，也发送专用消息
    if (event.type === 'mode_detected' || event.type === 'consensus_update' ||
        event.type === 'blackboard_update' || event.type === 'fluff_detected') {
      this.sendMessage(ws, {
        type: event.type as any,
        sessionId: event.sessionId,
        data: event.data instanceof Error ? { error: event.data.message } : event.data,
        timestamp: event.timestamp
      } as any);
    }
  }

  /**
   * 格式化 Agent 消息用于存储
   */
  private formatAgentMessageForStorage(
    sender: string,
    role: string,
    content: string,
    round?: number
  ): string {
    const icon = this.getAgentIcon(sender);
    const roundInfo = round ? ` *R${round}*` : '';

    return `${icon} **${sender}** (${role})${roundInfo}\n\n${content}`;
  }

  /**
   * 格式化讨论结论用于存储
   */
  private formatConclusionForStorage(result: DiscussionResult): string {
    const lines: string[] = [];

    lines.push(`## ✨ 讨论结论`);
    lines.push('');
    lines.push(result.conclusion);
    lines.push('');

    // 添加 Token 统计
    if (result.tokenUsage) {
      lines.push(`---`);
      lines.push('');
      lines.push(`📊 **Token 统计**: 输入 ${result.tokenUsage.inputTokens.toLocaleString()} / 输出 ${result.tokenUsage.outputTokens.toLocaleString()} / 总计 **${result.tokenUsage.totalTokens.toLocaleString()}**`);
    }

    if (result.duration) {
      lines.push(`⏱️ **执行时间**: ${(result.duration / 1000).toFixed(1)}秒`);
    }

    return lines.join('\n');
  }

  /**
   * 获取 Agent 图标
   */
  private getAgentIcon(name: string): string {
    const AGENT_ICONS: Record<string, string> = {
      '代码审查': '🔍',
      '架构师': '🏗️',
      '测试专家': '🧪',
      '安全专家': '🔒',
      '性能专家': '⚡',
      '产品经理': '📊',
      '运维专家': '🚀',
      'Proposer': '✅',
      'Skeptic': '❓',
      'Moderator': '⚖️',
      'FactChecker': '🔍',
      'default': '🤖'
    };
    return AGENT_ICONS[name] || AGENT_ICONS.default;
  }

  /**
   * 发送消息
   */
  private sendMessage(ws: WebSocket, message: DiscussionMessage): void {
    try {
      // 检查 WebSocket 状态
      if (ws.readyState !== 1) {
        console.log(chalk.yellow('[Discussion]'), `WebSocket not ready (state: ${ws.readyState}), skipping message: ${message.type}`);
        return;
      }
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(chalk.red('Failed to send discussion message:'), error);
    }
  }

  /**
   * 发送错误
   */
  private sendError(ws: WebSocket, error: string): void {
    this.sendMessage(ws, {
      type: 'discussion_error',
      data: { error },
      timestamp: Date.now()
    });
  }

  /**
   * 获取活跃会话
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * 检查是否有运行中的讨论
   */
  isRunning(): boolean {
    return this.activeSessions.size > 0;
  }

  /**
   * 获取当前运行中的讨论会话 ID
   */
  getRunningDiscussionId(): string | null {
    const sessionIds = Array.from(this.activeSessions.keys());
    return sessionIds.length > 0 ? sessionIds[0] : null;
  }

  /**
   * 更新运行中讨论的 WebSocket（用于重连）
   */
  updateRunningWebSocket(ws: WebSocket): boolean {
    const sessionIds = Array.from(this.activeSessions.keys());
    if (sessionIds.length > 0) {
      // 更新所有活跃讨论的 WebSocket
      for (const sessionId of sessionIds) {
        this.activeSessions.set(sessionId, ws);
        console.log(chalk.blue('[Discussion]'), `Updated WebSocket for discussion: ${sessionId}`);
      }
      return true;
    }
    return false;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): DiscussionSession | undefined {
    return this.orchestrator.getSession(sessionId);
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): boolean {
    this.activeSessions.delete(sessionId);
    return this.orchestrator.deleteSession(sessionId);
  }
}

/**
 * 全局讨论处理器实例
 */
export const globalDiscussionHandler = new DiscussionHandler();
