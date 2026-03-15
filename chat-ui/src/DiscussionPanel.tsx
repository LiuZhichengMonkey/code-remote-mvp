/**
 * DiscussionPanel - 多智能体讨论面板
 *
 * 显示多 Agent 讨论过程和结果
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  MessageCircle,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Sparkles,
  Clock,
  Zap
} from 'lucide-react';
import { DiscussionSession, DiscussionMessage, DiscussionAgent } from './types';
import { cn } from './utils';

// Agent 头像颜色
const AGENT_COLORS: Record<string, string> = {
  '代码审查': '#4CAF50',
  '架构师': '#2196F3',
  '测试专家': '#FF9800',
  '安全专家': '#F44336',
  '性能专家': '#9C27B0',
  '产品经理': '#00BCD4',
  '运维专家': '#607D8B',
  'default': '#6366f1'
};

// Agent 图标
const AGENT_ICONS: Record<string, string> = {
  '代码审查': '🔍',
  '架构师': '🏗️',
  '测试专家': '🧪',
  '安全专家': '🔒',
  '性能专家': '⚡',
  '产品经理': '📊',
  '运维专家': '🚀',
  'default': '🤖'
};

interface DiscussionPanelProps {
  session: DiscussionSession;
  onClose?: () => void;
}

// Agent 头像组件
const AgentAvatar: React.FC<{ agent: DiscussionAgent; size?: 'sm' | 'md' | 'lg' }> = ({
  agent,
  size = 'md'
}) => {
  const color = agent.avatar?.color || AGENT_COLORS[agent.name] || AGENT_COLORS.default;
  const icon = agent.avatar?.icon || AGENT_ICONS[agent.name] || AGENT_ICONS.default;

  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base'
  };

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center text-white font-medium shadow-lg',
        sizeClasses[size]
      )}
      style={{ backgroundColor: color }}
      title={`${agent.name} (${agent.role})`}
    >
      <span>{icon}</span>
    </div>
  );
};

// 消息气泡组件
const MessageBubble: React.FC<{ message: DiscussionMessage }> = ({ message }) => {
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';
  const isSummary = message.type === 'summary';
  const color = AGENT_COLORS[message.sender] || AGENT_COLORS.default;
  const icon = AGENT_ICONS[message.sender] || AGENT_ICONS.default;

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <div className="px-4 py-1 bg-white/5 rounded-full text-white/50 text-xs">
          {message.content}
        </div>
      </div>
    );
  }

  if (isSummary) {
    return (
      <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-lg p-4 border border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span className="text-white font-medium">讨论结论</span>
        </div>
        <div className="text-white/80 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0"
          style={{ backgroundColor: color }}
        >
          {icon}
        </div>
      )}

      {/* Content */}
      <div className={cn(
        'flex-1 max-w-[80%]',
        isUser ? 'text-right' : 'text-left'
      )}>
        {/* Header */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-medium text-sm">{message.sender}</span>
            <span className="text-white/40 text-xs">{message.role}</span>
            {message.round && (
              <span className="text-white/30 text-xs">R{message.round}</span>
            )}
          </div>
        )}

        {/* Message */}
        <div className={cn(
          'rounded-lg px-4 py-2 text-sm',
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-white/5 text-white/90'
        )}>
          {message.content}
        </div>
      </div>
    </motion.div>
  );
};

