import React, { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { AlertCircle, Brain, Check, ChevronDown, Copy, RotateCcw, Sparkles } from 'lucide-react';
import { ChatOption, Message, MessageProcess, MessageProcessEvent, ProcessPanelPreferences } from '../../types';
import { cn } from '../../utils';
import {
  getProcessEventDotClass,
  getProcessEventLabel,
  getProcessEventSummary,
  getProcessStateLabel,
  getProcessStateBadgeClass,
  getReconnectPlaceholderContent,
  normalizeLegacyDisplayText
} from '../../chatUiShared';
import { filterProcessForDisplay } from '../../uiPreferences';
import { useI18n } from '../../i18n';
import { RECONNECT_PLACEHOLDER_MESSAGE_PREFIX } from '../../state/chatStateCache';

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

  let highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  highlighted = highlighted.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span style="color:#a5d6ff">$&</span>');
  highlighted = highlighted.replace(/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/gm, '<span style="color:#8b949e;font-style:italic">$1</span>');

  if (kw.length > 0) {
    const keywordRegex = new RegExp(`\\b(${kw.join('|')})\\b`, 'g');
    highlighted = highlighted.replace(keywordRegex, '<span style="color:#ff7b72">$1</span>');
  }

  highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#79c0ff">$1</span>');
  highlighted = highlighted.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, '<span style="color:#d2a8ff">$1</span>(');

  return highlighted;
};

const MERMAID_DIAGRAM_START = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|xychart-beta|sankey-beta|block-beta|packet-beta|architecture-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i;

const getWholeMessageMermaidSource = (content: string): string | null => {
  const trimmed = content.trim();
  if (!trimmed || trimmed.startsWith('```')) {
    return null;
  }

  return MERMAID_DIAGRAM_START.test(trimmed) ? trimmed : null;
};

const isMermaidBlock = (language: string | undefined, code: string): boolean => {
  return (language || '').toLowerCase() === 'mermaid' || getWholeMessageMermaidSource(code) !== null;
};

let mermaidConfigured = false;

const renderMarkdownParagraph = ({ children }: { children: React.ReactNode }) => (
  <p className="whitespace-pre-wrap">{children}</p>
);

const CodeBlock = ({ code, language }: { code: string; language: string }) => {
  const { t } = useI18n();
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
        <span className="text-white/50 font-mono">{language || t('common.code')}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-white/50 hover:text-white transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? t('common.copied') : t('common.copy')}</span>
        </button>
      </div>
      <pre className="!mt-0 !rounded-t-none">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }} />
      </pre>
    </div>
  );
};

const MermaidBlock = ({ code }: { code: string }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const renderId = useId().replace(/:/g, '');

  useEffect(() => {
    let active = true;

    const renderDiagram = async () => {
      try {
        const mermaid = (await import('mermaid')).default;

        if (!mermaidConfigured) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'base',
            themeVariables: {
              background: 'transparent',
              primaryColor: '#0f172a',
              primaryTextColor: '#e2e8f0',
              primaryBorderColor: '#475569',
              lineColor: '#94a3b8',
              secondaryColor: '#111827',
              tertiaryColor: '#172033',
            }
          });
          mermaidConfigured = true;
        }

        const { svg: renderedSvg } = await mermaid.render(`mermaid-${renderId}-${Date.now()}`, code);
        if (active) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (e) {
        if (active) {
          setSvg('');
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    renderDiagram();

    return () => {
      active = false;
    };
  }, [code, renderId]);

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
        <span className="text-white/50 font-mono">mermaid</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-white/50 hover:text-white transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? t('common.copied') : t('common.copy')}</span>
        </button>
      </div>
      <div className="overflow-x-auto rounded-b-lg border border-white/10 border-t-0 bg-[#0b1020] p-4">
        {error ? (
          <div className="space-y-2">
            <div className="text-sm text-red-300">{t('bubble.mermaid.failed')}</div>
            <div className="text-xs text-red-200/80 whitespace-pre-wrap">{error}</div>
            <pre className="!m-0 whitespace-pre-wrap rounded-lg border border-red-400/20 bg-black/30 p-3 text-xs text-white/70">
              {code}
            </pre>
          </div>
        ) : svg ? (
          <div
            className="[&_svg]:h-auto [&_svg]:max-w-full [&_svg]:min-w-[320px]"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="text-sm text-white/50">{t('bubble.mermaid.rendering')}</div>
        )}
      </div>
    </div>
  );
};

