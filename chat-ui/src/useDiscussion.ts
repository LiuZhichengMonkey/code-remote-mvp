/**
 * useDiscussion Hook
 *
 * 管理多智能体讨论的 React Hook
 * 将讨论内容显示在主聊天会话中
 * 支持对抗/协作模式、共识评分、防爆机制
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, DiscussionSession, DiscussionMessage, DiscussionAgent, DiscussionResult, DiscussionMode, DiscussionConfig } from './types';
import {
  DiscussionSession as BackendSession,
  DiscussionMessage as BackendMessage,
  DiscussionAgent as BackendAgent,
  DiscussionResult as BackendResult
} from './types';

// 内置 Agent 模板
const BUILTIN_AGENTS: DiscussionAgent[] = [
  { id: 'code-reviewer', name: '代码审查', role: 'Code Reviewer', avatar: { icon: '🔍', color: '#4CAF50' } },
  { id: 'architect', name: '架构师', role: 'Architect', avatar: { icon: '🏗️', color: '#2196F3' } },
  { id: 'tester', name: '测试专家', role: 'QA Engineer', avatar: { icon: '🧪', color: '#FF9800' } },
  { id: 'security', name: '安全专家', role: 'Security Expert', avatar: { icon: '🔒', color: '#F44336' } },
  { id: 'performance', name: '性能专家', role: 'Performance Expert', avatar: { icon: '⚡', color: '#9C27B0' } },
  { id: 'product', name: '产品经理', role: 'Product Manager', avatar: { icon: '📊', color: '#00BCD4' } },
  { id: 'devops', name: '运维专家', role: 'DevOps Engineer', avatar: { icon: '🚀', color: '#607D8B' } },
];

// Agent 头像颜色映射
const AGENT_COLORS: Record<string, string> = {
  '代码审查': '#4CAF50',
  '架构师': '#2196F3',
  '测试专家': '#FF9800',
  '安全专家': '#F44336',
  '性能专家': '#9C27B0',
  '产品经理': '#00BCD4',
  '运维专家': '#607D8B',
  'Proposer': '#4CAF50',
  'Skeptic': '#F44336',
  'Moderator': '#2196F3',
  'FactChecker': '#FF9800',
  'default': '#6366f1'
};

// Agent 图标映射
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

/**
 * 格式化讨论记录为 Markdown
 */
