import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Menu,
  Plus,
  Paperclip,
  Mic,
  Send,
  X,
  Copy,
  RotateCcw,
  Square,
  MoreVertical,
  AlertCircle,
  GripVertical,
  Hash,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Brain,
  Wifi,
  WifiOff,
  Settings,
  Folder,
  FileText,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
  Sparkles,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Message, Attachment, ChatSession, ChatOption } from './types';
import { cn } from './utils';
import { useDiscussion } from './useDiscussion';

// Simple syntax highlighter for code blocks
const highlightCode = (code: string, language: string): string => {
  const keywords: Record<string, string[]> = {
    javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'true', 'false', 'null', 'undefined'],
    typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'true', 'false', 'null', 'undefined', 'interface', 'type', 'enum', 'implements', 'extends', 'private', 'public', 'protected', 'readonly'],
    python: ['def', 'class', 'if', 'else', 'elif', 'for', 'while', 'return', 'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is'],
    bash: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv'],
    json: [],
  };

  const lang = language.toLowerCase() || 'javascript';
  const kw = keywords[lang] || keywords.javascript;

  // Escape HTML
  let highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Highlight strings
  highlighted = highlighted.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span style="color:#a5d6ff">$&</span>');

  // Highlight comments
  highlighted = highlighted.replace(/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/gm, '<span style="color:#8b949e;font-style:italic">$1</span>');

  // Highlight keywords
  if (kw.length > 0) {
    const keywordRegex = new RegExp(`\\b(${kw.join('|')})\\b`, 'g');
    highlighted = highlighted.replace(keywordRegex, '<span style="color:#ff7b72">$1</span>');
  }

  // Highlight numbers
  highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#79c0ff">$1</span>');

  // Highlight function calls
  highlighted = highlighted.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, '<span style="color:#d2a8ff">$1</span>(');

  return highlighted;
};

// Code Block Component with Copy Button
const CodeBlock = ({ code, language }: { code: string; language: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  return (
    <div className="relative group/mycode">
      <div className="flex items-center justify-between px-3 py-2 bg-black/30 rounded-t-lg border-b border-white/10 text-xs">
        <span className="text-white/50 font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-white/50 hover:text-white transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="!mt-0 !rounded-t-none">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }} />
      </pre>
    </div>
  );
};

// --- WebSocket Connection Types ---
interface ProjectInfo {
  id: string;
  displayName: string;
  sessionCount: number;
  lastActivity: number;
}

interface WSMessage {
  type: string;
  content?: string;
  thinking?: string;
  done?: boolean;
  replace?: boolean;  // 后台会话切换回来时，替换而不是追加内容
  error?: string;
  code?: string;
  data?: any;
  command?: string;
  success?: boolean;
  sessionId?: string;
  projectId?: string;
  // 附件（图片）
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    data: string;  // base64 encoded
  }>;
  // 工具事件
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  result?: string;
  isError?: boolean;
  session?: {
    id: string;
    title: string;
    summary?: string;
    createdAt?: number;
    messageCount?: number;
    messages?: Message[];
  };
  sessions?: Array<{
    id: string;
    title: string;
    summary?: string;
    createdAt: number;
    messageCount: number;
    messages?: Message[];
  }>;
  projects?: ProjectInfo[];
  // 日志
  level?: string;
  message?: string;
  timestamp?: number;
  // 分页
  hasMore?: boolean;
  totalMessages?: number;
  // 会话 ID 更新
  oldSessionId?: string;
  newSessionId?: string;
  title?: string;
  // 消息加载
  messages?: Message[];
}

// --- Settings List Panel ---
interface SettingsItem {
  name: string;
  model: string;
  env: number;
  envDetails?: Record<string, string>;
}

