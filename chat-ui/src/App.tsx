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
  Trash2
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
  onSettingsClick,
  isConnected
}: {
  onMenuClick: () => void;
  onNewChat: () => void;
  title: string;
  onTitleChange: (newTitle: string) => void;
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

  // Pattern for letter options (A. B. C.) or number options (1. 2. 3.)
  const optionPattern = /^([A-Z]|[0-9]+)[\.\)、]\s*(.+?)$/;

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
            label: match[1], // A, B, C or 1, 2, 3
            description: match[2].trim()
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
          {/* Thinking Process */}
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
                    className="overflow-hidden bg-white/[0.03] rounded-xl p-4 border border-white/5 text-[13.5px] text-white/50 italic leading-relaxed font-serif"
                  >
                    {thinkingContent}
                  </motion.div>
                )}
              </AnimatePresence>
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
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
                <img
                  src={file.url}
                  alt="preview"
                  className="w-16 h-16 object-cover rounded-lg border border-white/10"
                />
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
          accept="image/*"
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
            />
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

export default function App() {
  // WebSocket state
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [serverUrl, setServerUrl] = useState('ws://192.168.5.23:8085');
  const [token, setToken] = useState('test123');
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
  const currentSession = sessions.find(s => s.id === currentSessionId);
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
          // Request session list from server
          newWs.send(JSON.stringify({ type: 'session', action: 'list' }));
        } else if (msg.type === 'auth_failed') {
          setIsConnected(false);
          setIsConnecting(false);
          console.error('Auth failed');
          newWs.close();
        } else if (msg.type === 'claude_start') {
          // Claude is starting to respond
          console.log('Claude started responding');
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
        } else if (msg.type === 'claude_error') {
          console.log('Claude error:', msg.error);
          setIsGenerating(false);
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
        } else if (msg.type === 'session_list') {
          // Handle session list from server
          console.log('Received session list:', msg.sessions);
          if (msg.sessions && msg.sessions.length > 0) {
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
          console.log('Session resumed:', msg.session);
          if (msg.session) {
            const resumedSession: ChatSession = {
              id: msg.session.id,
              title: msg.session.title,
              messages: msg.session.messages || [],
              createdAt: msg.session.createdAt || Date.now()
            };
            setSessions(prev => {
              const exists = prev.find(s => s.id === resumedSession.id);
              if (exists) {
                return prev.map(s => s.id === resumedSession.id ? resumedSession : s);
              }
              return [resumedSession, ...prev];
            });
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
    scrollToBottom();
  }, [messages]);

  // Create new session (on server)
  const createNewSession = () => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({ type: 'session', action: 'new' }));
    }
  };

  // Resume existing session
  const resumeSession = (sessionId: string) => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({ type: 'session', action: 'resume', sessionId }));
    }
  };

  // Refresh session list from server
  const refreshSessions = () => {
    if (wsRef.current && isConnected) {
      isRefreshingRef.current = true;
      wsRef.current.send(JSON.stringify({ type: 'session', action: 'list' }));
    }
  };

  // Delete a session
  const deleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering resume
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({ type: 'session', action: 'delete', sessionId }));
      // If deleting current session, clear it
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        currentSessionIdRef.current = null;
      }
    }
  };

  // Store pending message when waiting for session creation
  const pendingMessageRef = useRef<{ text: string; attachments: Attachment[] } | null>(null);

  // Send message
  const handleSend = async (text: string, attachments: Attachment[]) => {
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
    setIsGenerating(true);

    console.log('Sending message to WebSocket, sessionId:', sessionId);

    // Send to WebSocket
    activeWs.send(JSON.stringify({
      type: 'claude',
      content: text,
      stream: true,
      timestamp: Date.now()
    }));
  };

  const handleStop = () => {
    // Cannot really stop WebSocket stream, but update UI
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
                    onClick={refreshSessions}
                    className="text-white/40 hover:text-white transition-colors"
                    title="Refresh sessions"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button onClick={() => setIsSidebarOpen(false)} className="text-white/40">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 space-y-2 no-scrollbar">
                {sessions.length === 0 ? (
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/60">
                    No recent chats
                  </div>
                ) : (
                  sessions.map(session => (
                    <div
                      key={session.id}
                      className={cn(
                        "flex items-center gap-2 p-3 rounded-xl transition-colors text-sm",
                        currentSessionId === session.id
                          ? "bg-accent text-white"
                          : "bg-white/5 text-white/60 hover:bg-white/10"
                      )}
                    >
                      <button
                        onClick={() => {
                          resumeSession(session.id);
                          setIsSidebarOpen(false);
                        }}
                        className="flex-1 text-left truncate"
                      >
                        {session.title}
                      </button>
                      <button
                        onClick={(e) => deleteSession(session.id, e)}
                        className="text-white/40 hover:text-red-400 transition-all p-2 -mr-1 touch-manipulation"
                        title="Delete session"
                      >
                        <Trash2 size={18} />
                      </button>
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
        className="flex-1 overflow-y-auto chat-scroll pt-[80px] pb-[120px] no-scrollbar relative"
      >
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
          messages.map((msg) => (
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