const ProcessPanel = ({
  process,
  isStreaming
}: {
  process?: MessageProcess;
  isStreaming?: boolean;
}) => {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const eventCount = process?.events.length || 0;

  useEffect(() => {
    if (isStreaming && eventCount > 0) {
      setIsExpanded(true);
    }
  }, [eventCount, isStreaming]);

  if (!process || eventCount === 0) {
    return null;
  }

  return (
    <div className="mb-4 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-[11px] font-bold text-white/30 hover:text-white/50 transition-colors uppercase tracking-[0.1em] mb-2 group/process"
      >
        <div className="w-5 h-5 rounded-full bg-sky-500/10 flex items-center justify-center group-hover/process:bg-sky-500/20 transition-colors">
          <Sparkles size={12} className="text-sky-300" />
        </div>
        <span>{t('bubble.process')}</span>
        <span className={cn(
          'rounded-full border px-2 py-0.5 text-[9px]',
          getProcessStateBadgeClass(process.state)
        )}>
          {getProcessStateLabel(process.state, t)}
        </span>
        <span className="text-white/20">{eventCount}</span>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        >
          <ChevronDown size={14} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
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
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 space-y-2">
              {process.events.map((event, index) => {
                const summary = getProcessEventSummary(event, t);
                const showToolInput = event.type === 'tool_use' && event.toolInput && Object.keys(event.toolInput).length > 0;
                const showToolResult = event.type === 'tool_result' && typeof event.result === 'string' && event.result.trim() !== '';
                const eventKey = ('toolUseId' in event && event.toolUseId)
                  ? `${event.type}-${event.toolUseId}-${event.timestamp}`
                  : `${event.type}-${event.timestamp}-${index}`;

                return (
                  <div
                    key={eventKey}
                    className="rounded-lg border border-white/5 bg-black/10 p-3"
                  >
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
                      <span className={cn('inline-flex h-2 w-2 rounded-full', getProcessEventDotClass(event))} />
                      <span>{getProcessEventLabel(event, t)}</span>
                    </div>
                    {summary && (
                      <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-white/80">
                        {normalizeLegacyDisplayText(summary)}
                      </div>
                    )}
                    {showToolInput && (
                      <pre className="!mt-2 whitespace-pre-wrap rounded-lg border border-white/5 bg-black/20 p-3 text-[11px] text-white/55">
                        {JSON.stringify(event.toolInput, null, 2)}
                      </pre>
                    )}
                    {showToolResult && (
                      <pre className="!mt-2 whitespace-pre-wrap rounded-lg border border-white/5 bg-black/20 p-3 text-[11px] text-white/55">
                        {normalizeLegacyDisplayText(event.result)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface ChatBubbleProps {
  message: Message;
  isStreaming?: boolean;
  onRetry?: () => void;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  onOptionClick?: (option: string) => void;
  processPanelPreferences: ProcessPanelPreferences;
}

export const ChatBubble = React.memo(({
  message,
  isStreaming,
  onRetry,
  onCopy,
  onRegenerate,
  onOptionClick,
  processPanelPreferences
}: ChatBubbleProps) => {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isAgentExpanded, setIsAgentExpanded] = useState(false);

  let thinkingContent = normalizeLegacyDisplayText(message.thinking || '');
  let displayContent = normalizeLegacyDisplayText(message.content);
  if (message.id.startsWith(RECONNECT_PLACEHOLDER_MESSAGE_PREFIX)) {
    displayContent = getReconnectPlaceholderContent(message.process?.provider || 'claude', t);
  }
  const visibleProcess = filterProcessForDisplay(message.process, processPanelPreferences);
  const hasProcess = !!visibleProcess?.events?.length;
  const processPanelPreferenceKey = [
    processPanelPreferences.showStatus ? '1' : '0',
    processPanelPreferences.showLog ? '1' : '0',
    processPanelPreferences.showTool ? '1' : '0'
  ].join('');

  const agentMessageMatch = displayContent.match(/^([^\s]+)\s+\*\*([^*]+)\*\*\s+\(([^)]+)\)(?:\s+\*R(\d+)\*)?\n\n([\s\S]*)$/);
  const isAgentMessage = !isUser && agentMessageMatch !== null && !isStreaming;
  const agentIcon = agentMessageMatch?.[1] || '@';
  const agentName = agentMessageMatch?.[2] || t('bubble.agentFallbackName');
  const agentRole = agentMessageMatch?.[3] || '';
  const agentRound = agentMessageMatch?.[4] ? `R${agentMessageMatch[4]}` : '';
  const agentContent = agentMessageMatch?.[5] || displayContent;

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

  useEffect(() => {
    if (isStreaming && thinkingContent) {
      setIsThinkingExpanded(true);
    }
  }, [isStreaming, thinkingContent]);

  const choicesMatch = displayContent.match(/\[CHOICES\]([\s\S]*?)\[\/CHOICES\]/);
  let internalChoices: ChatOption[] = [];
  if (choicesMatch) {
    try {
      internalChoices = JSON.parse(choicesMatch[1].trim());
    } catch {
      internalChoices = [];
    }
  }

  const letterOptions: ChatOption[] = [];
  const tempContent = displayContent;
  const optionPattern = /^[A-Z][\.\)]\s+(.+)$/;

  if (!isStreaming) {
    const lines = tempContent.split('\n');
    let inOptionsBlock = false;
    let optionsStartIndex = -1;
    let optionsEndIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (optionPattern.test(line)) {
        if (!inOptionsBlock) {
          inOptionsBlock = true;
          optionsStartIndex = i;
        }
        const match = line.match(optionPattern);
        if (match) {
          letterOptions.push({
            label: line.charAt(0),
            description: match[1].trim()
          });
        }
        optionsEndIndex = i;
      } else if (inOptionsBlock && line === '') {
        continue;
      } else if (inOptionsBlock) {
        break;
      }
    }

    if (letterOptions.length >= 2) {
      const beforeOptions = lines.slice(0, optionsStartIndex);
      const afterOptions = lines.slice(optionsEndIndex + 1);
      displayContent = [...beforeOptions, ...afterOptions].join('\n').trim();
    } else {
      letterOptions.length = 0;
    }
  }

  const allChoices = [...internalChoices, ...letterOptions];

  displayContent = displayContent
    .replace(/\[CHOICES\][\s\S]*?\[\/CHOICES\]/, '')
    .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/, '')
    .trim();

  const standaloneAgentMermaid = !isStreaming ? getWholeMessageMermaidSource(agentContent) : null;
  const standaloneDisplayMermaid = !isStreaming ? getWholeMessageMermaidSource(displayContent) : null;
  const hasAgentContent = agentContent.trim() !== '';
  const hasDisplayContent = displayContent.trim() !== '';
  const shouldRenderAgentMessage = isAgentMessage && hasAgentContent;
  const shouldRenderNormalMessage = !isAgentMessage && (hasDisplayContent || (isStreaming && !thinkingContent && !hasProcess));

  const groupedOptions = message.options?.reduce((acc, opt) => {
    const category = opt.category || t('bubble.suggestions');
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(opt);
    return acc;
  }, {} as Record<string, typeof message.options>) || {};

  return (
    <motion.div
      id={`message-${message.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col w-full mb-6 px-4',
        isUser ? 'items-end' : 'items-start'
      )}
    >
      <div className={cn(
        'max-w-[90%] relative group',
        isUser ? 'items-end' : 'items-start'
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
          'px-4 py-3 rounded-2xl text-[16px] leading-relaxed',
          isUser
            ? 'bg-accent text-white rounded-tr-none'
            : 'bg-card text-white/90 rounded-tl-none border border-white/5'
        )}>
          {!isUser && thinkingContent && (
            <div className="mb-4 overflow-hidden">
              <button
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className="flex items-center gap-2 text-[11px] font-bold text-white/30 hover:text-white/50 transition-colors uppercase tracking-[0.1em] mb-2 group/thinking"
              >
                <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center group-hover/thinking:bg-accent/20 transition-colors">
                  <Brain size={12} className="text-accent" />
                </div>
                <span>{t('bubble.thinkingProcess')}</span>
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

          {!isUser && (
            <ProcessPanel
              key={`process-${message.id}-${processPanelPreferenceKey}`}
              process={visibleProcess}
              isStreaming={isStreaming}
            />
          )}

          {shouldRenderAgentMessage && (
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
                      {standaloneAgentMermaid ? (
                        <MermaidBlock code={standaloneAgentMermaid} />
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          components={{
                            code({ className, children, inline, ...props }: any) {
                              const match = /language-([\w-]+)/.exec(className || '');
                              const codeString = String(children).replace(/\n$/, '');
                              const language = match ? match[1] : undefined;
                              const isCodeBlock = match || codeString.includes('\n');
                              if (isCodeBlock && !inline) {
                                return !isStreaming && isMermaidBlock(language, codeString)
                                  ? <MermaidBlock code={codeString} />
                                  : <CodeBlock code={codeString} language={language || 'text'} />;
                              }
                              return (
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              );
                            },
                            p: renderMarkdownParagraph
                          }}
                        >
                          {agentContent}
                        </ReactMarkdown>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {shouldRenderNormalMessage && (
            <div className="markdown-body">
              {standaloneDisplayMermaid ? (
                <MermaidBlock code={standaloneDisplayMermaid} />
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={{
                    code({ className, children, inline, ...props }: any) {
                      const match = /language-([\w-]+)/.exec(className || '');
                      const codeString = String(children).replace(/\n$/, '');
                      const language = match ? match[1] : undefined;
                      const isCodeBlock = match || codeString.includes('\n');

                      if (isCodeBlock && !inline) {
                        return !isStreaming && isMermaidBlock(language, codeString)
                          ? <MermaidBlock code={codeString} />
                          : <CodeBlock code={codeString} language={language || 'text'} />;
                      }

                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    p: renderMarkdownParagraph
                  }}
                >
                  {displayContent}
                </ReactMarkdown>
              )}
              {!isUser && isStreaming && (
                <span className="inline-block w-1.5 h-4 ml-1 bg-accent animate-pulse align-middle" />
              )}
            </div>
          )}

          {!isStreaming && allChoices.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3">
              {allChoices.map((choice, idx) => {
                const choiceCategory = choice.category === 'Suggestions' ? t('bubble.suggestions') : choice.category;

                return (
                <button
                  key={idx}
                  onClick={() => onOptionClick?.(choice.description || choice.label)}
                  className="w-full text-left p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-accent/50 transition-all active:scale-[0.98]"
                >
                  {choiceCategory && (
                    <span className="text-[10px] font-bold text-accent uppercase tracking-widest block mb-1">
                      {choiceCategory}
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
                );
              })}
            </div>
          )}
        </div>

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

      {!isStreaming && Object.keys(groupedOptions).length > 0 && (
        <div className="mt-4 w-full flex flex-col gap-4">
          {Object.entries(groupedOptions).map(([category, opts]) => (
            <div key={category} className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-white/30 uppercase tracking-widest ml-1">
                {category === 'Suggestions' ? t('bubble.suggestions') : category}
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