// --- Connection Panel ---
const ConnectionPanel = ({
  url,
  token,
  onUrlChange,
  onTokenChange,
  onConnect,
  onDisconnect,
  isConnected,
  isConnecting,
  wsRef
}: {
  url: string;
  token: string;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  wsRef: React.MutableRefObject<WebSocket | null>;
}) => {
  const [settingsList, setSettingsList] = useState<SettingsItem[]>([]);
  const [selectedSettings, setSelectedSettings] = useState<string>('');
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  // 手动编辑模式
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_MODEL: ''
  });

  // 用于点击外部关闭下拉菜单
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const showSettingsDropdownRef = useRef(showSettingsDropdown);
  showSettingsDropdownRef.current = showSettingsDropdown;

  // 点击外部关闭设置下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showSettingsDropdownRef.current && settingsDropdownRef.current && !settingsDropdownRef.current.contains(target)) {
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // 加载配置文件列表
  const loadSettingsList = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[Settings] WS not ready, state:', wsRef.current?.readyState);
      return;
    }

    setLoadingSettings(true);
    console.log('[Settings] Loading settings list...');
    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'list'
    }));

    // 设置一次性监听器
    const handleSettingsMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Settings] Received:', data.type);
        if (data.type === 'settings_list') {
          setSettingsList(data.settings || []);
          setLoadingSettings(false);
        } else if (data.type === 'settings_switched') {
          alert(data.message);
          // 重置选择
          setSelectedSettings(data.settingsName);
        } else if (data.type === 'settings_error') {
          console.error('Settings error:', data.error);
          setLoadingSettings(false);
        }
      } catch (e) {
        console.error('[Settings] Parse error:', e);
        setLoadingSettings(false);
      }
    };

    wsRef.current.addEventListener('message', handleSettingsMessage);
    return () => {
      wsRef.current?.removeEventListener('message', handleSettingsMessage);
    };
  }, [wsRef]);

  // 切换配置文件
  const switchSettings = useCallback((settingsName: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'switch',
      settingsName
    }));
    setShowSettingsDropdown(false);
  }, [wsRef]);

  // 保存手动编辑的配置
  const saveManualConfig = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'save',
      envDetails: editForm
    }));

    // 设置一次性监听器
    const handleSettingsMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'settings_saved') {
          alert(data.message);
          setIsEditing(false);
          setSelectedSettings('(手动编辑)');
        } else if (data.type === 'settings_error') {
          console.error('Settings error:', data.error);
          alert('保存失败: ' + data.error);
        }
      } catch {}
    };

    wsRef.current.addEventListener('message', handleSettingsMessage);
    return () => {
      wsRef.current?.removeEventListener('message', handleSettingsMessage);
    };
  }, [wsRef, editForm]);

  // 当连接成功时不需要自动加载，用户点击时再加载
  useEffect(() => {
    // 连接断开时重置状态
    if (!isConnected) {
      setSettingsList([]);
      setSelectedSettings('');
      setShowSettingsDropdown(false);
      setIsEditing(false);
      setEditForm({ ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: '' });
    }
  }, [isConnected]);

  return (
    <div className="p-4 bg-card border-b border-white/10">
      <div className="flex items-center gap-2 mb-3">
        {isConnected ? (
          <Wifi size={16} className="text-green-400" />
        ) : (
          <WifiOff size={16} className="text-white/40" />
        )}
        <span className="text-xs font-medium text-white/60">
          {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
        </span>
      </div>

      {/* Settings Config Selector */}
      {isConnected && (
        <div className="mb-3">
          <label className="text-xs text-white/60 mb-1 block">Settings Config</label>
          <div className="relative" ref={settingsDropdownRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (settingsList.length === 0 && !showSettingsDropdown) {
                  loadSettingsList();
                }
                setShowSettingsDropdown(!showSettingsDropdown);
              }}
              disabled={loadingSettings}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white flex items-center justify-between hover:bg-white/10 transition-colors"
            >
              <span className={selectedSettings ? '' : 'text-white/40'}>
                {loadingSettings ? 'Loading...' : selectedSettings || 'Select settings config...'}
              </span>
              <ChevronDown size={14} className={`text-white/40 transition-transform ${showSettingsDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showSettingsDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-white/10 rounded-lg overflow-hidden z-[100] max-h-60 overflow-y-auto shadow-lg">
                {settingsList.length === 0 ? (
                  <div className="p-3 text-sm text-white/40 text-center">
                    No settings found
                  </div>
                ) : (
                  settingsList.map((settings) => (
                    <button
                      key={settings.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSettings(settings.name);
                        switchSettings(settings.name);
                        setShowSettingsDropdown(false);
                      }}
                      className="w-full px-3 py-2 text-sm text-white hover:bg-white/10 flex flex-col items-start"
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-medium">{settings.name}</span>
                        <span className="text-xs text-white/40">{settings.model}</span>
                      </div>
                      {/* 显示 env 详情 */}
                      {settings.envDetails && (
                        <div className="mt-1 text-xs text-white/50 w-full">
                          {settings.envDetails.ANTHROPIC_BASE_URL && (
                            <div className="truncate">URL: {settings.envDetails.ANTHROPIC_BASE_URL}</div>
                          )}
                          {settings.envDetails.ANTHROPIC_AUTH_TOKEN && (
                            <div className="truncate">Token: {settings.envDetails.ANTHROPIC_AUTH_TOKEN.substring(0, 20)}...</div>
                          )}
                          {settings.envDetails.ANTHROPIC_MODEL && (
                            <div>Model: {settings.envDetails.ANTHROPIC_MODEL}</div>
                          )}
                        </div>
                      )}
                    </button>
                  ))
                )}

                {/* 分隔线 */}
                <div className="border-t border-white/10" />

                {/* 手动编辑按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isEditing) {
                      // 初始化编辑表单，使用当前选择的配置
                      const current = settingsList.find(s => s.name === selectedSettings);
                      setEditForm({
                        ANTHROPIC_BASE_URL: current?.envDetails?.ANTHROPIC_BASE_URL || '',
                        ANTHROPIC_AUTH_TOKEN: current?.envDetails?.ANTHROPIC_AUTH_TOKEN || '',
                        ANTHROPIC_MODEL: current?.envDetails?.ANTHROPIC_MODEL || ''
                      });
                    }
                    setIsEditing(!isEditing);
                  }}
                  className="w-full px-3 py-2 text-sm text-accent hover:bg-white/10 rounded-lg transition-colors"
                >
                  {isEditing ? '取消编辑' : '+ 手动编辑配置'}
                </button>
              </div>
            )}

            {/* 手动编辑表单 */}
            {isEditing && (
              <div className="mt-3 p-3 bg-white/5 rounded-lg space-y-2 border border-white/10">
                <div className="text-xs text-white/60 mb-2">手动编辑配置</div>
                <input
                  type="text"
                  value={editForm.ANTHROPIC_BASE_URL}
                  onChange={(e) => setEditForm({...editForm, ANTHROPIC_BASE_URL: e.target.value})}
                  placeholder="ANTHROPIC_BASE_URL"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                />
                <input
                  type="password"
                  value={editForm.ANTHROPIC_AUTH_TOKEN}
                  onChange={(e) => setEditForm({...editForm, ANTHROPIC_AUTH_TOKEN: e.target.value})}
                  placeholder="ANTHROPIC_AUTH_TOKEN"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                />
                <input
                  type="text"
                  value={editForm.ANTHROPIC_MODEL}
                  onChange={(e) => setEditForm({...editForm, ANTHROPIC_MODEL: e.target.value})}
                  placeholder="ANTHROPIC_MODEL"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                />
                <button
                  onClick={saveManualConfig}
                  className="w-full py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors"
                >
                  保存并应用
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="WebSocket URL (ws://...)"
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          disabled={isConnected}
        />
        <input
          type="password"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="Token"
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          disabled={isConnected}
        />

        {isConnected ? (
          <button
            onClick={onDisconnect}
            className="w-full py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={isConnecting || !url || !token}
            className="w-full py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
};

// --- Components ---

const Header = ({
  onMenuClick,
  onNewChat,
  title,
  onTitleChange,
  onTitleBlur,
  onSettingsClick,
  isConnected
}: {
  onMenuClick: () => void;
  onNewChat: () => void;
  title: string;
  onTitleChange: (newTitle: string) => void;
  onTitleBlur: (newTitle: string) => void;
  onSettingsClick: () => void;
  isConnected: boolean;
}) => (
  <header className="fixed top-0 left-0 right-0 h-[50px] z-50 flex items-center justify-between px-4 bg-black/60 backdrop-blur-xl border-b border-white/5">
    <button onClick={onMenuClick} className="p-2 -ml-2 text-white/70 active:text-white">
      <Menu size={20} />
    </button>
    <div className="flex-1 px-4 flex justify-center items-center gap-2">
      {isConnected ? (
        <Wifi size={14} className="text-green-400" />
      ) : (
        <WifiOff size={14} className="text-red-400" />
      )}
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={(e) => onTitleBlur(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        className="bg-transparent text-[13px] font-medium text-white/50 tracking-wide uppercase text-center focus:outline-none focus:text-white/80 w-full max-w-[200px]"
        placeholder="New Chat"
      />
    </div>
    <div className="flex items-center gap-1">
      <button onClick={onSettingsClick} className="settings-toggle-btn p-2 text-white/70 active:text-white">
        <Settings size={18} />
      </button>
      <button onClick={onNewChat} className="p-2 -mr-2 text-white/70 active:text-white">
        <Plus size={20} />
      </button>
    </div>
  </header>
);

// 格式化工具调用为 Claude CLI 风格
const formatToolCall = (toolName: string, toolInput?: Record<string, unknown>): string => {
  if (!toolInput) return toolName;

  const getFileName = (path: string): string => {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(v => formatValue(v)).join(', ');
    return JSON.stringify(value);
  };

  switch (toolName) {
    case 'Read':
    case 'Glob':
    case 'Grep': {
      const mainKey = toolName === 'Read' ? 'file_path' : 'pattern';
      const mainValue = toolInput[mainKey] || Object.values(toolInput)[0];
      if (typeof mainValue === 'string') {
        const display = toolName === 'Read' ? getFileName(mainValue) : mainValue;
        return `${toolName}(${display})`;
      }
      return `${toolName}(${formatValue(mainValue)})`;
    }
    case 'Bash': {
      const cmd = toolInput.command || Object.values(toolInput)[0];
      if (typeof cmd === 'string') {
        const truncated = cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
        return `${toolName}(${truncated})`;
      }
      return toolName;
    }
    case 'Write':
    case 'Edit': {
      const filePath = toolInput.file_path || toolInput.path || Object.values(toolInput)[0];
      if (typeof filePath === 'string') {
        return `${toolName}(${getFileName(filePath)})`;
      }
      return toolName;
    }
    default: {
      const firstValue = Object.values(toolInput)[0];
      if (firstValue) {
        const formatted = formatValue(firstValue);
        const truncated = formatted.length > 50 ? formatted.substring(0, 50) + '...' : formatted;
        return `${toolName}(${truncated})`;
      }
      return toolName;
    }
  }
};

const ChatBubble = React.memo(({
  message,
  isStreaming,
  onRetry,
  onCopy,
  onRegenerate,
  onOptionClick
}: {
  message: Message;
  isStreaming?: boolean;
  onRetry?: () => void;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  onOptionClick?: (option: string) => void;
}) => {
  const isUser = message.role === 'user';
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isAgentExpanded, setIsAgentExpanded] = useState(false);

  let thinkingContent = message.thinking || '';
  let displayContent = message.content;

  // Detect if this is an Agent discussion message (format: "🔍 **代码审查** (Code Reviewer) *R1*\n\n内容")
  const agentMessageMatch = displayContent.match(/^([^\s]+)\s+\*\*([^*]+)\*\*\s+\(([^)]+)\)(?:\s+\*R(\d+)\*)?\n\n([\s\S]*)$/);
  const isAgentMessage = !isUser && agentMessageMatch !== null && !isStreaming;
  const agentIcon = agentMessageMatch?.[1] || '🤖';
  const agentName = agentMessageMatch?.[2] || 'Agent';
  const agentRole = agentMessageMatch?.[3] || '';
  const agentRound = agentMessageMatch?.[4] ? `R${agentMessageMatch[4]}` : '';
  const agentContent = agentMessageMatch?.[5] || displayContent;

  // Parse thinking tags
  const thinkingStartTag = '<thinking>';
  const thinkingEndTag = '</thinking>';

  if (displayContent.includes(thinkingStartTag)) {
    const startIndex = displayContent.indexOf(thinkingStartTag) + thinkingStartTag.length;
    const endIndex = displayContent.indexOf(thinkingEndTag);

    if (endIndex !== -1) {
      thinkingContent = displayContent.substring(startIndex, endIndex).trim();
      displayContent = displayContent.substring(0, displayContent.indexOf(thinkingStartTag)) +
                       displayContent.substring(endIndex + thinkingEndTag.length);
    } else {
      thinkingContent = displayContent.substring(startIndex).trim();
      displayContent = displayContent.substring(0, displayContent.indexOf(thinkingStartTag));
    }
  }

  // Auto-expand thinking while streaming
  useEffect(() => {
    if (isStreaming && thinkingContent) {
      setIsThinkingExpanded(true);
    }
  }, [isStreaming, !!thinkingContent]);

  // Parse internal choices vs follow-up suggestions
  const choicesMatch = displayContent.match(/\[CHOICES\]([\s\S]*?)\[\/CHOICES\]/);
  let internalChoices: ChatOption[] = [];
  if (choicesMatch) {
    try {
      internalChoices = JSON.parse(choicesMatch[1].trim());
    } catch (e) {}
  }

  // Auto-detect A/B/C or 1/2/3 options from content
  const letterOptions: ChatOption[] = [];
  const tempContent = displayContent;

  // Pattern for letter options only (A. B. C.)
  // Number lists (1. 2. 3.) are treated as steps and displayed normally
  const optionPattern = /^[A-Z][\.\)、]\s+(.+)$/;

  if (!isStreaming) {
    const lines = tempContent.split('\n');
    let inOptionsBlock = false;
    let optionsStartIndex = -1;
    let optionsEndIndex = -1;

    // Find continuous options block
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (optionPattern.test(line)) {
        if (!inOptionsBlock) {
          inOptionsBlock = true;
          optionsStartIndex = i;
        }
        // Parse option
        const match = line.match(optionPattern);
        if (match) {
          letterOptions.push({
            label: line.charAt(0), // A, B, C
            description: match[1].trim()
          });
        }
        optionsEndIndex = i;
      } else if (inOptionsBlock && line === '') {
        // Empty line might be part of options block
        continue;
      } else if (inOptionsBlock) {
        // Non-option line breaks the sequence
        break;
      }
    }

    // Remove options from display content if found at least 2 options
    if (letterOptions.length >= 2) {
      const beforeOptions = lines.slice(0, optionsStartIndex);
      const afterOptions = lines.slice(optionsEndIndex + 1);
      displayContent = [...beforeOptions, ...afterOptions].join('\n').trim();
    } else {
      letterOptions.length = 0; // Clear if not enough options
    }
  }

  // Combine choices
  const allChoices = [...internalChoices, ...letterOptions];

  displayContent = displayContent
    .replace(/\[CHOICES\][\s\S]*?\[\/CHOICES\]/, '')
    .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/, '')
    .trim();

  const groupedOptions = message.options?.reduce((acc, opt) => {
    const cat = opt.category || 'Suggestions';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(opt);
    return acc;
  }, {} as Record<string, typeof message.options>) || {};

  return (
    <motion.div
      id={`message-${message.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex flex-col w-full mb-6 px-4",
        isUser ? "items-end" : "items-start"
      )}
    >
      <div className={cn(
        "max-w-[90%] relative group",
        isUser ? "items-end" : "items-start"
      )}>
        {isUser && message.status === 'error' && (
          <button
            onClick={onRetry}
            className="absolute -left-8 top-1/2 -translate-y-1/2 text-red-500 animate-pulse"
          >
            <AlertCircle size={18} />
          </button>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 justify-end">
            {message.attachments.map(att => (
              <img
                key={att.id}
                src={att.url}
                alt={att.name}
                className="w-32 h-32 object-cover rounded-xl border border-white/10"
                referrerPolicy="no-referrer"
              />
            ))}
          </div>
        )}

        <div className={cn(
          "px-4 py-3 rounded-2xl text-[16px] leading-relaxed",
          isUser
            ? "bg-accent text-white rounded-tr-none"
            : "bg-card text-white/90 rounded-tl-none border border-white/5"
        )}>
          {/* Thinking Process - show during streaming and after completion */}
          {!isUser && thinkingContent && (
            <div className="mb-4 overflow-hidden">
              <button
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className="flex items-center gap-2 text-[11px] font-bold text-white/30 hover:text-white/50 transition-colors uppercase tracking-[0.1em] mb-2 group/thinking"
              >
                <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center group-hover/thinking:bg-accent/20 transition-colors">
                  <Brain size={12} className="text-accent" />
                </div>
                <span>Thinking Process</span>
                <motion.div
                  animate={{ rotate: isThinkingExpanded ? 180 : 0 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                >
                  <ChevronDown size={14} />
                </motion.div>
              </button>

              <AnimatePresence initial={false}>
                {isThinkingExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      height: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
                      opacity: { duration: 0.2 }
                    }}
                    className="overflow-hidden bg-white/[0.03] rounded-xl p-4 border border-white/5 text-[13.5px] text-white/50 italic leading-relaxed font-serif whitespace-pre-wrap"
                  >
                    {thinkingContent}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Tool Use Section - Hidden for now */}
          {false && !isUser && message.tools && message.tools.length > 0 && (
            <div className="mb-3 space-y-2">
              {message.tools.map((tool, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs"
                >
                  <span className="text-blue-400">🔧</span>
                  <span className="text-blue-300 font-medium">{tool.toolName}</span>
                  {tool.toolInput && (
                    <span className="text-white/40 truncate max-w-[200px]">
                      {typeof tool.toolInput === 'object' ? JSON.stringify(tool.toolInput).substring(0, 50) : String(tool.toolInput).substring(0, 50)}
                      ...
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Agent Discussion Message - Collapsible */}
          {isAgentMessage && (
            <div className="mb-1">
              <button
                onClick={() => setIsAgentExpanded(!isAgentExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{agentIcon}</span>
                  <span className="font-semibold text-white">{agentName}</span>
                  {agentRole && (
                    <span className="text-white/40 text-sm">({agentRole})</span>
                  )}
                  {agentRound && (
                    <span className="text-xs px-2 py-0.5 bg-accent/20 text-accent rounded-full">{agentRound}</span>
                  )}
                </div>
                <motion.div
                  animate={{ rotate: isAgentExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown size={16} className="text-white/40" />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {isAgentExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      height: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
                      opacity: { duration: 0.2 }
                    }}
                    className="overflow-hidden"
                  >
                    <div className="markdown-body mt-2 pl-3 border-l-2 border-white/10">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{
                          code({ className, children, inline, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '');
                            const codeString = String(children).replace(/\n$/, '');
                            const isCodeBlock = match || codeString.includes('\n');
                            if (isCodeBlock && !inline) {
                              return (
                                <CodeBlock
                                  code={codeString}
                                  language={match ? match[1] : 'text'}
                                />
                              );
                            }
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {agentContent}
                      </ReactMarkdown>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Normal Message Content (not Agent message) */}
          {!isAgentMessage && (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={{
                code({ className, children, inline, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  const codeString = String(children).replace(/\n$/, '');

                  // Check if it's a code block (has language or multiple lines) vs inline code
                  const isCodeBlock = match || codeString.includes('\n');

                  if (isCodeBlock && !inline) {
                    return (
                      <CodeBlock
                        code={codeString}
                        language={match ? match[1] : 'text'}
                      />
                    );
                  }

                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                // 处理段落，保留换行
                p({ children }: any) {
                  return <p className="whitespace-pre-wrap">{children}</p>;
                }
              }}
            >
              {displayContent}
            </ReactMarkdown>
            {!isUser && isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-1 bg-accent animate-pulse align-middle" />
            )}
          </div>
          )}

          {/* Options (Cards) */}
          {!isStreaming && allChoices.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3">
              {allChoices.map((choice, idx) => (
                <button
                  key={idx}
                  onClick={() => onOptionClick?.(choice.description || choice.label)}
                  className="w-full text-left p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-accent/50 transition-all active:scale-[0.98]"
                >
                  {choice.category && (
                    <span className="text-[10px] font-bold text-accent uppercase tracking-widest block mb-1">
                      {choice.category}
                    </span>
                  )}
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent text-sm font-bold flex items-center justify-center">
                      {choice.label}
                    </span>
                    <div className="flex-1">
                      <div className="text-[15px] font-medium text-white">{choice.description || choice.label}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Bar */}
        {!isUser && !isStreaming && (
          <div className="flex items-center gap-3 mt-2 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onCopy?.(message.content)}
              className="text-white/30 hover:text-white/60 p-1"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={onRegenerate}
              className="text-white/30 hover:text-white/60 p-1"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Follow-up Options (Buttons) */}
      {!isStreaming && Object.keys(groupedOptions).length > 0 && (
        <div className="mt-4 w-full flex flex-col gap-4">
          {Object.entries(groupedOptions).map(([category, opts]) => (
            <div key={category} className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-white/30 uppercase tracking-widest ml-1">
                {category}
              </span>
              <div className="flex flex-wrap gap-2">
                {opts?.map((opt, idx) => (
                  <button
                    key={idx}
                    onClick={() => onOptionClick?.(opt.label)}
                    className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white/80 hover:bg-accent hover:border-accent hover:text-white transition-all active:scale-95"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
});

const InputArea = ({
  onSend,
  isGenerating,
  onStop,
  isConnected,
  onFocus
}: {
  onSend: (text: string, files: Attachment[]) => void;
  isGenerating: boolean;
  onStop: () => void;
  isConnected: boolean;
  onFocus?: () => void;
}) => {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [skillFilter, setSkillFilter] = useState('');
  const [showAgents, setShowAgents] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [agentStartPos, setAgentStartPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 技能列表
  const skills = [
    { id: 'git-commit', name: 'Git Commit', description: '提交代码并推送到 GitHub', trigger: '/git-workflow' },
    { id: 'create-readme', name: 'Create README', description: '为项目创建 README 文档', trigger: '/create-readme' },
    { id: 'simplify', name: 'Simplify Code', description: '简化并优化代码', trigger: '/simplify' },
    { id: 'brainstorm', name: 'Brainstorm', description: '头脑风暴新功能创意', trigger: '/brainstorming' },
  ];

  // Agent 列表
  const agents = [
    { id: 'code-reviewer', name: '代码审查', alias: 'code-reviewer', icon: '🔍', color: '#4CAF50', description: '代码质量、bug、最佳实践' },
    { id: 'architect', name: '架构师', alias: 'architect', icon: '🏗️', color: '#2196F3', description: '系统架构、设计模式' },
    { id: 'tester', name: '测试专家', alias: 'tester', icon: '🧪', color: '#FF9800', description: '测试覆盖、边缘情况' },
    { id: 'security', name: '安全专家', alias: 'security', icon: '🔒', color: '#F44336', description: '安全漏洞、认证授权' },
    { id: 'performance', name: '性能专家', alias: 'performance', icon: '⚡', color: '#9C27B0', description: '性能瓶颈、优化' },
    { id: 'product', name: '产品经理', alias: 'product', icon: '📊', color: '#00BCD4', description: '产品需求、用户体验' },
    { id: 'devops', name: '运维专家', alias: 'devops', icon: '🚀', color: '#607D8B', description: '部署、监控、CI/CD' },
  ];

  // 过滤技能
  const filteredSkills = skillFilter
    ? skills.filter(s => s.name.toLowerCase().includes(skillFilter.toLowerCase()) || s.description.toLowerCase().includes(skillFilter.toLowerCase()))
    : skills;

  // 过滤 Agent
  const filteredAgents = agentFilter
    ? agents.filter(a =>
        a.name.includes(agentFilter) ||
        a.alias.toLowerCase().includes(agentFilter.toLowerCase()) ||
        a.description.includes(agentFilter)
      )
    : agents;

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // 检测是否输入了 /
    if (value === '/') {
      setShowSkills(true);
      setSkillFilter('');
      setShowAgents(false);
    } else if (showSkills && value.startsWith('/')) {
      setSkillFilter(value.slice(1));
    } else if (showSkills && !value.startsWith('/')) {
      setShowSkills(false);
      setSkillFilter('');
    }

    // 检测是否输入了 @ - Agent 选择
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      // 检查 @ 后面是否有空格（如果有空格，说明 @ 提及已结束）
      const textAfterAt = value.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('@')) {
        setShowAgents(true);
        setAgentFilter(textAfterAt);
        setAgentStartPos(lastAtIndex);
        setShowSkills(false);
      } else {
        setShowAgents(false);
      }
    } else {
      setShowAgents(false);
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  // 选择技能 - 自动发送
  const handleSelectSkill = (skill: typeof skills[0]) => {
    const skillMessage = skill.trigger + ' ';
    console.log('[handleSelectSkill] skill:', skill.name, 'message:', skillMessage, 'isConnected:', isConnected, 'isGenerating:', isGenerating);
    setInput(skillMessage);
    setShowSkills(false);
    setSkillFilter('');

    // 自动发送技能消息
    if (isConnected && !isGenerating) {
      console.log('[handleSelectSkill] Calling onSend...');
      onSend(skillMessage, []);
    } else {
      console.log('[handleSelectSkill] NOT sending - isConnected:', isConnected, 'isGenerating:', isGenerating);
    }
  };

  // 选择 Agent - 插入 @提及
  const handleSelectAgent = (agent: typeof agents[0]) => {
    const value = input;
    // 替换 @ 后面的文字为选中的 agent 名称
    const beforeAt = value.slice(0, agentStartPos);
    const afterFilter = value.slice(agentStartPos + 1 + agentFilter.length);
    const newValue = beforeAt + '@' + agent.name + ' ' + afterFilter;
    setInput(newValue);
    setShowAgents(false);
    setAgentFilter('');

    // 聚焦回输入框
    setTimeout(() => {
      textareaRef.current?.focus();
      // 移动光标到末尾
      textareaRef.current?.setSelectionRange(newValue.length, newValue.length);
    }, 0);
  };

  // 关闭技能弹窗
  const closeSkillsPopup = () => {
    setShowSkills(false);
    setSkillFilter('');
  };

  // 关闭 Agent 弹窗
  const closeAgentsPopup = () => {
    setShowAgents(false);
    setAgentFilter('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = await Promise.all(
      selectedFiles.map(file => new Promise<Attachment>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            id: Math.random().toString(36).substr(2, 9),
            url: URL.createObjectURL(file),
            type: file.type,
            name: file.name,
            data: (reader.result as string).split(',')[1]
          });
        };
        reader.readAsDataURL(file);
      }))
    );
    setFiles(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleSubmit = () => {
    if ((!input.trim() && files.length === 0) || isGenerating || !isConnected) return;
    onSend(input, files);
    setInput('');
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-2xl border-t border-white/5 pb-[env(safe-area-inset-bottom)]">
      {/* File Preview */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex gap-3 px-4 py-3 overflow-x-auto no-scrollbar"
          >
            {files.map(file => (
              <div key={file.id} className="relative flex-shrink-0">
                {file.type.startsWith('image/') ? (
                  <img
                    src={file.url}
                    alt="preview"
                    className="w-16 h-16 object-cover rounded-lg border border-white/10"
                  />
                ) : (
                  <div className="w-16 h-16 flex items-center justify-center bg-white/10 rounded-lg border border-white/10">
                    <FileText size={24} className="text-white/50" />
                  </div>
                )}
                <button
                  onClick={() => removeFile(file.id)}
                  className="absolute -top-2 -right-2 bg-black/80 text-white rounded-full p-0.5 border border-white/20"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2 px-3 py-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 text-white/50 hover:text-white active:scale-95 transition-transform disabled:opacity-30"
          disabled={!isConnected}
        >
          <Paperclip size={22} />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept="*/*"
          onChange={handleFileSelect}
        />

        <div className="flex-1 relative bg-white/5 rounded-2xl border border-white/10 focus-within:border-accent/50 transition-colors">
          {isRecording ? (
            <div className="flex items-center justify-between px-4 h-[44px]">
              <div className="flex gap-1 items-center">
                <div className="w-1 h-4 bg-accent animate-pulse rounded-full" />
                <div className="w-1 h-6 bg-accent animate-pulse rounded-full delay-75" />
                <div className="w-1 h-3 bg-accent animate-pulse rounded-full delay-150" />
                <div className="w-1 h-5 bg-accent animate-pulse rounded-full delay-100" />
                <span className="text-xs text-white/40 ml-2">Listening...</span>
              </div>
              <button
                onClick={toggleRecording}
                className="text-accent text-[14px] font-medium"
              >
                Done
              </button>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleTextareaChange}
              onFocus={onFocus}
              placeholder={isConnected ? "Message... (/ for commands, @ for multi-agent discussion)" : "Connect to start..."}
              className="w-full bg-transparent text-white px-4 py-2.5 resize-none focus:outline-none text-[16px] max-h-[120px] disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={!isConnected}
              onBlur={() => setTimeout(() => setShowSkills(false), 200)}
            />
          )}

          {/* Skills Popup */}
          {showSkills && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-white/10 rounded-xl shadow-lg overflow-hidden z-50">
              <div className="p-2 border-b border-white/10">
                <span className="text-xs text-white/50">选择技能</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {filteredSkills.length === 0 ? (
                  <div className="p-3 text-xs text-white/40">没有找到匹配的技能</div>
                ) : (
                  filteredSkills.map(skill => (
                    <button
                      key={skill.id}
                      onClick={() => handleSelectSkill(skill)}
                      className="w-full p-3 text-left hover:bg-white/5 transition-colors flex items-center gap-3"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white">{skill.name}</div>
                        <div className="text-xs text-white/40">{skill.description}</div>
                      </div>
                      <span className="text-xs text-accent font-mono">{skill.trigger}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Agent 选择弹框 */}
          {showAgents && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-white/10 rounded-xl shadow-lg overflow-hidden z-50">
              <div className="p-2 border-b border-white/10">
                <span className="text-xs text-white/50">🤖 选择智能体（可多选）</span>
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {filteredAgents.length === 0 ? (
                  <div className="p-3 text-xs text-white/40">没有找到匹配的智能体</div>
                ) : (
                  filteredAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => handleSelectAgent(agent)}
                      className="w-full p-3 text-left hover:bg-white/5 transition-colors flex items-center gap-3"
                    >
                      <span className="text-xl" style={{ color: agent.color }}>{agent.icon}</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white">{agent.name}</div>
                        <div className="text-xs text-white/40">{agent.description}</div>
                      </div>
                      <span className="text-xs text-white/30 font-mono">@{agent.alias}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {isGenerating ? (
          <button
            onClick={onStop}
            className="p-2.5 bg-white/10 text-white rounded-full active:scale-90 transition-transform"
          >
            <Square size={20} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={isRecording ? toggleRecording : toggleRecording}
            className={cn(
              "p-2.5 rounded-full transition-all active:scale-90",
              isRecording ? "bg-accent text-white" : "text-white/50 hover:text-white"
            )}
          >
            <Mic size={22} />
          </button>
        )}

        {input.trim() || files.length > 0 ? (
          <button
            onClick={handleSubmit}
            disabled={isGenerating || !isConnected}
            className="p-2.5 bg-accent text-white rounded-full active:scale-90 transition-transform disabled:opacity-50"
          >
            <Send size={20} />
          </button>
        ) : null}
      </div>
    </div>
  );
};

const ScrollIndex = ({
  messages,
  onJump,
  scrollRef
}: {
  messages: Message[];
  onJump: (id: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrollPercentage, setScrollPercentage] = useState(0);
  const [messagePositions, setMessagePositions] = useState<{id: string, top: number}[]>([]);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isDragging = useRef(false);

  const userMessages = messages.filter(m => m.role === 'user');

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      if (isDragging.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      const totalScrollable = scrollHeight - clientHeight;
      if (totalScrollable <= 0) {
        setScrollPercentage(0);
      } else {
        setScrollPercentage(scrollTop / totalScrollable);
      }
    };

    const updatePositions = () => {
      const { scrollHeight } = scrollEl;
      if (scrollHeight <= 0) return;

      const positions = userMessages.map(msg => {
        const el = document.getElementById(`message-${msg.id}`);
        if (el) {
          return {
            id: msg.id,
            top: el.offsetTop / scrollHeight
          };
        }
        return null;
      }).filter(Boolean) as {id: string, top: number}[];

      setMessagePositions(positions);
    };

    scrollEl.addEventListener('scroll', handleScroll);
    const observer = new ResizeObserver(updatePositions);
    observer.observe(scrollEl);

    updatePositions();

    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [messages, scrollRef]);

  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      setIsOpen(true);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleDrag = (e: any, info: any) => {
    isDragging.current = true;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const { scrollHeight, clientHeight } = scrollEl;
    const totalScrollable = scrollHeight - clientHeight;
    const trackHeight = window.innerHeight - 100;

    const deltaPercent = info.delta.y / trackHeight;
    const newPercent = Math.max(0, Math.min(1, scrollPercentage + deltaPercent));

    setScrollPercentage(newPercent);
    scrollEl.scrollTop = newPercent * totalScrollable;
  };

  return (
    <>
      <div className="fixed right-0 top-0 bottom-0 w-8 z-[100] flex items-center justify-center pointer-events-none">
        <div className="absolute right-3 top-20 bottom-20 w-[1px] bg-white/10" />

        <div className="absolute right-0 top-20 bottom-20 w-8 pointer-events-none">
          {messagePositions.map((pos) => (
            <button
              key={pos.id}
              onClick={() => onJump(pos.id)}
              className="pointer-events-auto absolute right-[9px] w-[6px] h-[12px] bg-white/40 rounded-full hover:bg-white/80 hover:w-[8px] hover:h-[16px] transition-all active:scale-125 cursor-pointer shadow-[0_0_8px_rgba(255,255,255,0.1)]"
              style={{
                top: `${pos.top * 100}%`,
                transform: 'translateY(-50%)'
              }}
              title="Jump to message"
            />
          ))}
        </div>

        <motion.div
          drag="y"
          dragMomentum={false}
          onDrag={handleDrag}
          onDragEnd={() => { isDragging.current = false; }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseUp={handleTouchEnd}
          className="pointer-events-auto absolute right-[9px] w-[6px] h-10 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.3)] cursor-grab active:cursor-grabbing z-10"
          style={{
            top: `calc(80px + ${scrollPercentage * (window.innerHeight - 200)}px)`
          }}
        />
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed right-10 top-0 bottom-0 w-64 bg-black/80 backdrop-blur-2xl border-l border-white/10 z-[110] p-4 flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-white/30 uppercase tracking-widest">Index</h3>
              <button onClick={() => setIsOpen(false)} className="text-white/40">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar">
              {userMessages.length === 0 ? (
                <div className="text-sm text-white/20 text-center py-8 italic">No topics yet</div>
              ) : (
                userMessages.map((msg, idx) => (
                  <button
                    key={msg.id}
                    onClick={() => {
                      onJump(msg.id);
                      setIsOpen(false);
                    }}
                    className="w-full text-left p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-accent/20 hover:border-accent/30 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-[10px] font-mono text-white/20 mt-1">{(idx + 1).toString().padStart(2, '0')}</span>
                      <div className="text-sm text-white/70 line-clamp-2 group-hover:text-white transition-colors">
                        {msg.content || "Image attachment"}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isOpen && (
        <div
          className="fixed inset-0 z-[105]"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

// --- Main App ---

// Helper to get stored value from localStorage
const getStoredValue = (key: string, defaultValue: string): string => {
  try {
    return localStorage.getItem(key) || defaultValue;
  } catch {
    return defaultValue;
  }
};

// Default WebSocket URL - change this to your tunnel URL
const DEFAULT_WS_URL = 'wss://acropetal-nonfalteringly-ruben.ngrok-free.dev';
const DEFAULT_TOKEN = 'test123';

export default function App() {
  // WebSocket state
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => getStoredValue('coderemote_url', DEFAULT_WS_URL));
  const [token, setToken] = useState(() => getStoredValue('coderemote_token', DEFAULT_TOKEN));
  const [showSettings, setShowSettings] = useState(false);
  const showSettingsRef = useRef(showSettings);
  showSettingsRef.current = showSettings;

  // 点击外部关闭设置面板
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 使用 ref 获取最新值，避免闭包问题
      // 排除设置面板和设置图标按钮本身
      if (showSettingsRef.current && !target.closest('.settings-panel') && !target.closest('.settings-toggle-btn')) {
        setShowSettings(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Refs for WebSocket callback to access latest state
  const currentSessionIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRefreshingRef = useRef(false);
  const runningSessionsRef = useRef<Set<string>>(new Set()); // Track running sessions in ref for WebSocket callbacks

  // Chat state - start empty, will be populated from server
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set()); // Track running sessions by ID
  const [runningSessionsInfo, setRunningSessionsInfo] = useState<Map<string, { title: string; projectId?: string }>>(new Map()); // Store session info
  const [completedSessions, setCompletedSessions] = useState<Set<string>>(new Set()); // Track completed sessions (for notification)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep runningSessionsRef in sync with runningSessions
  useEffect(() => {
    runningSessionsRef.current = runningSessions;
  }, [runningSessions]);

  // Debug: log runningSessions changes
  useEffect(() => {
    console.log('[RunningSessions] State changed:', Array.from(runningSessions));
  }, [runningSessions]);

  // Debug: log completedSessions changes
  useEffect(() => {
    console.log('[CompletedSessions] State changed:', Array.from(completedSessions));
  }, [completedSessions]);

  // Current session is generating only if it's in the running set
  const isGenerating = currentSessionId ? runningSessions.has(currentSessionId) : false;

  // Server logs state
  const [serverLogs, setServerLogs] = useState<Array<{ level: string; message: string; timestamp: number }>>([]);

  // Multi-project History state
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectSessions, setProjectSessions] = useState<Record<string, ChatSession[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(new Set());
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  // Pagination state for message loading
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);

  // Discussion state - 将讨论消息添加到主聊天
  const addMessageToChat = useCallback((message: Message) => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;

    // 添加到 sessions
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s
    ));

    // 添加到 projectSessions
    if (currentProjectId) {
      setProjectSessions(prev => {
        const projectList = prev[currentProjectId];
        if (!projectList) return prev;
        return {
          ...prev,
          [currentProjectId]: projectList.map(s =>
            s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s
          )
        };
      });
    }
  }, [currentProjectId]);

  const discussion = useDiscussion({
    ws,
    onAddMessage: addMessageToChat,
    onComplete: (result) => {
      console.log('[Discussion] Complete:', result.conclusion?.substring(0, 100));
      // 从运行中会话集合中移除讨论会话
      setRunningSessions(prev => {
        const next = new Set(prev);
        // 移除所有 discussion_ 开头的会话
        for (const id of next) {
          if (id.startsWith('discussion_')) {
            next.delete(id);
          }
        }
        return next;
      });
      // 同时清理 runningSessionsRef
      runningSessionsRef.current = new Set(Array.from(runningSessionsRef.current).filter(id => !id.startsWith('discussion_')));
    },
    onError: (error) => {
      console.error('[Discussion] Error:', error);
      // 从运行中会话集合中移除讨论会话
      setRunningSessions(prev => {
        const next = new Set(prev);
        for (const id of next) {
          if (id.startsWith('discussion_')) {
            next.delete(id);
          }
        }
        return next;
      });
      // 同时清理 runningSessionsRef
      runningSessionsRef.current = new Set(Array.from(runningSessionsRef.current).filter(id => !id.startsWith('discussion_')));
    },
    onSendToMainSession: (summary, rawResult) => {
      // 讨论结束后，将结果发送到主会话（Claude）
      console.log('[Discussion] Sending to main session, summary length:', summary.length);
      // 延迟发送，确保讨论消息已经显示完成
      setTimeout(() => {
        // 自动发送总结到主会话，让 Claude 可以参与互动
        const summaryMessage = `请基于以下多智能体讨论结果，帮我进行分析和互动：\n\n${summary}`;
        handleSend(summaryMessage, []);
      }, 500);
    },
    onCreateHostSession: (title, fullRecord) => {
      // 创建主持人会话保存完整讨论记录
      console.log('[Discussion] onCreateHostSession called');
      console.log('[Discussion]   title:', title);
      console.log('[Discussion]   wsRef.current:', !!wsRef.current);
      console.log('[Discussion]   wsRef.current.readyState:', wsRef.current?.readyState);
      console.log('[Discussion]   isConnected:', isConnected);
      // 保存讨论记录到 pendingHostSessionRef
      pendingHostSessionRef.current = { title, fullRecord };
      console.log('[Discussion]   pendingHostSessionRef.current set');

      if (wsRef.current && isConnected) {
        // WebSocket 已连接，直接创建新会话
        console.log('[Discussion] WebSocket connected, creating new session');
        wsRef.current.send(JSON.stringify({ type: 'session', action: 'new', title }));
      } else {
        // WebSocket 未连接，等待连接后发送
        console.log('[Discussion] WebSocket not connected, will send after connection');
        // 等待 WebSocket 连接，然后发送
        const checkAndSend = () => {
          if (wsRef.current && isConnected) {
            console.log('[Discussion] WebSocket now connected, creating new session');
            wsRef.current.send(JSON.stringify({ type: 'session', action: 'new', title }));
          } else {
            // 继续等待，最多 5 秒
            setTimeout(checkAndSend, 100);
          }
        };
        setTimeout(checkAndSend, 100);
      }
    }
  });

  // Check for @ mentions in input to trigger discussion
  // Only trigger if the @mention matches a valid agent name
  const checkForDiscussion = useCallback((text: string): boolean => {
    const mentionRegex = /@([^\s@]+)/g;
    const mentions = text.match(mentionRegex);

    if (!mentions || mentions.length === 0) {
      return false;
    }

    // Valid agent names (must match backend BUILTIN_TEMPLATES)
    const validAgents = [
      '@代码审查', '@code-reviewer', 'codereviewer',
      '@架构师', '@architect', 'architect',
      '@测试专家', '@tester', 'tester',
      '@安全专家', '@security', 'security',
      '@性能专家', '@performance', 'performance',
      '@产品经理', '@product', 'product',
      '@运维专家', '@devops', 'devops'
    ];

    // Check if any mention matches a valid agent
    const hasValidMention = mentions.some(mention => {
      const name = mention.substring(1).toLowerCase(); // Remove @ and normalize
      return validAgents.some(valid => {
        const validName = valid.startsWith('@') ? valid.substring(1).toLowerCase() : valid.toLowerCase();
        return name === validName ||
               name === validName.replace(/-/g, '') || // code-reviewer -> codereviewer
               validName.includes(name);
      });
    });

    console.log('[checkForDiscussion] text:', text?.substring(0, 50), 'mentions:', mentions, 'hasValidMention:', hasValidMention);
    return hasValidMention;
  }, []);

  // Find current session from either sessions or projectSessions
  const currentSession = useMemo(() => {
    // First try to find in current project sessions
    let session = sessions.find(s => s.id === currentSessionId);
    if (session) return session;

    // Then search in all project sessions
    if (currentProjectId && projectSessions[currentProjectId]) {
      session = projectSessions[currentProjectId].find(s => s.id === currentSessionId);
      if (session) return session;
    }

    // Finally search in all projects
    for (const projectId of Object.keys(projectSessions)) {
      session = projectSessions[projectId].find(s => s.id === currentSessionId);
      if (session) return session;
    }

    return null;
  }, [sessions, currentSessionId, currentProjectId, projectSessions]);

  const messages = currentSession?.messages || [];

  // Handle keyboard for mobile - scroll to bottom when input is focused
  const handleInputFocus = useCallback(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 300);
    }
  }, [messages.length]);

  // Track messages length with ref to avoid stale closure
  const messagesLengthRef = useRef(0);
  messagesLengthRef.current = messages.length;

  // Load more messages (pagination)
  const loadMoreMessages = useCallback(() => {
    if (!ws || !currentSessionId || !hasMoreMessages || isLoadingMoreRef.current) {
      return;
    }

    // Use ref to get the latest messages length
    const beforeIndex = messagesLengthRef.current;

    ws.send(JSON.stringify({
      type: 'session',
      action: 'load_more',
      sessionId: currentSessionId,
      projectId: currentProjectId || undefined,
      limit: 20,
      beforeIndex
    }));

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
  }, [ws, currentSessionId, currentProjectId, hasMoreMessages, totalMessages]);

  // Handle scroll to detect when user scrolls to top
  // 使用防抖来防止滚动事件触发太频繁
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // 清除之前的定时器
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // 设置新的定时器，300ms 后才触发加载
    scrollTimeoutRef.current = setTimeout(() => {
      const target = e.target as HTMLDivElement;
      const { scrollTop } = target;

      // 当滚动到顶部附近时（100px内），加载更多消息
      if (scrollTop < 100 && hasMoreMessages && !isLoadingMoreRef.current) {
        loadMoreMessages();
      }
    }, 300);
  }, [hasMoreMessages]);

  // Sync currentSessionId ref
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // WebSocket connection
  const connect = useCallback(() => {
    if (ws) {
      ws.close();
    }

    setIsConnecting(true);
    const newWs = new WebSocket(serverUrl);

    newWs.onopen = () => {
      console.log('WebSocket connected');
      newWs.send(JSON.stringify({ type: 'auth', token }));
    };

    newWs.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        console.log('Received:', msg.type, msg);

        // Use message's sessionId if available, otherwise fallback to active session
        // This ensures messages go to the correct session even when running in background
        const targetSessionId = msg.sessionId || currentSessionIdRef.current;

        if (msg.type === 'auth_success') {
          setIsConnected(true);
          setIsConnecting(false);
          setShowSettings(false); // Auto-close settings panel on success
          console.log('Auth successful');
          // Save connection settings to localStorage
          try {
            localStorage.setItem('coderemote_url', serverUrl);
            localStorage.setItem('coderemote_token', token);
          } catch (e) {
            console.warn('Failed to save settings:', e);
          }
          // Request project list from server
          newWs.send(JSON.stringify({ type: 'session', action: 'list_projects' }));
        } else if (msg.type === 'ping') {
          // Respond to server heartbeat ping
          newWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        } else if (msg.type === 'auth_failed') {
          setIsConnected(false);
          setIsConnecting(false);
          console.error('Auth failed');
          newWs.close();
        } else if (msg.type === 'running_sessions') {
          // 重连时收到所有运行中会话的信息
          console.log('Running sessions on server:', msg.sessions);
          if (msg.sessions && Array.isArray(msg.sessions)) {
            const newRunningSet = new Set<string>();
            const newInfoMap = new Map<string, { title: string; projectId?: string }>();

            msg.sessions.forEach((s: { sessionId: string; title: string; projectId?: string }) => {
              newRunningSet.add(s.sessionId);
              newInfoMap.set(s.sessionId, { title: s.title, projectId: s.projectId });
            });

            setRunningSessions(newRunningSet);
            setRunningSessionsInfo(newInfoMap);

            // 如果有运行中的会话，自动切换到第一个
            if (msg.sessions.length > 0) {
              const firstSession = msg.sessions[0];
              setCurrentSessionId(firstSession.sessionId);
              currentSessionIdRef.current = firstSession.sessionId;
              console.log('Reconnected to running session:', firstSession.sessionId);
            }
          }
        } else if (msg.type === 'session_running') {
          // 兼容旧格式：单个运行中会话
          console.log('Session running on server:', msg.sessionId);
          if (msg.sessionId) {
            setCurrentSessionId(msg.sessionId);
            currentSessionIdRef.current = msg.sessionId;
            setRunningSessions(prev => new Set(prev).add(msg.sessionId));
            if (msg.title) {
              setRunningSessionsInfo(prev => {
                const next = new Map(prev);
                next.set(msg.sessionId, { title: msg.title, projectId: msg.projectId });
                return next;
              });
            }
            console.log('Reconnected to running session:', msg.sessionId);
          }
        } else if (msg.type === 'discussion_running') {
          // 重连时发现有运行中的讨论
          console.log('Discussion running on server:', msg.discussionId);
          if (msg.discussionId) {
            const discussionSessionId = `discussion_${msg.discussionId}`;
            setRunningSessions(prev => new Set(prev).add(discussionSessionId));

            // 如果当前没有选中会话，创建一个临时会话来接收讨论消息
            if (!currentSessionIdRef.current) {
              const tempSessionId = `discussion_${msg.discussionId}`;
              const tempSession: ChatSession = {
                id: tempSessionId,
                title: '🎯 多智能体讨论进行中...',
                messages: [],
                createdAt: Date.now()
              };
              setSessions(prev => [tempSession, ...prev]);
              setCurrentSessionId(tempSessionId);
              currentSessionIdRef.current = tempSessionId;
              console.log('[Discussion] Created temp session for running discussion:', tempSessionId);
            }

            // 恢复讨论状态
            discussion.restoreRunning(msg.discussionId);
            console.log('Reconnected to running discussion:', msg.discussionId);
          }
        } else if (msg.type === 'claude_start') {
          // Claude is starting to respond
          console.log('Claude started responding');
        } else if (msg.type === 'claude_tool') {
          // Handle tool use events
          console.log('Tool use:', msg.toolName);
          setSessions(prev => {
            const sessionId = targetSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const messages = s.messages;
              const lastMsg = messages[messages.length - 1];

              if (lastMsg && lastMsg.role === 'model') {
                const toolEvent = {
                  toolName: msg.toolName,
                  toolInput: msg.toolInput,
                  toolUseId: msg.toolUseId,
                  timestamp: Date.now()
                };
                const existingTools = lastMsg.tools || [];
                return {
                  ...s,
                  messages: [...messages.slice(0, -1), {
                    ...lastMsg,
                    tools: [...existingTools, toolEvent]
                  }]
                };
              }
              return s;
            });
          });
        } else if (msg.type === 'claude_stream') {
          console.log('Stream chunk, sessionId:', targetSessionId, 'replace:', msg.replace, 'done:', msg.done);

          // 更新 sessions 状态
          setSessions(prev => {
            const sessionId = targetSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const messages = s.messages;
              const lastMsg = messages[messages.length - 1];

              // 如果有内容需要处理
              if (msg.content || msg.thinking) {
                // 检查是否需要创建新的 model 消息
                if (!lastMsg || lastMsg.role !== 'model') {
                  // 创建新的 model 消息
                  const newMsg: Message = {
                    id: Date.now().toString(),
                    role: 'model',
                    content: msg.content || '',
                    thinking: msg.thinking || '',
                    timestamp: Date.now(),
                    status: msg.done ? 'sent' : 'sending'
                  };
                  return { ...s, messages: [...messages, newMsg] };
                } else {
                  // 更新现有的 model 消息
                  const updatedMsg = { ...lastMsg };
                  if (msg.replace) {
                    if (msg.content) updatedMsg.content = msg.content;
                    if (msg.thinking) updatedMsg.thinking = msg.thinking;
                  } else {
                    if (msg.content) updatedMsg.content = (updatedMsg.content || '') + msg.content;
                    if (msg.thinking) updatedMsg.thinking = (updatedMsg.thinking || '') + msg.thinking;
                  }
                  if (msg.done) updatedMsg.status = 'sent';
                  return { ...s, messages: [...messages.slice(0, -1), updatedMsg] };
                }
              }
              return s;
            });
          });

          // 如果 done 为 true，更新运行状态和 projectSessions
          if (msg.done) {
            const sessionId = targetSessionId;
            if (sessionId) {
              console.log('[RunningSessions] Stream done, removing session:', sessionId);
              setRunningSessions(prev => {
                const next = new Set(prev);
                next.delete(sessionId);
                return next;
              });
              // 同时清除运行中会话的信息
              setRunningSessionsInfo(prev => {
                const next = new Map(prev);
                next.delete(sessionId);
                return next;
              });
              // 标记为已完成
              setCompletedSessions(prev => new Set(prev).add(sessionId));

              // 更新 projectSessions（只在完成时更新，减少高频重渲染）
              setProjectSessions(prev => {
                for (const projectId of Object.keys(prev)) {
                  const projectSessionList = prev[projectId];
                  const session = projectSessionList.find(s => s.id === sessionId);
                  if (session) {
                    return {
                      ...prev,
                      [projectId]: projectSessionList.map(s => {
                        if (s.id !== sessionId) return s;
                        // 消息内容会通过 sessions 状态同步，这里只标记状态
                        return { ...s };
                      })
                    };
                  }
                }
                return prev;
              });
            }
          }
        } else if (msg.type === 'claude_done' || msg.done) {
          console.log('Claude done, sessionId:', targetSessionId);
          // Mark this session as done
          const doneSessionId = targetSessionId;
          if (doneSessionId) {
            console.log('[RunningSessions] Removing session:', doneSessionId);
            setRunningSessions(prev => {
              console.log('[RunningSessions] Before:', Array.from(prev));
              const next = new Set(prev);
              next.delete(doneSessionId);
              console.log('[RunningSessions] After:', Array.from(next));
              return next;
            });
            // 同时清除运行中会话的信息
            setRunningSessionsInfo(prev => {
              const next = new Map(prev);
              next.delete(doneSessionId);
              return next;
            });
            // Mark as completed for notification
            setCompletedSessions(prev => new Set(prev).add(doneSessionId));
          } else {
            console.warn('[RunningSessions] No sessionId in claude_done message!');
          }
          // Clear logs when done
          setServerLogs([]);
          setSessions(prev => {
            const sessionId = doneSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const messages = s.messages;
              const lastMsg = messages[messages.length - 1];

              if (lastMsg && lastMsg.role === 'model') {
                return { ...s, messages: [...messages.slice(0, -1), { ...lastMsg, status: 'sent' }] };
              }
              return s;
            });
          });
        } else if (msg.type === 'claude_log') {
          // Handle server log messages
          console.log('Server log:', msg.level, msg.message);
          setServerLogs(prev => [...prev, {
            level: msg.level || 'info',
            message: msg.message || '',
            timestamp: msg.timestamp || Date.now()
          }]);
        } else if (msg.type === 'claude_error') {
          console.log('Claude error:', msg.error);
          // Mark this session as done (error)
          const errorSessionId = targetSessionId;
          if (errorSessionId) {
            setRunningSessions(prev => {
              const next = new Set(prev);
              next.delete(errorSessionId);
              return next;
            });
          }
          // Clear logs when done
          setServerLogs([]);
          setSessions(prev => {
            const sessionId = errorSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const messages = s.messages;
              const lastMsg = messages[messages.length - 1];

              if (lastMsg && lastMsg.role === 'model') {
                return { ...s, messages: [...messages.slice(0, -1), {
                  ...lastMsg,
                  content: `Error: ${msg.error || 'Unknown error'}`,
                  status: 'error'
                }] };
              }
              return s;
            });
          });
        } else if (msg.type === 'command_result') {
          console.log('Command result:', msg.command);
          // Handle command results
          const cmdSessionId = targetSessionId;
          setSessions(prev => {
            const sessionId = cmdSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const messages = s.messages;
              const lastMsg = messages[messages.length - 1];

              if (lastMsg && lastMsg.role === 'model') {
                let content = '';
                if (msg.command === 'ls' && msg.data?.items) {
                  content = '📁 ' + (msg.data.path || '.') + '\n\n';
                  msg.data.items.forEach((item: any) => {
                    const icon = item.type === 'dir' ? '📁' : '📄';
                    content += `${icon} ${item.name}\n`;
                  });
                } else if (msg.command === 'read' && msg.data?.content) {
                  content = '📄 ' + msg.data.path + '\n\n```\n' + msg.data.content + '\n```';
                } else if (msg.command === 'glob') {
                  content = '🔍 Found ' + (msg.data?.length || 0) + ' files:\n\n';
                  msg.data?.forEach((file: string) => {
                    content += `📄 ${file}\n`;
                  });
                } else if (msg.command === 'help') {
                  content = msg.data || '';
                } else {
                  content = '```json\n' + JSON.stringify(msg.data, null, 2) + '\n```';
                }

                return { ...s, messages: [...messages.slice(0, -1), { ...lastMsg, content, status: 'sent' }] };
              }
              return s;
            });
          });
          // Mark session as done after command result
          if (cmdSessionId) {
            setRunningSessions(prev => {
              const next = new Set(prev);
              next.delete(cmdSessionId);
              return next;
            });
          }
        } else if (msg.type === 'stopped') {
          // Handle stop response from server
          console.log('Session stopped:', msg.sessionId, 'success:', msg.success);
          if (msg.sessionId) {
            setRunningSessions(prev => {
              const next = new Set(prev);
              next.delete(msg.sessionId);
              return next;
            });
          }
        } else if (msg.type === 'project_list') {
          // Handle project list from server
          console.log('Received project list:', msg.projects);
          if (msg.projects && msg.projects.length > 0) {
            setProjects(msg.projects);
            setLoadingProjects(new Set());
            // Auto-expand the first (most recent) project to show sessions
            const firstProject = msg.projects[0];
            setExpandedProjects(prev => new Set(prev).add(firstProject.id));
            setLoadingProjects(prev => new Set(prev).add(firstProject.id));
            newWs.send(JSON.stringify({ type: 'session', action: 'list_by_project', projectId: firstProject.id }));
          }
        } else if (msg.type === 'session_list') {
          // Handle session list from server
          console.log('Received session list:', msg.sessions, 'projectId:', msg.projectId);
          if (msg.projectId) {
            // Sessions for a specific project
            setLoadingProjects(prev => {
              const newSet = new Set(prev);
              newSet.delete(msg.projectId!);
              return newSet;
            });
            if (msg.sessions && msg.sessions.length > 0) {
              const serverSessions: ChatSession[] = msg.sessions.map(s => ({
                id: s.id,
                title: s.summary || s.title || 'Untitled',
                messages: [],
                createdAt: s.createdAt || Date.now()
              }));
              setProjectSessions(prev => ({
                ...prev,
                [msg.projectId!]: serverSessions
              }));
            } else {
              setProjectSessions(prev => ({
                ...prev,
                [msg.projectId!]: []
              }));
            }
          } else if (msg.sessions && msg.sessions.length > 0) {
            // Legacy: current project sessions (no projectId)
            const serverSessions: ChatSession[] = msg.sessions.map(s => ({
              id: s.id,
              title: s.title,
              messages: [],
              createdAt: s.createdAt
            }));
            setSessions(serverSessions);

            // Only auto-resume on initial connection, not on refresh
            if (!isRefreshingRef.current) {
              const latestSessionId = msg.sessions[0].id;
              setCurrentSessionId(latestSessionId);
              currentSessionIdRef.current = latestSessionId;
              // Request to resume latest session to get messages
              newWs.send(JSON.stringify({ type: 'session', action: 'resume', sessionId: latestSessionId }));
            } else {
              isRefreshingRef.current = false;
            }
          } else {
            // No sessions, create a new one (only on initial connection)
            if (!isRefreshingRef.current) {
              newWs.send(JSON.stringify({ type: 'session', action: 'new' }));
            } else {
              setSessions([]);
              isRefreshingRef.current = false;
            }
          }
        } else if (msg.type === 'session_created') {
          // Handle new session creation
          console.log('Session created:', msg.session);
          console.log('[session_created] pendingHostSessionRef.current:', pendingHostSessionRef.current ? 'HAS VALUE' : 'NULL');
          if (msg.session) {
            const newSession: ChatSession = {
              id: msg.session.id,
              title: msg.session.title || 'New Chat',
              messages: [],
              createdAt: msg.session.createdAt || Date.now()
            };

            // Determine which project this session belongs to
            // If we have a current project, add to that project's sessions
            const targetProjectId = currentProjectId || (projects.length > 0 ? projects[0].id : null);
            console.log('[session_created] targetProjectId:', targetProjectId, 'currentProjectId:', currentProjectId);

            setSessions(prev => {
              // Avoid duplicate sessions
              const exists = prev.find(s => s.id === newSession.id);
              if (exists) return prev;
              return [newSession, ...prev];
            });

            // Also add to projectSessions if we have a project
            if (targetProjectId) {
              setProjectSessions(prev => {
                const projectList = prev[targetProjectId] || [];
                const exists = projectList.find(s => s.id === newSession.id);
                if (exists) return prev;
                return {
                  ...prev,
                  [targetProjectId]: [newSession, ...projectList]
                };
              });
            }

            setCurrentSessionId(newSession.id);
            currentSessionIdRef.current = newSession.id;
            // Clear projectId when creating new session (always in current project)
            setCurrentProjectId(null);

            // 通知后端切换活跃会话（用于后台会话优化）
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'session_focus',
                sessionId: newSession.id
              }));
            }

            // If there's a pending host session (discussion record), send it now
            if (pendingHostSessionRef.current) {
              const pendingHost = pendingHostSessionRef.current;
              pendingHostSessionRef.current = null;
              console.log('[Discussion] Sending discussion record to new host session');
              // Small delay to ensure state is updated
              setTimeout(() => {
                handleSend(pendingHost.fullRecord, []);
              }, 100);
            }
            // If there's a pending message, send it now
            else if (pendingMessageRef.current) {
              const pending = pendingMessageRef.current;
              pendingMessageRef.current = null;
              // Small delay to ensure state is updated
              setTimeout(() => {
                handleSend(pending.text, pending.attachments);
              }, 50);
            }
          }
        } else if (msg.type === 'session_resumed') {
          // Handle session resumed with messages
          console.log('Session resumed:', msg.session, 'projectId:', msg.projectId, 'hasMore:', msg.hasMore, 'totalMessages:', msg.totalMessages);
          if (msg.session) {
            const resumedSession: ChatSession = {
              id: msg.session.id,
              title: msg.session.summary || msg.session.title || 'Untitled',
              messages: msg.session.messages || [],
              createdAt: msg.session.createdAt || Date.now()
            };

            // Update pagination state
            setHasMoreMessages(msg.hasMore || false);
            setTotalMessages(msg.totalMessages || msg.session.messages?.length || 0);

            // Check if this session is currently running (use ref for latest value)
            const isSessionRunning = runningSessionsRef.current.has(resumedSession.id);
            console.log('[session_resumed] Session:', resumedSession.id.substring(0, 12), 'isRunning:', isSessionRunning);

            // Update sessions, but preserve any in-progress messages for running sessions
            setSessions(prev => {
              const exists = prev.find(s => s.id === resumedSession.id);
              if (exists) {
                // Check if this session is currently running (has a model message with status 'sending')
                const lastMsg = exists.messages[exists.messages.length - 1];
                const hasRunningModel = lastMsg && lastMsg.role === 'model' && lastMsg.status === 'sending';

                // If session is running and has content, preserve the running state
                // Don't replace with server data which may be stale
                if (isSessionRunning && hasRunningModel) {
                  console.log('[session_resumed] Preserving running session messages, server messages will be merged via stream');
                  // Keep existing messages, don't replace
                  return prev;
                }

                // Not running, just replace with server data
                return prev.map(s => s.id === resumedSession.id ? resumedSession : s);
              }
              return [resumedSession, ...prev];
            });

            // Also update projectSessions if projectId exists
            if (msg.projectId) {
              setProjectSessions(prev => {
                const projectSessionList = prev[msg.projectId!] || [];
                const exists = projectSessionList.find(s => s.id === resumedSession.id);
                if (exists) {
                  // Similar logic for projectSessions
                  const lastMsg = exists.messages[exists.messages.length - 1];
                  const hasRunningModel = lastMsg && lastMsg.role === 'model' && lastMsg.status === 'sending';

                  if (isSessionRunning && hasRunningModel) {
                    console.log('[session_resumed] Preserving running projectSession messages');
                    return prev;
                  }

                  return {
                    ...prev,
                    [msg.projectId!]: projectSessionList.map(s => s.id === resumedSession.id ? resumedSession : s)
                  };
                }
                return {
                  ...prev,
                  [msg.projectId!]: [resumedSession, ...projectSessionList]
                };
              });
              setCurrentProjectId(msg.projectId);
            } else {
              // Clear projectId when resuming current project session
              setCurrentProjectId(null);
            }
            setCurrentSessionId(resumedSession.id);
            currentSessionIdRef.current = resumedSession.id;

            // 通知后端切换活跃会话（用于后台会话优化）
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'session_focus',
                sessionId: resumedSession.id
              }));
            }

            // Scroll to bottom after loading messages
            setTimeout(() => {
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth'
              });
            }, 100);
          }
        } else if (msg.type === 'session_deleted') {
          // Handle session deletion
          console.log('Session deleted:', msg.sessionId);
          setSessions(prev => prev.filter(s => s.id !== msg.sessionId));
          if (currentSessionIdRef.current === msg.sessionId) {
            setCurrentSessionId(null);
            currentSessionIdRef.current = null;
          }
        } else if (msg.type === 'session_id_updated') {
          // Handle session ID update from server (when Claude CLI returns a new session ID)
          console.log('Session ID updated:', msg.oldSessionId, '->', msg.newSessionId);
          setSessions(prev => prev.map(s => {
            if (s.id === msg.oldSessionId) {
              return { ...s, id: msg.newSessionId, title: msg.title || s.title };
            }
            return s;
          }));
          // Update projectSessions as well
          setProjectSessions(prev => {
            const updated: Record<string, ChatSession[]> = {};
            for (const [projectId, sessions] of Object.entries(prev)) {
              updated[projectId] = sessions.map(s => {
                if (s.id === msg.oldSessionId) {
                  return { ...s, id: msg.newSessionId, title: msg.title || s.title };
                }
                return s;
              });
            }
            return updated;
          });
          // Update runningSessions if the old session was running
          setRunningSessions(prev => {
            if (prev.has(msg.oldSessionId)) {
              const next = new Set(prev);
              next.delete(msg.oldSessionId);
              next.add(msg.newSessionId);
              console.log('[RunningSessions] Updated session ID:', msg.oldSessionId, '->', msg.newSessionId);
              return next;
            }
            return prev;
          });
          // Update completedSessions as well
          setCompletedSessions(prev => {
            if (prev.has(msg.oldSessionId)) {
              const next = new Set(prev);
              next.delete(msg.oldSessionId);
              next.add(msg.newSessionId);
              return next;
            }
            return prev;
          });
          if (currentSessionIdRef.current === msg.oldSessionId) {
            setCurrentSessionId(msg.newSessionId);
            currentSessionIdRef.current = msg.newSessionId;
          }
        } else if (msg.type === 'messages_loaded') {
          // Handle more messages loaded (pagination)
          if (msg.messages && msg.sessionId) {
            // Prepend messages to current session
            setSessions(prev => prev.map(s => {
              if (s.id === msg.sessionId) {
                return {
                  ...s,
                  messages: [...msg.messages, ...s.messages]
                };
              }
              return s;
            }));

            // Also update projectSessions if projectId exists
            if (msg.projectId) {
              setProjectSessions(prev => {
                const projectSessionList = prev[msg.projectId!];
                if (projectSessionList) {
                  return {
                    ...prev,
                    [msg.projectId!]: projectSessionList.map(s => {
                      if (s.id === msg.sessionId) {
                        return {
                          ...s,
                          messages: [...msg.messages, ...s.messages]
                        };
                      }
                      return s;
                    })
                  };
                }
                return prev;
              });
            }

            // Update pagination state
            setHasMoreMessages(msg.hasMore || false);
            setTotalMessages(msg.totalMessages || 0);

            // Keep scroll position after prepending messages
            // Store the current scroll position before updating
            const scrollEl = scrollRef.current;
            if (scrollEl) {
              const oldScrollTop = scrollEl.scrollTop;
              const oldScrollHeight = scrollEl.scrollHeight;
              // Wait for React to render the new messages, then adjust scroll position
              setTimeout(() => {
                const newScrollHeight = scrollEl.scrollHeight;
                const addedHeight = newScrollHeight - oldScrollHeight;
                // Restore scroll position by accounting for the added content height
                scrollEl.scrollTop = oldScrollTop + addedHeight;
              }, 50);
            }
          }
          // Don't reset isLoadingMoreRef here - let it stay true until after the scroll is restored
          setTimeout(() => {
            setIsLoadingMore(false);
            isLoadingMoreRef.current = false;
          }, 100);
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    newWs.onclose = () => {
      setIsConnected(false);
      setIsConnecting(false);
      console.log('WebSocket disconnected');
    };

    newWs.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnecting(false);
      setIsConnected(false);
    };

    wsRef.current = newWs;
    setWs(newWs);
  }, [serverUrl, token]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWs(null);
    }
    setIsConnected(false);
  }, []);

  // Auto-connect on mount if URL and token are available
  useEffect(() => {
    if (serverUrl && token && !isConnected && !isConnecting) {
      console.log('Auto-connecting with saved settings...');
      connect();
    }
  }, []); // Only run once on mount

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    // Skip auto-scroll when loading more messages
    if (isLoadingMoreRef.current) return;
    scrollToBottom();
  }, [messages]);

  // Create new session (on server)
  const createNewSession = () => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({ type: 'session', action: 'new' }));
    }
  };

  // Resume existing session (supports cross-project)
  const resumeSession = (sessionId: string, projectId?: string) => {
    console.log('[resumeSession] Called with sessionId:', sessionId, 'projectId:', projectId, 'isConnected:', isConnected);
    if (wsRef.current && isConnected) {
      const msg: any = { type: 'session', action: 'resume', sessionId };
      if (projectId) {
        msg.projectId = projectId;
      }
      console.log('[resumeSession] Sending resume message:', msg);
      wsRef.current.send(JSON.stringify(msg));

      // 通知后端切换活跃会话（用于后台会话优化）
      wsRef.current.send(JSON.stringify({
        type: 'session_focus',
        sessionId: sessionId
      }));
    } else {
      console.warn('[resumeSession] Cannot resume - WebSocket not connected');
    }
  };

  // Delete session (supports cross-project)
  const deleteSessionById = (sessionId: string, projectId?: string) => {
    if (wsRef.current && isConnected) {
      const msg: any = { type: 'session', action: 'delete', sessionId };
      if (projectId) {
        msg.projectId = projectId;
      }
      wsRef.current.send(JSON.stringify(msg));
      // Remove from local state
      if (projectId) {
        setProjectSessions(prev => ({
          ...prev,
          [projectId]: (prev[projectId] || []).filter(s => s.id !== sessionId)
        }));
        // Update project session count
        setProjects(prev => prev.map(p =>
          p.id === projectId ? { ...p, sessionCount: Math.max(0, p.sessionCount - 1) } : p
        ));
      }
    }
  };

  // Refresh session list from server (legacy)
  const refreshSessions = () => {
    if (wsRef.current && isConnected) {
      isRefreshingRef.current = true;
      wsRef.current.send(JSON.stringify({ type: 'session', action: 'list' }));
    }
  };

  // Load all projects (with optional force refresh)
  const loadProjects = (forceRefresh: boolean = false) => {
    if (wsRef.current && isConnected) {
      if (forceRefresh) {
        setProjectSessions({});
      }
      wsRef.current.send(JSON.stringify({ type: 'session', action: 'list_projects' }));
    }
  };

  // Toggle project expansion and load sessions if needed
  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
        return newSet;
      }
      newSet.add(projectId);
      // Load sessions for this project if not loaded
      if (!projectSessions[projectId] && wsRef.current && isConnected) {
        setLoadingProjects(prev => new Set(prev).add(projectId));
        wsRef.current.send(JSON.stringify({ type: 'session', action: 'list_by_project', projectId }));
      }
      return newSet;
    });
  };

  // Delete a session
  // Store pending message when waiting for session creation
  const pendingMessageRef = useRef<{ text: string; attachments: Attachment[] } | null>(null);

  // Store pending host session message (for discussion records)
  const pendingHostSessionRef = useRef<{ title: string; fullRecord: string } | null>(null);

  // Send message
  const handleSend = async (text: string, attachments: Attachment[]) => {
    console.log('[handleSend] called with text:', text?.substring(0, 30));
    console.log('[handleSend] text length:', text?.length);
    console.log('[handleSend] full text:', text);
    console.log('[CLIENT-DEBUG] raw text:', JSON.stringify(text));
    console.log('[handleSend] currentSessionIdRef.current:', currentSessionIdRef.current);
    console.log('[handleSend] currentProjectId:', currentProjectId);
    console.log('[handleSend] sessions.length:', sessions.length);
    console.log('[handleSend] sessions[0]?.id:', sessions[0]?.id);

    if (!text.trim() && attachments.length === 0) return;

    // Use wsRef for latest connection
    const activeWs = wsRef.current;
    if (!activeWs || !isConnected) {
      console.log('Not connected, ws:', activeWs, 'isConnected:', isConnected);
      return;
    }

    // Check for @ mentions - trigger discussion mode
    if (checkForDiscussion(text)) {
      console.log('[handleSend] Detected @ mentions, starting discussion...');

      // 如果没有当前 session，先创建一个
      if (!currentSessionIdRef.current) {
        console.log('[handleSend] No current session for discussion, creating one...');
        pendingMessageRef.current = { text, attachments: [] };
        activeWs.send(JSON.stringify({ type: 'session', action: 'new' }));
        // session 创建后会重新触发 handleSend（通过 pendingMessageRef）
        // 但这次我们需要特殊处理，所以存储一个标记
        return;
      }

      const sessionId = currentSessionIdRef.current;

      // 先添加用户消息到聊天
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        status: 'sent'
      };

      // 更新 sessions
      setSessions(prev => {
        const sessionExists = prev.find(s => s.id === sessionId);
        if (sessionExists) {
          return prev.map(s =>
            s.id === sessionId ? { ...s, messages: [...s.messages, userMessage] } : s
          );
        }
        return [{
          id: sessionId,
          title: text.substring(0, 30),
          messages: [userMessage],
          createdAt: Date.now()
        }, ...prev];
      });

      // 更新 projectSessions
      if (currentProjectId) {
        setProjectSessions(prev => {
          const projectList = prev[currentProjectId] || [];
          const sessionExists = projectList.find(s => s.id === sessionId);
          if (sessionExists) {
            return {
              ...prev,
              [currentProjectId]: projectList.map(s =>
                s.id === sessionId ? { ...s, messages: [...s.messages, userMessage] } : s
              )
            };
          }
          return {
            ...prev,
            [currentProjectId]: [{
              id: sessionId,
              title: text.substring(0, 30),
              messages: [userMessage],
              createdAt: Date.now()
            }, ...projectList]
          };
        });
      }

      // 滚动到底部
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);

      // 启动讨论
      discussion.startDiscussion(text, { maxRounds: 3 });
      return;
    }

    // If no current session, create one first and queue the message
    if (!currentSessionIdRef.current) {
      console.log('No current session, creating one...');
      pendingMessageRef.current = { text, attachments };
      activeWs.send(JSON.stringify({ type: 'session', action: 'new' }));
      return;
    }

    const sessionId = currentSessionIdRef.current;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments,
      status: 'sent'
    };

    const aiMessageId = Math.random().toString(36).substring(7);
    const aiMessage: Message = {
      id: aiMessageId,
      role: 'model',
      content: '',
      timestamp: Date.now(),
      status: 'sending'
    };

    // Always update both sessions and projectSessions to ensure UI shows the message
    // Update sessions
    setSessions(prev => {
      const sessionExists = prev.find(s => s.id === sessionId);
      if (sessionExists) {
        return prev.map(s =>
          s.id === sessionId ? { ...s, messages: [...s.messages, userMessage, aiMessage] } : s
        );
      }
      // Create new session with messages
      return [{
        id: sessionId,
        title: text.substring(0, 30),
        messages: [userMessage, aiMessage],
        createdAt: Date.now()
      }, ...prev];
    });

    // Also update projectSessions if projectId exists
    if (currentProjectId) {
      setProjectSessions(prev => {
        const projectList = prev[currentProjectId] || [];
        const sessionExists = projectList.find(s => s.id === sessionId);
        if (sessionExists) {
          return {
            ...prev,
            [currentProjectId]: projectList.map(s =>
              s.id === sessionId ? { ...s, messages: [...s.messages, userMessage, aiMessage] } : s
            )
          };
        }
        // Create new session in project
        return {
          ...prev,
          [currentProjectId]: [{
            id: sessionId,
            title: text.substring(0, 30),
            messages: [userMessage, aiMessage],
            createdAt: Date.now()
          }, ...projectList]
        };
      });
    }
    // Mark this session as running
    console.log('[RunningSessions] Adding session:', sessionId);
    setRunningSessions(prev => {
      console.log('[RunningSessions] Before add:', Array.from(prev));
      const next = new Set(prev).add(sessionId);
      console.log('[RunningSessions] After add:', Array.from(next));
      return next;
    });

    // Also save session info for the running session
    setRunningSessionsInfo(prev => {
      const next = new Map(prev);
      next.set(sessionId, { title: text.substring(0, 30), projectId: currentProjectId || undefined });
      return next;
    });

    console.log('Sending message to WebSocket, sessionId:', sessionId, 'projectId:', currentProjectId);

    // Send to WebSocket with session info
    const message: any = {
      type: 'claude',
      content: text,
      stream: true,
      sessionId,
      timestamp: Date.now()
    };
    // Include attachments (images) if any
    if (attachments.length > 0) {
      message.attachments = attachments.map(att => ({
        id: att.id,
        name: att.name,
        type: att.type,
        data: att.data  // base64 encoded image data
      }));
      console.log('[handleSend] Sending attachments:', attachments.length);
    }
    console.log('[handleSend] Final message:', JSON.stringify(message));
    // Include projectId for cross-project sessions
    if (currentProjectId) {
      message.projectId = currentProjectId;
    }
    activeWs.send(JSON.stringify(message));
  };

  const handleStop = () => {
    const sessionIdToStop = currentSessionIdRef.current;
    // Send stop request to server to kill Claude CLI process
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'stop',
        sessionId: sessionIdToStop,
        timestamp: Date.now()
      }));
      console.log('[handleStop] Sent stop request for session:', sessionIdToStop);
    }
    // Update UI - mark this session as not running
    if (sessionIdToStop) {
      setRunningSessions(prev => {
        const next = new Set(prev);
        next.delete(sessionIdToStop);
        return next;
      });
    }
  };

  const handleNewChat = () => {
    createNewSession();
    setIsSidebarOpen(false);
  };

  const handleTitleChange = (newTitle: string) => {
    if (!currentSessionId) return;
    setSessions(prev => prev.map(s =>
      s.id === currentSessionId ? { ...s, title: newTitle } : s
    ));
  };

  // 发送重命名请求到后端
  const handleTitleBlur = (newTitle: string) => {
    if (!currentSessionId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'session',
      action: 'rename',
      sessionId: currentSessionId,
      title: newTitle,
      projectId: currentProjectId,
      timestamp: Date.now()
    };
    wsRef.current.send(JSON.stringify(message));
    console.log('[handleTitleBlur] Sent rename request:', message);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const jumpToMessage = (id: string) => {
    const element = document.getElementById(`message-${id}`);
    const container = scrollRef.current;
    if (element && container) {
      const targetScroll = element.offsetTop - 74;
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg overflow-hidden relative">
      <Header
        onMenuClick={() => setIsSidebarOpen(true)}
        onNewChat={handleNewChat}
        title={currentSession?.title || 'New Chat'}
        onTitleChange={handleTitleChange}
        onTitleBlur={handleTitleBlur}
        onSettingsClick={() => setShowSettings(!showSettings)}
        isConnected={isConnected}
      />

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden z-[55] settings-panel"
          >
            <ConnectionPanel
              url={serverUrl}
              token={token}
              onUrlChange={setServerUrl}
              onTokenChange={setToken}
              onConnect={connect}
              onDisconnect={disconnect}
              isConnected={isConnected}
              isConnecting={isConnecting}
              wsRef={wsRef}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ScrollIndex messages={messages} onJump={jumpToMessage} scrollRef={scrollRef} />

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-[280px] bg-card border-r border-white/10 z-[70] flex flex-col"
            >
              <div className="p-6 flex items-center justify-between">
                <h2 className="text-xl font-semibold">History</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadProjects(true)}
                    className="text-white/40 hover:text-white transition-colors"
                    title="Refresh projects"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button onClick={() => setIsSidebarOpen(false)} className="text-white/40">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 space-y-2 no-scrollbar">
                {projects.length === 0 ? (
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/60">
                    {isConnected ? 'No projects found' : 'Connect to view history'}
                  </div>
                ) : (
                  projects.map(project => (
                    <div key={project.id} className="space-y-1">
                      {/* Project Header */}
                      <button
                        onClick={() => toggleProject(project.id)}
                        className={cn(
                          "w-full flex items-center gap-2 p-3 rounded-xl transition-colors text-sm",
                          expandedProjects.has(project.id)
                            ? "bg-white/10 text-white"
                            : "bg-white/5 text-white/60 hover:bg-white/10"
                        )}
                      >
                        <Folder size={16} className="text-accent shrink-0" />
                        <span className="flex-1 text-left truncate" title={project.displayName}>
                          {project.displayName}
                        </span>
                        <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">
                          {project.sessionCount}
                        </span>
                        {expandedProjects.has(project.id) ? (
                          <ChevronUp size={14} className="text-white/40" />
                        ) : (
                          <ChevronDown size={14} className="text-white/40" />
                        )}
                      </button>

                      {/* Project Sessions */}
                      {expandedProjects.has(project.id) && (
                        <div className="pl-4 space-y-1">
                          {loadingProjects.has(project.id) ? (
                            <div className="p-3 text-sm text-white/40 text-center">
                              Loading...
                            </div>
                          ) : (
                            (projectSessions[project.id] || []).map(session => {
                              const isRunning = runningSessions.has(session.id);
                              const isCompleted = completedSessions.has(session.id);
                              // Debug: always log for troubleshooting
                              if (runningSessions.size > 0 || completedSessions.size > 0) {
                                console.log('[Sidebar] Checking session:', session.id.substring(0, 12),
                                  'running:', isRunning, 'completed:', isCompleted,
                                  'runningSet:', Array.from(runningSessions).map(id => id.substring(0, 12)));
                              }
                              return (
                              <div
                                key={session.id}
                                className={cn(
                                  "flex items-center gap-2 p-2 rounded-lg transition-colors text-sm",
                                  currentSessionId === session.id && currentProjectId === project.id
                                    ? "bg-accent/30 text-white"
                                    : "bg-white/5 text-white/60 hover:bg-white/10"
                                )}
                              >
                                <button
                                  onClick={() => {
                                    resumeSession(session.id, project.id);
                                    setIsSidebarOpen(false);
                                    // Clear completed status when viewing the session
                                    setCompletedSessions(prev => {
                                      const next = new Set(prev);
                                      next.delete(session.id);
                                      return next;
                                    });
                                  }}
                                  className="flex-1 text-left text-xs min-w-0"
                                >
                                  <div className="flex items-center gap-2">
                                    {isRunning ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-400 flex-shrink-0 whitespace-nowrap animate-pulse">
                                        运行中
                                      </span>
                                    ) : isCompleted ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-green-400 flex-shrink-0 whitespace-nowrap">
                                        完成
                                      </span>
                                    ) : null}
                                    <span className="truncate flex items-center gap-1 min-w-0 flex-1">
                                      <FileText size={12} className="inline opacity-50 flex-shrink-0" />
                                      <span className="truncate">{session.title}</span>
                                    </span>
                                  </div>
                                  <div className="text-white/30 text-[10px] font-mono truncate mt-0.5">
                                    {session.id.substring(0, 8)}...
                                  </div>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSessionById(session.id, project.id);
                                  }}
                                  className="text-white/30 hover:text-red-400 transition-all p-1 touch-manipulation"
                                  title="Delete session"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            );
                            })
                          )}
                          {projectSessions[project.id]?.length === 0 && !loadingProjects.has(project.id) && (
                            <div className="p-2 text-xs text-white/40 text-center">
                              No sessions
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 border-t border-white/5">
                <button
                  onClick={handleNewChat}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-white/10 rounded-xl text-sm font-medium hover:bg-white/20 transition-colors"
                >
                  <Plus size={18} />
                  New Chat
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <main
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto chat-scroll pt-[80px] pb-[120px] no-scrollbar relative"
      >
        {/* Load more indicator */}
        {messages.length > 0 && hasMoreMessages && (
          <div className="flex justify-center py-3">
            <button
              onClick={loadMoreMessages}
              disabled={isLoadingMore}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white/50 hover:text-white/70 transition-colors disabled:opacity-50"
            >
              {isLoadingMore ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <ChevronUp size={16} />
                  <span>Load earlier messages ({totalMessages - messages.length} more)</span>
                </>
              )}
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            {/* 运行中的任务列表 */}
            {runningSessions.size > 0 && (
              <div className="w-full max-w-md mb-6 space-y-2">
                {Array.from(runningSessions).map(sessionId => {
                  // 优先使用 runningSessionsInfo，否则从 sessions/projectSessions 查找
                  const infoFromMap = runningSessionsInfo.get(sessionId);
                  let title = infoFromMap?.title;
                  let projectId = infoFromMap?.projectId;

                  // 如果 infoFromMap 中没有 title 或 projectId，从其他来源查找
                  if (!title || !projectId) {
                    const sessionInfo = sessions.find(s => s.id === sessionId);
                    if (sessionInfo) {
                      if (!title) title = sessionInfo.title;
                    }
                    // 在 projectSessions 中查找 projectId 和 title
                    if (!projectId || !title) {
                      for (const [pid, sessionList] of Object.entries(projectSessions)) {
                        const found = sessionList.find(s => s.id === sessionId);
                        if (found) {
                          if (!title) title = found.title;
                          if (!projectId) projectId = pid;
                          break;
                        }
                      }
                    }
                  }

                  // 最终使用 ID 前缀作为备用标题
                  const displayTitle = title || sessionId.substring(0, 12);

                  return (
                    <motion.div
                      key={sessionId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-3 bg-gradient-to-r from-accent/10 to-purple-500/10 rounded-xl border border-accent/20 cursor-pointer hover:border-accent/40 transition-colors"
                      onClick={() => {
                        console.log('[RunningTaskCard] Clicked session:', sessionId, 'projectId:', projectId);
                        // 恢复会话
                        resumeSession(sessionId, projectId);
                        setIsSidebarOpen(false);
                        // 清除完成状态
                        setCompletedSessions(prev => {
                          const next = new Set(prev);
                          next.delete(sessionId);
                          return next;
                        });
                      }}
                    >
                      <div className="relative">
                        <Loader2 className="w-5 h-5 text-accent animate-spin" />
                        <Sparkles className="w-3 h-3 text-purple-400 absolute -top-1 -right-1 animate-pulse" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium text-white truncate">{displayTitle}</div>
                        <div className="text-xs text-white/50">运行中 · 点击查看</div>
                      </div>
                      <ChevronRight size={16} className="text-white/30" />
                    </motion.div>
                  );
                })}
              </div>
            )}

            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-16 h-16 bg-accent rounded-3xl mb-6 flex items-center justify-center shadow-2xl shadow-accent/20"
            >
              <Folder size={28} className="text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold mb-2">CodeRemote</h1>
            <p className="text-white/40 text-[15px] max-w-[240px]">
              Connect to your development environment and control Claude Code from anywhere.
            </p>
            <div className="mt-6 text-xs text-white/30">
              <div className="flex items-center gap-2 mb-2">
                <Hash size={12} />
                <span>Commands: /read, /ls, /glob, /grep, /help</span>
              </div>
            </div>
          </div>
        ) : (
          messages
            .filter((msg) => {
              // 正在流式传输的消息总是显示（可能有 thinking 但还没有 content）
              if (msg.status === 'sending') return true;

              // 过滤空消息（既没有 content 也没有 thinking）
              const hasContent = msg.content && msg.content.trim() !== '';
              const hasThinking = msg.thinking && msg.thinking.trim() !== '';

              // 检查 content 中是否包含 thinking 标签
              const hasThinkingInContent = msg.content && (
                msg.content.includes('<thinking>') ||
                msg.content.includes('🤔 Thinking...')
              );

              if (!hasContent && !hasThinking && !hasThinkingInContent) return false;

              // 过滤只包含闭合的 thinking 标签的消息（已完成的 thinking）
              const thinkingRegex = /^<thinking>[\s\S]*<\/thinking>\s*$/;
              if (thinkingRegex.test(msg.content?.trim() || '')) return false;

              return true;
            })
            .map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                isStreaming={msg.status === 'sending'}
                onCopy={copyToClipboard}
                onRegenerate={() => {
                  const idx = messages.findIndex(m => m.id === msg.id);
                  if (idx > 0) {
                    const prevUserMsg = messages[idx - 1];
                    if (prevUserMsg.role === 'user') {
                    handleSend(prevUserMsg.content, prevUserMsg.attachments || []);
                  }
                }
              }}
              onOptionClick={(option) => handleSend(option, [])}
            />
          ))
        )}

        {/* Loading indicator when Claude is processing */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col px-4 py-3 mx-4 my-2 bg-gradient-to-r from-accent/10 to-purple-500/10 rounded-xl border border-accent/20"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Loader2 className="w-5 h-5 text-accent animate-spin" />
                  <Sparkles className="w-3 h-3 text-purple-400 absolute -top-1 -right-1 animate-pulse" />
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-medium text-white">Claude 正在处理...</span>
                  {serverLogs.length > 0 && (
                    <span className="text-xs text-white/50 truncate">
                      {serverLogs[serverLogs.length - 1].message}
                    </span>
                  )}
                </div>
              </div>
              {/* Show recent logs - hidden for now, only for debugging */}
              {false && serverLogs.length > 1 && (
                <div className="mt-2 pt-2 border-t border-white/10 max-h-[60px] overflow-y-auto no-scrollbar">
                  {serverLogs.slice(-5).reverse().map((log, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[10px] text-white/40 py-0.5">
                      <span className={cn(
                        "px-1 rounded text-[9px]",
                        log.level === 'error' && "bg-red-500/20 text-red-400",
                        log.level === 'warn' && "bg-yellow-500/20 text-yellow-400",
                        log.level === 'info' && "bg-green-500/20 text-green-400",
                        log.level === 'debug' && "bg-blue-500/20 text-blue-400"
                      )}>
                        {log.level.toUpperCase()}
                      </span>
                      <span className="truncate">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <InputArea
        onSend={handleSend}
        isGenerating={isGenerating}
        onStop={handleStop}
        isConnected={isConnected}
        onFocus={handleInputFocus}
      />
    </div>
  );
}
