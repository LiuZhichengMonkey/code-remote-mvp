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
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, Attachment, ChatSession, ChatOption } from './types';
import { cn } from './utils';

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
    createdAt?: number;
    messageCount?: number;
    messages?: Message[];
  };
  sessions?: Array<{
    id: string;
    title: string;
    createdAt: number;
    messageCount: number;
  }>;
  projects?: ProjectInfo[];
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
  isConnecting
}: {
  url: string;
  token: string;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  isConnected: boolean;
  isConnecting: boolean;
}) => (
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
      <button onClick={onSettingsClick} className="p-2 text-white/70 active:text-white">
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

  let thinkingContent = message.thinking || '';
  let displayContent = message.content;

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

          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
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
                }
              }}
            >
              {displayContent}
            </ReactMarkdown>
            {!isUser && isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-1 bg-accent animate-pulse align-middle" />
            )}
          </div>

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 技能列表
  const skills = [
    { id: 'git-commit', name: 'Git Commit', description: '提交代码并推送到 GitHub', trigger: '/git-workflow' },
    { id: 'create-readme', name: 'Create README', description: '为项目创建 README 文档', trigger: '/create-readme' },
    { id: 'simplify', name: 'Simplify Code', description: '简化并优化代码', trigger: '/simplify' },
    { id: 'brainstorm', name: 'Brainstorm', description: '头脑风暴新功能创意', trigger: '/brainstorming' },
  ];

  // 过滤技能
  const filteredSkills = skillFilter
    ? skills.filter(s => s.name.toLowerCase().includes(skillFilter.toLowerCase()) || s.description.toLowerCase().includes(skillFilter.toLowerCase()))
    : skills;

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // 检测是否输入了 /
    if (value === '/') {
      setShowSkills(true);
      setSkillFilter('');
    } else if (showSkills && value.startsWith('/')) {
      setSkillFilter(value.slice(1));
    } else if (showSkills && !value.startsWith('/')) {
      setShowSkills(false);
      setSkillFilter('');
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

  // 关闭技能弹窗
  const closeSkillsPopup = () => {
    setShowSkills(false);
    setSkillFilter('');
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
              placeholder={isConnected ? "Message... (/ for commands)" : "Connect to start..."}
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

  // Refs for WebSocket callback to access latest state
  const currentSessionIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRefreshingRef = useRef(false);

  // Chat state - start empty, will be populated from server
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

        // Use ref to get latest sessionId
        const activeSessionId = currentSessionIdRef.current;

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
        } else if (msg.type === 'claude_start') {
          // Claude is starting to respond
          console.log('Claude started responding');
        } else if (msg.type === 'claude_tool') {
          // Handle tool use events
          console.log('Tool use:', msg.toolName);
          setSessions(prev => {
            const targetSessionId = activeSessionId || prev[0]?.id;
            if (!targetSessionId) return prev;

            return prev.map(s => {
              if (s.id !== targetSessionId) return s;
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
          console.log('Stream chunk, activeSessionId:', activeSessionId);
          setSessions(prev => {
            const targetSessionId = activeSessionId || prev[0]?.id;
            if (!targetSessionId) return prev;

            return prev.map(s => {
              if (s.id !== targetSessionId) return s;
              const messages = s.messages;
              const lastMsg = messages[messages.length - 1];

              if (lastMsg && lastMsg.role === 'model') {
                const updatedMsg = { ...lastMsg };
                if (msg.content) {
                  updatedMsg.content = (updatedMsg.content || '') + msg.content;
                }
                if (msg.thinking) {
                  updatedMsg.thinking = (updatedMsg.thinking || '') + msg.thinking;
                }
                return { ...s, messages: [...messages.slice(0, -1), updatedMsg] };
              }
              return s;
            });
          });
        } else if (msg.type === 'claude_done' || msg.done) {
          console.log('Claude done');
          setIsGenerating(false);
          // Clear logs when done
          setServerLogs([]);
          setSessions(prev => {
            const targetSessionId = activeSessionId || prev[0]?.id;
            if (!targetSessionId) return prev;

            return prev.map(s => {
              if (s.id !== targetSessionId) return s;
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
          setIsGenerating(false);
          // Clear logs when done
          setServerLogs([]);
          setSessions(prev => {
            const targetSessionId = activeSessionId || prev[0]?.id;
            if (!targetSessionId) return prev;

            return prev.map(s => {
              if (s.id !== targetSessionId) return s;
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
          setSessions(prev => {
            const targetSessionId = activeSessionId || prev[0]?.id;
            if (!targetSessionId) return prev;

            return prev.map(s => {
              if (s.id !== targetSessionId) return s;
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
          setIsGenerating(false);
        } else if (msg.type === 'project_list') {
          // Handle project list from server
          console.log('Received project list:', msg.projects);
          if (msg.projects) {
            setProjects(msg.projects);
            setLoadingProjects(new Set());
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
          if (msg.session) {
            const newSession: ChatSession = {
              id: msg.session.id,
              title: msg.session.title || 'New Chat',
              messages: [],
              createdAt: msg.session.createdAt || Date.now()
            };
            setSessions(prev => {
              // Avoid duplicate sessions
              const exists = prev.find(s => s.id === newSession.id);
              if (exists) return prev;
              return [newSession, ...prev];
            });
            setCurrentSessionId(newSession.id);
            currentSessionIdRef.current = newSession.id;
            // Clear projectId when creating new session (always in current project)
            setCurrentProjectId(null);

            // If there's a pending message, send it now
            if (pendingMessageRef.current) {
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

            // Always update sessions (for message stream handling)
            setSessions(prev => {
              const exists = prev.find(s => s.id === resumedSession.id);
              if (exists) {
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
    if (wsRef.current && isConnected) {
      const msg: any = { type: 'session', action: 'resume', sessionId };
      if (projectId) {
        msg.projectId = projectId;
      }
      wsRef.current.send(JSON.stringify(msg));
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

  // Send message
  const handleSend = async (text: string, attachments: Attachment[]) => {
    console.log('[handleSend] called with text:', text?.substring(0, 30));
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
    setIsGenerating(true);

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
    // Send stop request to server to kill Claude CLI process
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'stop',
        timestamp: Date.now()
      }));
      console.log('[handleStop] Sent stop request');
    }
    // Update UI
    setIsGenerating(false);
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
            className="overflow-hidden z-[55]"
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
                            (projectSessions[project.id] || []).map(session => (
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
                                  }}
                                  className="flex-1 text-left text-xs"
                                >
                                  <div className="truncate">
                                    <FileText size={12} className="inline mr-1 opacity-50" />
                                    {session.title}
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
                            ))
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