function formatDiscussionRecord(result: DiscussionResult, session: DiscussionSession | null): string {
  const lines: string[] = [];

  lines.push(`# 🎯 多智能体讨论记录`);
  lines.push('');

  // 讨论元信息
  const modeIcon = session?.mode === 'debate' ? '⚔️' : session?.mode === 'collaborate' ? '🤝' : '🔄';
  const modeName = session?.mode === 'debate' ? '对抗模式' : session?.mode === 'collaborate' ? '协作模式' : '自动判断';
  lines.push(`**模式**: ${modeIcon} ${modeName}`);
  lines.push(`**轮次**: ${result.totalRounds}`);
  lines.push(`**共识分数**: ${session?.consensusScore || 0}/100`);
  lines.push(`**参与者**: ${result.perspectives.map(p => p.agentName).join('、')}`);
  // 添加执行时间和 Token 统计
  lines.push(`**执行时间**: ${(result.duration / 1000).toFixed(1)}秒`);
  if (result.tokenUsage) {
    lines.push(`**Token 消耗**: 输入 ${result.tokenUsage.inputTokens.toLocaleString()} / 输出 ${result.tokenUsage.outputTokens.toLocaleString()} / 总计 ${result.tokenUsage.totalTokens.toLocaleString()}`);
  }
  lines.push('');

  // 各方观点
  if (result.perspectives && result.perspectives.length > 0) {
    lines.push(`## 📋 各方观点`);
    lines.push('');
    for (const p of result.perspectives) {
      const icon = AGENT_ICONS[p.agentName] || '🤖';
      lines.push(`### ${icon} ${p.agentName}`);
      lines.push(`*角色: ${p.role}*`);
      lines.push('');
      lines.push(p.summary);
      lines.push('');
    }
  }

  // 共识点
  if (result.agreements && result.agreements.length > 0) {
    lines.push(`## ✅ 共识点`);
    lines.push('');
    for (const a of result.agreements) {
      lines.push(`- ${a}`);
    }
    lines.push('');
  }

  // 分歧点
  if (result.disagreements && result.disagreements.length > 0) {
    lines.push(`## ❌ 分歧点`);
    lines.push('');
    for (const d of result.disagreements) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  // 建议
  if (result.recommendations && result.recommendations.length > 0) {
    lines.push(`## 💡 建议`);
    lines.push('');
    for (const r of result.recommendations) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }

  // 结论
  lines.push(`## 🏁 最终结论`);
  lines.push('');
  lines.push(result.conclusion);

  return lines.join('\n');
}

interface UseDiscussionOptions {
  ws: WebSocket | null;
  onAddMessage: (message: Message) => void;
  onSessionStart?: (session: DiscussionSession) => void;
  onComplete?: (result: DiscussionResult) => void;
  onError?: (error: string) => void;
  /** 讨论结束后，将结果发送到主会话的回调 */
  onSendToMainSession?: (summary: string, rawResult: DiscussionResult) => void;
  /** 创建主持人会话的回调（用于保存完整讨论记录） */
  onCreateHostSession?: (title: string, fullRecord: string) => void;
  /** 模式检测回调 */
  onModeDetected?: (mode: DiscussionMode, reason: string) => void;
  /** 共识分数更新回调 */
  onConsensusUpdate?: (score: number, previousScore: number) => void;
  /** 黑板更新回调 */
  onBlackboardUpdate?: (facts: string[], clashes: string[], insights: Record<string, string>) => void;
}

interface DiscussionWSMessage {
  type: 'discussion_start' | 'discussion_event' | 'discussion_result' | 'discussion_error' | 'discussion_summary' |
        'mode_detected' | 'consensus_update' | 'blackboard_update' | 'fluff_detected';
  sessionId?: string;
  data?: any;
  timestamp: number;
}

export function useDiscussion(options: UseDiscussionOptions) {
  const { ws, onAddMessage, onSessionStart, onComplete, onError, onSendToMainSession, onCreateHostSession, onModeDetected, onConsensusUpdate, onBlackboardUpdate } = options;

  const [session, setSession] = useState<DiscussionSession | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consensusScore, setConsensusScore] = useState(0);
  const [discussionMode, setDiscussionMode] = useState<DiscussionMode>('auto');
  const handlersRef = useRef(options);
  const sessionIdRef = useRef<string | null>(null); // 用于消息处理中获取最新的 session ID

  // 更新 handlers
  useEffect(() => {
    handlersRef.current = options;
  }, [options]);

  // 将讨论消息转换为聊天消息
  const addDiscussionMessage = useCallback((msg: {
    sender: string;
    role: string;
    content: string;
    type: 'user' | 'agent' | 'system' | 'summary';
    round?: number;
  }) => {
    const icon = AGENT_ICONS[msg.sender] || AGENT_ICONS.default;
    const color = AGENT_COLORS[msg.sender] || AGENT_COLORS.default;

    // 构建带格式的消息内容
    let formattedContent = '';

    if (msg.type === 'summary') {
      formattedContent = `## ✨ 讨论结论\n\n${msg.content}`;
    } else if (msg.type === 'system') {
      formattedContent = msg.content;
    } else if (msg.type === 'agent') {
      formattedContent = `${icon} **${msg.sender}** (${msg.role})${msg.round ? ` *R${msg.round}*` : ''}\n\n${msg.content}`;
    } else {
      formattedContent = msg.content;
    }

    const message: Message = {
      id: `disc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role: 'model',
      content: formattedContent,
      timestamp: Date.now(),
      status: 'sent'
    };

    console.log('[Discussion] Adding message to chat:', msg.type, msg.sender, 'sessionId:', sessionIdRef.current);
    onAddMessage(message);
  }, [onAddMessage]);

  // 处理 WebSocket 消息
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg: DiscussionWSMessage = JSON.parse(event.data);

        if (!msg.type.startsWith('discussion_') && !['mode_detected', 'consensus_update', 'blackboard_update', 'fluff_detected'].includes(msg.type)) return;

        switch (msg.type) {
          case 'discussion_start':
            setIsRunning(true);
            setError(null);
            const newSession: DiscussionSession = {
              id: msg.sessionId!,
              agents: msg.data.agents || [],
              messages: [{
                id: `user_${Date.now()}`,
                sender: 'User',
                role: 'user',
                content: msg.data.task,
                timestamp: Date.now(),
                type: 'user'
              }],
              status: 'running',
              currentRound: 0,
              maxRounds: msg.data.maxRounds || 3,
              mode: msg.data.mode || 'auto',
              modeReason: msg.data.modeReason,
              consensusScore: 0,
              verifiedFacts: [],
              coreClashes: [],
              agentInsights: {}
            };
            setSession(newSession);
            sessionIdRef.current = msg.sessionId!; // 更新 ref
            setConsensusScore(0);
            setDiscussionMode(msg.data.mode || 'auto');

            // 显示讨论开始消息
            const agentNames = msg.data.agents?.map((a: DiscussionAgent) =>
              `${AGENT_ICONS[a.name] || '🤖'} ${a.name}`
            ).join('、') || '';

            addDiscussionMessage({
              sender: '系统',
              role: 'system',
              content: `🚀 **开始多智能体讨论**\n\n参与者: ${agentNames}\n任务: ${msg.data.task}\n模式: ${msg.data.mode === 'debate' ? '对抗模式 ⚔️' : msg.data.mode === 'collaborate' ? '协作模式 🤝' : '自动判断 🔄'}\n---`,
              type: 'system'
            });

            handlersRef.current.onSessionStart?.(newSession);
            break;

          case 'mode_detected':
            // 模式检测结果
            const modeData = msg.data as { mode: DiscussionMode; reason: string };
            setDiscussionMode(modeData.mode);
            console.log(`[Discussion] Mode detected: ${modeData.mode} - ${modeData.reason}`);

            addDiscussionMessage({
              sender: '系统',
              role: 'system',
              content: `📊 **模式判断**: ${modeData.mode === 'debate' ? '对抗模式 ⚔️' : '协作模式 🤝'}\n*${modeData.reason}*`,
              type: 'system'
            });

            handlersRef.current.onModeDetected?.(modeData.mode, modeData.reason);
            break;

          case 'consensus_update':
            // 共识分数更新
            const scoreData = msg.data as { score: number; previousScore: number };
            setConsensusScore(scoreData.score);

            setSession(prev => prev ? {
              ...prev,
              consensusScore: scoreData.score
            } : null);

            console.log(`[Discussion] Consensus score: ${scoreData.previousScore} -> ${scoreData.score}`);

            handlersRef.current.onConsensusUpdate?.(scoreData.score, scoreData.previousScore);
            break;

          case 'blackboard_update':
            // 黑板状态更新
            const boardData = msg.data as { facts: string[]; clashes: string[]; insights: Record<string, string> };

            setSession(prev => prev ? {
              ...prev,
              verifiedFacts: boardData.facts,
              coreClashes: boardData.clashes,
              agentInsights: boardData.insights
            } : null);

            handlersRef.current.onBlackboardUpdate?.(boardData.facts, boardData.clashes, boardData.insights);
            break;

          case 'fluff_detected':
            // 废话检测（静默处理，只记录日志）
            const fluffData = msg.data as { agentName: string; fluffCount: number; cleanContent: string };
            console.log(`[Discussion] Fluff detected from ${fluffData.agentName}: ${fluffData.fluffCount} instances`);
            break;

          case 'discussion_event':
            // 使用 ref 获取最新的 session ID，避免闭包问题
            if (!sessionIdRef.current || msg.sessionId !== sessionIdRef.current) return;

            const eventData = msg.data;
            if (eventData.eventType === 'message') {
              const agentMsg = eventData.data;
              if (agentMsg && agentMsg.type === 'agent') {
                // 添加 Agent 消息到聊天
                addDiscussionMessage({
                  sender: agentMsg.sender,
                  role: agentMsg.role,
                  content: agentMsg.content,
                  type: 'agent',
                  round: agentMsg.round
                });

                setSession(prev => prev ? {
                  ...prev,
                  messages: [...prev.messages, {
                    id: agentMsg.id || `msg_${Date.now()}`,
                    sender: agentMsg.sender,
                    role: agentMsg.role,
                    content: agentMsg.content,
                    timestamp: agentMsg.timestamp || Date.now(),
                    type: 'agent',
                    round: agentMsg.round
                  }]
                } : null);
              }
            } else if (eventData.eventType === 'round_complete') {
              // 轮次完成通知
              setSession(prev => prev ? {
                ...prev,
                currentRound: prev.currentRound + 1
              } : null);
            }
            break;

          case 'discussion_result':
            setIsRunning(false);
            sessionIdRef.current = null; // 清理 ref
            const result = msg.data as DiscussionResult;

            // 构建结论消息，包含 Token 统计
            let conclusionContent = result.conclusion;
            if (result.tokenUsage) {
              conclusionContent += `\n\n---\n📊 **Token 统计**: 输入 ${result.tokenUsage.inputTokens.toLocaleString()} / 输出 ${result.tokenUsage.outputTokens.toLocaleString()} / 总计 **${result.tokenUsage.totalTokens.toLocaleString()}**`;
            }
            conclusionContent += `\n⏱️ **执行时间**: ${(result.duration / 1000).toFixed(1)}秒`;

            // 添加结论消息
            addDiscussionMessage({
              sender: '系统',
              role: 'summary',
              content: conclusionContent,
              type: 'summary'
            });

            // 获取当前 session 状态用于格式化记录
            setSession(prev => {
              if (!prev) return null;
              const updatedSession: DiscussionSession = {
                ...prev,
                status: 'completed' as const,
                conclusion: result.conclusion,
                messages: result.messages
              };

              // 创建主持人会话保存完整讨论记录
              if (handlersRef.current.onCreateHostSession) {
                const topic = updatedSession.messages[0]?.content || '讨论记录';
                const title = `🎯 多智能体讨论: ${topic.substring(0, 30)}${topic.length > 30 ? '...' : ''}`;
                const fullRecord = formatDiscussionRecord(result, updatedSession);
                console.log('[Discussion] Creating host session for discussion record');
                handlersRef.current.onCreateHostSession(title, fullRecord);
              }

              return updatedSession;
            });

            handlersRef.current.onComplete?.(result);
            break;

          case 'discussion_summary':
            // 主持人模式：显示讨论总结，引导后续互动
            const summaryData = msg.data;
            if (summaryData?.summary) {
              addDiscussionMessage({
                sender: '主持人',
                role: 'host',
                content: summaryData.summary,
                type: 'summary'
              });

              // 将讨论结果发送到主会话
              if (onSendToMainSession && summaryData.rawResult) {
                console.log('[Discussion] Sending summary to main session');
                onSendToMainSession(summaryData.summary, summaryData.rawResult);
              }
            }
            break;

          case 'discussion_error':
            setIsRunning(false);
            sessionIdRef.current = null; // 清理 ref
            const errorMsg = msg.data?.error || 'Discussion failed';
            setError(errorMsg);

            // 添加错误消息
            addDiscussionMessage({
              sender: '系统',
              role: 'system',
              content: `❌ 讨论出错: ${errorMsg}`,
              type: 'system'
            });

            setSession(prev => prev ? { ...prev, status: 'error' } : null);
            handlersRef.current.onError?.(errorMsg);
            break;
        }
      } catch (e) {
        // Not a discussion message or parse error
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, addDiscussionMessage]); // 移除 session?.id，因为现在使用 ref

  // 开始讨论
  const startDiscussion = useCallback((input: string, config?: DiscussionConfig & { hostMode?: boolean }) => {
    console.log('[Discussion] startDiscussion called', { ws: ws?.readyState, input: input?.substring(0, 50), config });

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[Discussion] WebSocket not connected', { ws: !!ws, readyState: ws?.readyState });
      setError('WebSocket not connected');
      return;
    }

    setIsRunning(true);
    setError(null);

    const message = JSON.stringify({
      type: 'discussion',
      input,
      config: {
        maxRounds: config?.maxRounds || 3,
        messageTimeout: config?.messageTimeout || 120000,
        mode: config?.mode || 'auto',
        terminationMode: config?.terminationMode || 'both',
        consensusThreshold: config?.consensusThreshold || 85,
        enableFluffDetection: config?.enableFluffDetection !== false
      },
      hostMode: config?.hostMode !== false // 默认开启主持人模式
    });

    console.log('[Discussion] Sending message:', message.substring(0, 300));
    ws.send(message);
  }, [ws]);

  // 停止讨论
  const stopDiscussion = useCallback(() => {
    setIsRunning(false);
    setSession(prev => prev ? { ...prev, status: 'error' } : null);
  }, []);

  // 重置
  const reset = useCallback(() => {
    setSession(null);
    sessionIdRef.current = null; // 清理 ref
    setIsRunning(false);
    setError(null);
    setConsensusScore(0);
    setDiscussionMode('auto');
  }, []);

  // 恢复运行中的讨论（用于重连）
  const restoreRunning = useCallback((discussionId: string) => {
    console.log('[Discussion] Restoring running discussion:', discussionId);
    setIsRunning(true);
    sessionIdRef.current = discussionId; // 更新 ref
    // 创建一个临时的 session 对象来接收后续消息
    setSession({
      id: discussionId,
      agents: [],
      messages: [],
      status: 'running',
      currentRound: 0,
      maxRounds: 3,
      mode: 'auto',
      consensusScore: 0,
      verifiedFacts: [],
      coreClashes: [],
      agentInsights: {}
    });
  }, []);

  return {
    session,
    isRunning,
    error,
    availableAgents: BUILTIN_AGENTS,
    startDiscussion,
    stopDiscussion,
    reset,
    restoreRunning,
    consensusScore,
    discussionMode
  };
}

export default useDiscussion;