// Agent 列表组件
const AgentList: React.FC<{ agents: DiscussionAgent[] }> = ({ agents }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-white/60" />
          <span className="text-white font-medium text-sm">
            参与者 ({agents.length})
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-white/40" />
        ) : (
          <ChevronDown className="w-4 h-4 text-white/40" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10"
          >
            <div className="p-3 flex flex-wrap gap-2">
              {agents.map((agent, index) => (
                <motion.div
                  key={agent.id || index}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full"
                >
                  <AgentAvatar agent={agent} size="sm" />
                  <span className="text-white/80 text-xs">{agent.name}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// 进度条组件
const ProgressBar: React.FC<{ current: number; max: number }> = ({ current, max }) => {
  const percentage = (current / max) * 100;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <span className="text-white/50 text-xs whitespace-nowrap">
        {current}/{max} 轮
      </span>
    </div>
  );
};

// 主面板组件
export const DiscussionPanel: React.FC<DiscussionPanelProps> = ({ session, onClose }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages]);

  // 复制结论
  const handleCopyConclusion = async () => {
    if (session.conclusion) {
      await navigator.clipboard.writeText(session.conclusion);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 状态图标
  const StatusIcon = {
    pending: <Clock className="w-4 h-4 text-white/40" />,
    running: <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />,
    completed: <CheckCircle className="w-4 h-4 text-green-400" />,
    error: <AlertCircle className="w-4 h-4 text-red-400" />
  }[session.status];

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-900 to-slate-800 rounded-lg border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-white font-medium">多智能体讨论</span>
          </div>
          {StatusIcon}
        </div>
        <ProgressBar current={session.currentRound} max={session.maxRounds} />
      </div>

      {/* Agent List */}
      <div className="px-4 py-3 border-b border-white/10">
        <AgentList agents={session.agents} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <AnimatePresence mode="popLayout">
          {session.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </AnimatePresence>

        {/* 结论 */}
        {session.status === 'completed' && session.conclusion && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4"
          >
            <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-lg p-4 border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                  <span className="text-white font-medium">讨论结论</span>
                </div>
                <button
                  onClick={handleCopyConclusion}
                  className="flex items-center gap-1 text-white/50 hover:text-white text-xs transition-colors"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <div className="text-white/80 text-sm whitespace-pre-wrap">
                {session.conclusion}
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center justify-between text-xs text-white/40">
          <span>
            {session.messages.length} 条消息
          </span>
          <span>
            {session.status === 'running' ? '讨论进行中...' :
             session.status === 'completed' ? '讨论已完成' :
             session.status === 'error' ? '发生错误' : '等待开始'}
          </span>
        </div>
      </div>
    </div>
  );
};

// Agent 选择器组件
export const AgentSelector: React.FC<{
  availableAgents: Array<{ id: string; name: string; role: string; avatar?: { icon?: string; color?: string } }>;
  selectedAgents: string[];
  onToggle: (agentId: string) => void;
}> = ({ availableAgents, selectedAgents, onToggle }) => {
  return (
    <div className="flex flex-wrap gap-2">
      {availableAgents.map((agent) => {
        const isSelected = selectedAgents.includes(agent.id);
        const color = agent.avatar?.color || AGENT_COLORS[agent.name] || AGENT_COLORS.default;
        const icon = agent.avatar?.icon || AGENT_ICONS[agent.name] || AGENT_ICONS.default;

        return (
          <button
            key={agent.id}
            onClick={() => onToggle(agent.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all',
              isSelected
                ? 'border-transparent text-white'
                : 'border-white/20 bg-white/5 text-white/60 hover:border-white/40'
            )}
            style={isSelected ? { backgroundColor: color } : undefined}
          >
            <span>{icon}</span>
            <span className="text-xs">{agent.name}</span>
          </button>
        );
      })}
    </div>
  );
};

// @ 输入框组件
export const DiscussionInput: React.FC<{
  availableAgents: Array<{ id: string; name: string; role: string }>;
  onSubmit: (task: string, agentIds: string[]) => void;
  disabled?: boolean;
}> = ({ availableAgents, onSubmit, disabled }) => {
  const [input, setInput] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [showAgentList, setShowAgentList] = useState(false);

  // 解析 @ 提及
  useEffect(() => {
    const mentions = input.match(/@([^\s@]+)/g) || [];
    const mentionNames = mentions.map(m => m.slice(1));

    // 自动选择被 @ 的 Agent
    for (const name of mentionNames) {
      const agent = availableAgents.find(
        a => a.name === name || a.id === name || a.role.toLowerCase().includes(name.toLowerCase())
      );
      if (agent && !selectedAgents.includes(agent.id)) {
        setSelectedAgents(prev => [...prev, agent.id]);
      }
    }
  }, [input, availableAgents]);

  const handleSubmit = () => {
    const task = input.replace(/@[^\s@]+/g, '').trim();
    if (task && selectedAgents.length > 0) {
      onSubmit(task, selectedAgents);
      setInput('');
      setSelectedAgents([]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Agent 选择器 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAgentList(!showAgentList)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg text-white/60 hover:text-white text-xs transition-colors"
        >
          <Users className="w-3.5 h-3.5" />
          <span>选择参与者 ({selectedAgents.length})</span>
          {showAgentList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* 已选择的 Agent */}
        <div className="flex flex-wrap gap-1">
          {selectedAgents.map(agentId => {
            const agent = availableAgents.find(a => a.id === agentId);
            if (!agent) return null;
            const icon = AGENT_ICONS[agent.name] || AGENT_ICONS.default;

            return (
              <span
                key={agentId}
                className="flex items-center gap-1 px-2 py-0.5 bg-indigo-500/20 rounded text-white/80 text-xs"
              >
                <span>{icon}</span>
                <span>{agent.name}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Agent 列表 */}
      <AnimatePresence>
        {showAgentList && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <AgentSelector
              availableAgents={availableAgents}
              selectedAgents={selectedAgents}
              onToggle={(id) => {
                setSelectedAgents(prev =>
                  prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
                );
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 输入框 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入任务，使用 @ 提及 Agent（如：@代码审查 @架构师 分析这个设计）"
          className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-indigo-500"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !input.trim() || selectedAgents.length === 0}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          开始讨论
        </button>
      </div>
    </div>
  );
};

export default DiscussionPanel;
