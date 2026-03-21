import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
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
import {
  Message,
  Attachment,
  ChatSession,
  ChatOption,
  MessageProcess,
  MessageProcessEvent,
  ProcessPanelPreferences,
  UiPreferences,
  Provider
} from './types';
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

const MermaidBlock = ({ code }: { code: string }) => {
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
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="overflow-x-auto rounded-b-lg border border-t-0 border-white/10 bg-black/20 p-4">
        {error ? (
          <div className="space-y-3">
            <div className="text-xs text-red-300">
              Mermaid render failed: {error}
            </div>
            <pre className="whitespace-pre-wrap text-sm text-white/70">{code}</pre>
          </div>
        ) : svg ? (
          <div
            className="[&_svg]:h-auto [&_svg]:max-w-full [&_svg]:min-w-[320px]"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="text-sm text-white/50">Rendering diagram...</div>
        )}
      </div>
    </div>
  );
};

const renderMarkdownParagraph = ({ children }: any) => (
  <p className="whitespace-pre-wrap">{children}</p>
);

// --- WebSocket Connection Types ---
interface ProjectInfo {
  id: string;
  displayName: string;
  sessionCount: number;
  lastActivity: number;
  provider: Provider;
}

interface WSMessage {
  type: string;
  action?: string;
  content?: string;
  thinking?: string;
  done?: boolean;
  replace?: boolean;  // Replace streamed content instead of appending when resuming a background session
  error?: string;
  code?: string;
  data?: any;
  command?: string;
  success?: boolean;
  sessionId?: string;
  projectId?: string;
  provider?: Provider;
  discussionId?: string;
  // Attachments
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    data: string;  // base64 encoded
  }>;
  // Tool events
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
    provider?: Provider;
  };
  sessions?: Array<{
    id?: string;
    sessionId?: string;
    title: string;
    summary?: string;
    createdAt?: number;
    messageCount?: number;
    messages?: Message[];
    provider?: Provider;
    projectId?: string;
  }>;
  projects?: ProjectInfo[];
  // Logs
  level?: string;
  message?: string;
  timestamp?: number;
  // Pagination
  hasMore?: boolean;
  totalMessages?: number;
  // Session ID updates
  oldSessionId?: string;
  newSessionId?: string;
  title?: string;
  // Loaded messages
  messages?: Message[];
  uiPreferences?: UiPreferences;
}

const DEFAULT_PROCESS_PANEL_PREFERENCES: ProcessPanelPreferences = {
  showStatus: true,
  showLog: true,
  showTool: true
};

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  processPanel: DEFAULT_PROCESS_PANEL_PREFERENCES,
  updatedAt: 0
};

const normalizeProcessPanelPreferences = (
  value?: Partial<ProcessPanelPreferences> | null
): ProcessPanelPreferences => ({
  showStatus: value?.showStatus ?? DEFAULT_PROCESS_PANEL_PREFERENCES.showStatus,
  showLog: value?.showLog ?? DEFAULT_PROCESS_PANEL_PREFERENCES.showLog,
  showTool: value?.showTool ?? DEFAULT_PROCESS_PANEL_PREFERENCES.showTool
});

const normalizeUiPreferences = (value?: UiPreferences | null): UiPreferences => ({
  processPanel: normalizeProcessPanelPreferences(value?.processPanel),
  updatedAt: typeof value?.updatedAt === 'number' ? value.updatedAt : 0
});

const filterProcessForDisplay = (
  process: MessageProcess | undefined,
  preferences: ProcessPanelPreferences
): MessageProcess | undefined => {
  if (!process || process.events.length === 0) {
    return undefined;
  }

  const visibleEvents = process.events.filter(event => {
    switch (event.type) {
      case 'status':
        return preferences.showStatus;
      case 'log':
        return preferences.showLog;
      case 'tool_use':
      case 'tool_result':
        return preferences.showTool;
      default:
        return true;
    }
  });

  if (visibleEvents.length === 0) {
    return undefined;
  }

  return {
    ...process,
    events: visibleEvents
  };
};

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex'
};

const getProviderLabel = (provider?: Provider): string => PROVIDER_LABELS[provider || 'claude'];

const LEGACY_MOJIBAKE_REPLACEMENTS: Array<[string, string]> = [
  ['\u9983\ue639\u0020\u0054\u0068\u0069\u006e\u006b\u0069\u006e\u0067\u002e\u002e\u002e', 'Thinking...'],
  ['\u9983\ue63b', '@'],
  ['\u9983\u6561', '[Tool]'],
  ['\u9983\u5e46', '[Discussion]'],
  ['\u9983\u6427', '[DIR]'],
  ['\u9983\u642b', '[FILE]'],
  ['\u9983\u6533', '[Search]'],
  ['\u95ab\u590b\u5ae8\u93c5\u9e3f\u5158\u6d63\u64c4\u7d19\u9359\ue21a\ue63f\u95ab\u591b\u7d1a', 'Choose agents (multi-select)'],
  ['\u5a0c\u2103\u6e41\u93b5\u60e7\u57cc\u9356\u5f52\u53a4\u9428\u52ec\u6ae4\u9473\u6212\u7d8b', 'No matching agents found'],
  ['\u6769\u612f\ue511\u6d93\u003f\u8def\u0020\u9410\u7470\u56ae\u93cc\u30e7\u6e45', 'Running · Tap to view'],
  ['\u6769\u612f\ue511\u6d93\u003f', 'Running'],
  ['\u7039\u5c7e\u579a', 'Completed'],
  ['\u59dd\uff45\u6e6a\u6fb6\u52ed\u608a\u002e\u002e\u002e', 'Processing...'],
  ['\u6fb6\u6c2d\u6ae4\u9473\u6212\u7d8b\u7481\u3128\ue191\u6769\u6d9c\ue511\u6d93\u003f\u002e\u002e', 'Multi-agent discussion in progress...']
];

const normalizeLegacyDisplayText = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  return LEGACY_MOJIBAKE_REPLACEMENTS.reduce(
    (result, [needle, replacement]) => result.replaceAll(needle, replacement),
    value
  );
};

const getProviderBadgeClass = (provider?: Provider): string => (
  provider === 'codex'
    ? 'border-sky-400/20 bg-sky-500/15 text-sky-200'
    : 'border-orange-400/20 bg-orange-500/15 text-orange-200'
);

// --- Settings List Panel ---
interface SettingsItem {
  name: string;
  model: string;
  env: number;
  envDetails?: Record<string, string>;
}

const PROCESS_PANEL_SETTING_OPTIONS: Array<{
  key: keyof ProcessPanelPreferences;
  title: string;
  description: string;
  badge: string;
  accentClass: string;
}> = [
  {
    key: 'showStatus',
    title: 'Status',
    description: 'Started, reasoning, completed and other lifecycle updates.',
    badge: 'status',
    accentClass: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
  },
  {
    key: 'showLog',
    title: 'Log',
    description: 'Commentary and runtime log lines emitted while the model works.',
    badge: 'log',
    accentClass: 'border-amber-400/20 bg-amber-500/10 text-amber-200'
  },
  {
    key: 'showTool',
    title: 'Tool',
    description: 'Includes both tool calls and tool results in one switch.',
    badge: 'tool_use + tool_result',
    accentClass: 'border-sky-400/20 bg-sky-500/10 text-sky-200'
  }
];

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
  wsRef,
  processPanelPreferences,
  processPreferencesLoaded,
  processPreferencesSaving,
  onProcessPanelPreferenceChange
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
  processPanelPreferences: ProcessPanelPreferences;
  processPreferencesLoaded: boolean;
  processPreferencesSaving: boolean;
  onProcessPanelPreferenceChange: (key: keyof ProcessPanelPreferences, value: boolean) => void;
}) => {
  const [settingsList, setSettingsList] = useState<SettingsItem[]>([]);
  const [selectedSettings, setSelectedSettings] = useState<string>('');
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  // Manual profile editing
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_MODEL: ''
  });

  // Used to dismiss the dropdown on outside clicks
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const showSettingsDropdownRef = useRef(showSettingsDropdown);
  showSettingsDropdownRef.current = showSettingsDropdown;

  // Close the settings dropdown when clicking outside
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

  // Load saved settings profiles
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

    // Temporary listener for settings responses
    const handleSettingsMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Settings] Received:', data.type);
        if (data.type === 'settings_list') {
          setSettingsList(data.settings || []);
          setLoadingSettings(false);
        } else if (data.type === 'settings_switched') {
          alert(data.message);
          // Keep the selected profile in sync after switching
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

  // Switch the active settings profile
  const switchSettings = useCallback((settingsName: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'switch',
      settingsName
    }));
    setShowSettingsDropdown(false);
  }, [wsRef]);

  // Save the manual override form
  const saveManualConfig = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'save',
      envDetails: editForm
    }));

    // Temporary listener for save responses
    const handleSettingsMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'settings_saved') {
          alert(data.message);
          setIsEditing(false);
          setSelectedSettings('(Manual override)');
        } else if (data.type === 'settings_error') {
          console.error('Settings error:', data.error);
          alert('Save failed: ' + data.error);
        }
      } catch {}
    };

    wsRef.current.addEventListener('message', handleSettingsMessage);
    return () => {
      wsRef.current?.removeEventListener('message', handleSettingsMessage);
    };
  }, [wsRef, editForm]);

  const toggleManualEdit = useCallback((event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();

    if (!isEditing) {
      const current = settingsList.find(settings => settings.name === selectedSettings);
      setEditForm({
        ANTHROPIC_BASE_URL: current?.envDetails?.ANTHROPIC_BASE_URL || '',
        ANTHROPIC_AUTH_TOKEN: current?.envDetails?.ANTHROPIC_AUTH_TOKEN || '',
        ANTHROPIC_MODEL: current?.envDetails?.ANTHROPIC_MODEL || ''
      });
    }

    setIsEditing(prev => !prev);
  }, [isEditing, selectedSettings, settingsList]);

  // Reset local settings UI after disconnects
  useEffect(() => {
    // Clear the cached profile state when the socket drops
    if (!isConnected) {
      setSettingsList([]);
      setSelectedSettings('');
      setShowSettingsDropdown(false);
      setIsEditing(false);
      setEditForm({ ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: '' });
    }
  }, [isConnected]);

  const selectedSettingsItem = settingsList.find(settings => settings.name === selectedSettings);
  const connectionStatusLabel = isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected';
  const processPreferencesStatusText = isConnected
    ? (processPreferencesSaving
      ? 'Syncing preferences to the current workspace...'
      : (processPreferencesLoaded
        ? 'Synced across devices for this workspace.'
        : 'Using current values while sync finishes.'))
    : 'Connect to load synced workspace preferences.';
  const canToggleProcessPreferences = isConnected && !processPreferencesSaving;

  return (
    <div className="space-y-3 border-b border-white/10 bg-card p-4">
      <div className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
                isConnected
                  ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                  : 'border-white/10 bg-black/20 text-white/40'
              )}
            >
              {isConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">Bridge Connection</div>
              <div className="mt-1 text-sm font-medium text-white">Local CLI transport for Claude and Codex sessions</div>
              <div className="mt-1 text-[11px] leading-5 text-white/45">
                This connection also carries synced UI preferences for the current workspace.
              </div>
            </div>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]',
              isConnected
                ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                : (isConnecting
                  ? 'border-amber-400/20 bg-amber-500/10 text-amber-200'
                  : 'border-white/10 bg-white/5 text-white/40')
            )}
          >
            {connectionStatusLabel}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">
            URL {url ? 'ready' : 'missing'}
          </div>
          <div className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">
            Token {token ? 'ready' : 'missing'}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/45">WebSocket URL</span>
            <input
              type="text"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="WebSocket URL (ws://...)"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-accent/50 focus:outline-none"
              disabled={isConnected}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/45">Token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder="Token"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-accent/50 focus:outline-none"
              disabled={isConnected}
            />
          </label>
        </div>

        <div className="mt-3">
          {isConnected ? (
            <button
              onClick={onDisconnect}
              className="w-full rounded-xl bg-red-500/20 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/30"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={isConnecting || !url || !token}
              className="w-full rounded-xl bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:opacity-50"
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>

      </div>

      {isConnected && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">Runtime Profile</div>
              <div className="mt-1 text-sm font-medium text-white">Switch saved backend settings or override them manually</div>
              <div className="mt-1 text-[11px] leading-5 text-white/45">
                Use a saved profile for quick switching, or open the manual editor for one-off values.
              </div>
            </div>
            <button
              type="button"
              onClick={toggleManualEdit}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors',
                isEditing
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'
              )}
            >
              {isEditing ? 'Close editor' : 'Manual override'}
            </button>
          </div>
          <div className="relative mt-3" ref={settingsDropdownRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (settingsList.length === 0 && !showSettingsDropdown) {
                  loadSettingsList();
                }
                setShowSettingsDropdown(!showSettingsDropdown);
              }}
              disabled={loadingSettings}
              className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-left transition-colors hover:bg-white/[0.08]"
            >
              <div className="min-w-0">
                <div className={cn('truncate text-sm font-medium', selectedSettings ? 'text-white' : 'text-white/40')}>
                  {loadingSettings ? 'Loading profiles...' : selectedSettings || 'Select settings profile'}
                </div>
                <div className="mt-1 text-[11px] text-white/40">
                  {selectedSettingsItem
                    ? (selectedSettingsItem.model || 'Unknown model') + (selectedSettingsItem.env ? ' · ' + selectedSettingsItem.env + ' env vars' : '')
                    : 'Load a saved profile and apply it to the CLI bridge'}
                </div>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                {loadingSettings && <RefreshCw size={14} className="animate-spin text-white/35" />}
                <ChevronDown size={14} className={cn('text-white/40 transition-transform', showSettingsDropdown && 'rotate-180')} />
              </div>
            </button>
            {showSettingsDropdown && (
              <div className="absolute left-0 right-0 top-full z-[100] mt-2 max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-card p-1 shadow-2xl">
                {settingsList.length === 0 ? (
                  <div className="p-4 text-center text-sm text-white/40">
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
                      className={cn(
                        'w-full rounded-xl px-3 py-2.5 text-left text-sm text-white transition-colors hover:bg-white/10',
                        selectedSettings === settings.name && 'bg-white/[0.08]'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{settings.name}</span>
                        <span className="shrink-0 text-[11px] text-white/40">{settings.model}</span>
                      </div>
                      {settings.envDetails && (
                        <div className="mt-1.5 space-y-1 text-[11px] text-white/45">
                          {settings.envDetails.ANTHROPIC_BASE_URL && (
                            <div className="truncate">URL: {settings.envDetails.ANTHROPIC_BASE_URL}</div>
                          )}
                          {settings.envDetails.ANTHROPIC_MODEL && (
                            <div className="truncate">Model: {settings.envDetails.ANTHROPIC_MODEL}</div>
                          )}
                          {settings.envDetails.ANTHROPIC_AUTH_TOKEN && (
                            <div>Auth token configured</div>
                          )}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {selectedSettingsItem?.envDetails && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {selectedSettingsItem.envDetails.ANTHROPIC_BASE_URL && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">Base URL</div>
                  <div className="mt-1 truncate text-xs text-white/75">{selectedSettingsItem.envDetails.ANTHROPIC_BASE_URL}</div>
                </div>
              )}
              {selectedSettingsItem.envDetails.ANTHROPIC_MODEL && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">Model</div>
                  <div className="mt-1 truncate text-xs text-white/75">{selectedSettingsItem.envDetails.ANTHROPIC_MODEL}</div>
                </div>
              )}
              {selectedSettingsItem.envDetails.ANTHROPIC_AUTH_TOKEN && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">Auth</div>
                  <div className="mt-1 text-xs text-white/75">Token configured</div>
                </div>
              )}
            </div>
          )}
          {isEditing && (
            <div className="mt-3 rounded-2xl border border-accent/15 bg-white/[0.04] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">Manual Override</div>
              <div className="mt-1 text-[11px] leading-5 text-white/45">
                Save a temporary endpoint override and apply it immediately.
              </div>
              <div className="mt-3 space-y-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-white/45">Base URL</span>
                  <input
                    type="text"
                    value={editForm.ANTHROPIC_BASE_URL}
                    onChange={(e) => setEditForm({ ...editForm, ANTHROPIC_BASE_URL: e.target.value })}
                    placeholder="ANTHROPIC_BASE_URL"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-white/45">Auth Token</span>
                  <input
                    type="password"
                    value={editForm.ANTHROPIC_AUTH_TOKEN}
                    onChange={(e) => setEditForm({ ...editForm, ANTHROPIC_AUTH_TOKEN: e.target.value })}
                    placeholder="ANTHROPIC_AUTH_TOKEN"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-white/45">Model</span>
                  <input
                    type="text"
                    value={editForm.ANTHROPIC_MODEL}
                    onChange={(e) => setEditForm({ ...editForm, ANTHROPIC_MODEL: e.target.value })}
                    placeholder="ANTHROPIC_MODEL"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                  />
                </label>
              </div>
              <button
                onClick={saveManualConfig}
                className="mt-3 w-full rounded-xl bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
              >
                Save and apply
              </button>
            </div>
          )}
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">Process Panel</div>
            <div className="mt-1 text-sm font-medium text-white">Choose which process channels are visible</div>
            <div className="mt-1 text-[11px] leading-5 text-white/45">
              {processPreferencesStatusText}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isConnected && processPreferencesSaving ? (
              <Loader2 size={14} className="animate-spin text-white/40" />
            ) : (
              <Check size={14} className={cn('text-white/25', processPreferencesLoaded && isConnected && 'text-emerald-300')} />
            )}
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]',
                isConnected
                  ? (processPreferencesLoaded
                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-400/20 bg-amber-500/10 text-amber-200')
                  : 'border-white/10 bg-white/5 text-white/40'
              )}
            >
              {isConnected ? (processPreferencesLoaded ? 'Workspace synced' : 'Pending sync') : 'Offline'}
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {PROCESS_PANEL_SETTING_OPTIONS.map((option) => {
            const enabled = processPanelPreferences[option.key];

            return (
              <button
                key={option.key}
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={!canToggleProcessPreferences}
                onClick={() => onProcessPanelPreferenceChange(option.key, !enabled)}
                className={cn(
                  'w-full rounded-2xl border px-3 py-3 text-left transition-all',
                  enabled
                    ? 'border-white/15 bg-white/[0.07]'
                    : 'border-white/10 bg-black/15 hover:bg-white/[0.05]',
                  !canToggleProcessPreferences && 'cursor-not-allowed opacity-60'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-white">{option.title}</span>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
                          enabled ? option.accentClass : 'border-white/10 bg-white/5 text-white/40'
                        )}
                      >
                        {option.badge}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-white/45">{option.description}</div>
                  </div>
                  <div
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]',
                      enabled
                        ? 'border-white/20 bg-white/10 text-white'
                        : 'border-white/10 bg-black/20 text-white/35'
                    )}
                  >
                    {enabled ? 'On' : 'Off'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-white/45">
          `Status` covers lifecycle updates. `Log` covers commentary and runtime logs. `Tool` combines both `tool_use` and `tool_result`.
        </div>
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
  isConnected,
  currentProvider,
  newSessionProvider,
  onNewSessionProviderChange
}: {
  onMenuClick: () => void;
  onNewChat: () => void;
  title: string;
  onTitleChange: (newTitle: string) => void;
  onTitleBlur: (newTitle: string) => void;
  onSettingsClick: () => void;
  isConnected: boolean;
  currentProvider: Provider;
  newSessionProvider: Provider;
  onNewSessionProviderChange: (provider: Provider) => void;
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
      <span className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        getProviderBadgeClass(currentProvider)
      )}>
        {getProviderLabel(currentProvider)}
      </span>
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
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-1">
        {(['claude', 'codex'] as Provider[]).map(provider => (
          <button
            key={provider}
            onClick={() => onNewSessionProviderChange(provider)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              newSessionProvider === provider
                ? 'bg-white text-black'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            )}
            title={`New ${getProviderLabel(provider)} session`}
          >
            {getProviderLabel(provider)}
          </button>
        ))}
      </div>
      <button onClick={onSettingsClick} className="settings-toggle-btn p-2 text-white/70 active:text-white">
        <Settings size={18} />
      </button>
      <button onClick={onNewChat} className="p-2 -mr-2 text-white/70 active:text-white">
        <Plus size={20} />
      </button>
    </div>
  </header>
);

// Format tool calls in a compact CLI-style summary
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

const createMessageProcess = (
  provider: Provider = 'claude',
  state: MessageProcess['state'] = 'running',
  events: MessageProcessEvent[] = []
): MessageProcess => ({
  provider,
  state,
  events
});

const ensureMessageProcess = (process: MessageProcess | undefined, provider: Provider): MessageProcess => (
  process
    ? {
        provider: process.provider || provider,
        state: process.state,
        events: [...process.events]
      }
    : createMessageProcess(provider)
);

const appendMessageProcessEvent = (
  process: MessageProcess | undefined,
  provider: Provider,
  event: MessageProcessEvent,
  state?: MessageProcess['state']
): MessageProcess => {
  const next = ensureMessageProcess(process, provider);
  return {
    ...next,
    provider,
    state: state || next.state,
    events: [...next.events, event]
  };
};

const setMessageProcessState = (
  process: MessageProcess | undefined,
  provider: Provider,
  state: MessageProcess['state']
): MessageProcess => {
  const next = ensureMessageProcess(process, provider);
  return {
    ...next,
    provider,
    state
  };
};

const createStreamingModelMessage = (provider: Provider, timestamp: number): Message => ({
  id: `${provider}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
  role: 'model',
  content: '',
  timestamp,
  status: 'sending'
});

const updateRunningModelMessage = (
  messages: Message[],
  provider: Provider,
  timestamp: number,
  updater: (message: Message) => Message
): Message[] => {
  const lastMessage = messages[messages.length - 1];

  if (lastMessage && lastMessage.role === 'model' && lastMessage.status === 'sending') {
    return [...messages.slice(0, -1), updater(lastMessage)];
  }

  return [...messages, updater(createStreamingModelMessage(provider, timestamp))];
};

const upsertToolRecord = (
  tools: Message['tools'] | undefined,
  event: Pick<WSMessage, 'toolName' | 'toolInput' | 'toolUseId' | 'result' | 'isError'>,
  timestamp: number
): Message['tools'] | undefined => {
  const nextTools = tools ? [...tools] : [];

  if (event.toolName) {
    nextTools.push({
      toolName: event.toolName,
      toolInput: event.toolInput,
      toolUseId: event.toolUseId,
      timestamp
    });
    return nextTools;
  }

  const existingIndex = nextTools.findIndex(tool => tool.toolUseId && tool.toolUseId === event.toolUseId);
  if (existingIndex !== -1) {
    nextTools[existingIndex] = {
      ...nextTools[existingIndex],
      result: event.result,
      isError: event.isError
    };
    return nextTools;
  }

  if (event.toolUseId || event.result) {
    nextTools.push({
      toolName: 'Tool',
      toolUseId: event.toolUseId,
      result: event.result,
      isError: event.isError,
      timestamp
    });
  }

  return nextTools.length > 0 ? nextTools : undefined;
};

const PROCESS_STATE_LABELS: Record<MessageProcess['state'], string> = {
  running: 'Running',
  completed: 'Completed',
  error: 'Error'
};

const getProcessStateBadgeClass = (state: MessageProcess['state']): string => (
  state === 'error'
    ? 'border-red-400/20 bg-red-500/10 text-red-200'
    : state === 'completed'
      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
      : 'border-sky-400/20 bg-sky-500/10 text-sky-200'
);

const getProcessEventDotClass = (event: MessageProcessEvent): string => {
  switch (event.type) {
    case 'status':
      return 'bg-sky-300';
    case 'log':
      return event.level === 'error'
        ? 'bg-red-300'
        : event.level === 'warn'
          ? 'bg-amber-300'
          : 'bg-white/40';
    case 'tool_use':
      return 'bg-violet-300';
    case 'tool_result':
      return event.isError ? 'bg-red-300' : 'bg-emerald-300';
    default:
      return 'bg-white/30';
  }
};

const getProcessEventLabel = (event: MessageProcessEvent): string => {
  switch (event.type) {
    case 'status':
      return 'Status';
    case 'log':
      return event.level === 'debug' ? 'Debug' : event.level === 'warn' ? 'Warning' : event.level === 'error' ? 'Error' : 'Log';
    case 'tool_use':
      return 'Tool';
    case 'tool_result':
      return event.isError ? 'Tool Error' : 'Tool Result';
    default:
      return 'Process';
  }
};

const getProcessEventSummary = (event: MessageProcessEvent): string => {
  switch (event.type) {
    case 'status':
      return event.label;
    case 'log':
      return event.message;
    case 'tool_use':
      return formatToolCall(event.toolName, event.toolInput);
    case 'tool_result':
      return event.isError ? 'Tool returned an error' : 'Tool returned output';
    default:
      return '';
  }
};

const ProcessPanel = ({
  process,
  isStreaming
}: {
  process?: MessageProcess;
  isStreaming?: boolean;
}) => {
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
        <span>Process</span>
        <span className={cn(
          'rounded-full border px-2 py-0.5 text-[9px]',
          getProcessStateBadgeClass(process.state)
        )}>
          {PROCESS_STATE_LABELS[process.state]}
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
                const summary = getProcessEventSummary(event);
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
                      <span>{getProcessEventLabel(event)}</span>
                    </div>
                    {summary && (
                      <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-white/80">
                        {normalizeLegacyDisplayText(summary)}
                      </div>
                    )}
                    {showToolInput && (
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/30 p-3 text-[12px] text-white/60 whitespace-pre-wrap">
                        {JSON.stringify(event.toolInput, null, 2)}
                      </pre>
                    )}
                    {showToolResult && (
                      <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-black/30 p-3 text-[12px] text-white/60 whitespace-pre-wrap">
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

const ChatBubble = React.memo(({
  message,
  isStreaming,
  onRetry,
  onCopy,
  onRegenerate,
  onOptionClick,
  processPanelPreferences
}: {
  message: Message;
  isStreaming?: boolean;
  onRetry?: () => void;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  onOptionClick?: (option: string) => void;
  processPanelPreferences: ProcessPanelPreferences;
}) => {
  const isUser = message.role === 'user';
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isAgentExpanded, setIsAgentExpanded] = useState(false);

  let thinkingContent = normalizeLegacyDisplayText(message.thinking || '');
  let displayContent = normalizeLegacyDisplayText(message.content);
  const visibleProcess = filterProcessForDisplay(message.process, processPanelPreferences);
  const hasProcess = !!visibleProcess?.events?.length;
  const processPanelPreferenceKey = [
    processPanelPreferences.showStatus ? '1' : '0',
    processPanelPreferences.showLog ? '1' : '0',
    processPanelPreferences.showTool ? '1' : '0'
  ].join('');

  // Detect agent discussion messages rendered from the discussion bridge.
  const agentMessageMatch = displayContent.match(/^([^\s]+)\s+\*\*([^*]+)\*\*\s+\(([^)]+)\)(?:\s+\*R(\d+)\*)?\n\n([\s\S]*)$/);
  const isAgentMessage = !isUser && agentMessageMatch !== null && !isStreaming;
  const agentIcon = agentMessageMatch?.[1] || '@';
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
  const optionPattern = /^[A-Z][\.\)]\s+(.+)$/;

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

  const standaloneAgentMermaid = !isStreaming ? getWholeMessageMermaidSource(agentContent) : null;
  const standaloneDisplayMermaid = !isStreaming ? getWholeMessageMermaidSource(displayContent) : null;
  const hasAgentContent = agentContent.trim() !== '';
  const hasDisplayContent = displayContent.trim() !== '';
  const shouldRenderAgentMessage = isAgentMessage && hasAgentContent;
  const shouldRenderNormalMessage = !isAgentMessage && (hasDisplayContent || (isStreaming && !thinkingContent && !hasProcess));

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

          {!isUser && (
            <ProcessPanel
              key={`process-${message.id}-${processPanelPreferenceKey}`}
              process={visibleProcess}
              isStreaming={isStreaming}
            />
          )}

          {/* Tool Use Section - Hidden for now */}
          {false && !isUser && message.tools && message.tools.length > 0 && (
            <div className="mb-3 space-y-2">
              {message.tools.map((tool, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs"
                >
                  <span className="text-blue-400 font-semibold">Tool</span>
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

          {/* Normal Message Content (not Agent message) */}
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

                  // Check if it's a code block (has language or multiple lines) vs inline code
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
                // Preserve paragraph spacing while rendering markdown
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

  // Slash-command suggestions
  const skills = [
    { id: 'git-commit', name: 'Git Commit', description: 'Create and push a git commit', trigger: '/git-workflow' },
    { id: 'create-readme', name: 'Create README', description: 'Generate a project README', trigger: '/create-readme' },
    { id: 'simplify', name: 'Simplify Code', description: 'Refactor and simplify code', trigger: '/simplify' },
    { id: 'brainstorm', name: 'Brainstorm', description: 'Explore ideas for a new feature', trigger: '/brainstorming' },
  ];

  // Mentionable review agents
  const agents = [
    { id: 'code-reviewer', name: 'Code Reviewer', alias: 'code-reviewer', icon: 'CR', color: '#4CAF50', description: 'Code quality, bugs, and best practices' },
    { id: 'architect', name: 'Architect', alias: 'architect', icon: 'AR', color: '#2196F3', description: 'System design and architecture decisions' },
    { id: 'tester', name: 'Tester', alias: 'tester', icon: 'TS', color: '#FF9800', description: 'Coverage, edge cases, and validation' },
    { id: 'security', name: 'Security', alias: 'security', icon: 'SEC', color: '#F44336', description: 'Security risks and authentication flows' },
    { id: 'performance', name: 'Performance', alias: 'performance', icon: 'PF', color: '#9C27B0', description: 'Performance bottlenecks and optimization' },
    { id: 'product', name: 'Product', alias: 'product', icon: 'PM', color: '#00BCD4', description: 'Requirements and user experience' },
    { id: 'devops', name: 'DevOps', alias: 'devops', icon: 'OP', color: '#607D8B', description: 'Deployment, monitoring, and CI/CD' },
  ];

  // Filter slash-command suggestions
  const filteredSkills = skillFilter
    ? skills.filter(s => s.name.toLowerCase().includes(skillFilter.toLowerCase()) || s.description.toLowerCase().includes(skillFilter.toLowerCase()))
    : skills;

  // Filter agent suggestions
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

    // Open slash-command suggestions when the input starts with /
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

    // Open agent suggestions when the user is typing a mention
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      // Stop suggesting once the mention has been terminated
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

  // Selecting a slash command can send it immediately
  const handleSelectSkill = (skill: typeof skills[0]) => {
    const skillMessage = skill.trigger + ' ';
    console.log('[handleSelectSkill] skill:', skill.name, 'message:', skillMessage, 'isConnected:', isConnected, 'isGenerating:', isGenerating);
    setInput(skillMessage);
    setShowSkills(false);
    setSkillFilter('');

    // Auto-send while the bridge is ready
    if (isConnected && !isGenerating) {
      console.log('[handleSelectSkill] Calling onSend...');
      onSend(skillMessage, []);
    } else {
      console.log('[handleSelectSkill] NOT sending - isConnected:', isConnected, 'isGenerating:', isGenerating);
    }
  };

  // Insert the selected agent mention into the input
  const handleSelectAgent = (agent: typeof agents[0]) => {
    const value = input;
    // Replace the current mention filter with the selected agent name
    const beforeAt = value.slice(0, agentStartPos);
    const afterFilter = value.slice(agentStartPos + 1 + agentFilter.length);
    const newValue = beforeAt + '@' + agent.name + ' ' + afterFilter;
    setInput(newValue);
    setShowAgents(false);
    setAgentFilter('');

    // Restore focus to the textarea
    setTimeout(() => {
      textareaRef.current?.focus();
      // Move the caret to the end of the inserted mention
      textareaRef.current?.setSelectionRange(newValue.length, newValue.length);
    }, 0);
  };

  // Close the slash-command popup
  const closeSkillsPopup = () => {
    setShowSkills(false);
    setSkillFilter('');
  };

  // Close the agent popup
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
                <span className="text-xs text-white/50">Select a skill</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {filteredSkills.length === 0 ? (
                  <div className="p-3 text-xs text-white/40">No matching skills found</div>
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

          {/* Agent picker */}
          {showAgents && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-white/10 rounded-xl shadow-lg overflow-hidden z-50">
              <div className="p-2 border-b border-white/10">
                <span className="text-xs text-white/50">@ Choose agents (multi-select)</span>
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {filteredAgents.length === 0 ? (
                  <div className="p-3 text-xs text-white/40">No matching agents found</div>
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

  // Close the settings panel on outside clicks
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Read the latest visibility state from a ref to avoid stale closures.
      // Ignore clicks inside the panel and on the toggle button itself.
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
  const [runningSessionsInfo, setRunningSessionsInfo] = useState<Map<string, { title: string; projectId?: string; provider?: Provider }>>(new Map()); // Store session info
  const [completedSessions, setCompletedSessions] = useState<Set<string>>(new Set()); // Track completed sessions (for notification)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [newSessionProvider, setNewSessionProvider] = useState<Provider>('claude');
  const syncNewSessionProvider = useCallback((provider?: Provider) => {
    if (provider) {
      setNewSessionProvider(provider);
    }
  }, []);

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
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES);
  const [processPreferencesLoaded, setProcessPreferencesLoaded] = useState(false);
  const [processPreferencesSaving, setProcessPreferencesSaving] = useState(false);
  const lastSavedUiPreferencesRef = useRef<UiPreferences>(DEFAULT_UI_PREFERENCES);
  const pendingUiPreferencesRollbackRef = useRef<UiPreferences | null>(null);
  const uiPreferencesRequestRef = useRef<'load' | 'save' | null>(null);
  const uiPreferencesTimeoutRef = useRef<number | null>(null);

  const clearUiPreferencesTimeout = useCallback(() => {
    if (uiPreferencesTimeoutRef.current !== null) {
      window.clearTimeout(uiPreferencesTimeoutRef.current);
      uiPreferencesTimeoutRef.current = null;
    }
    uiPreferencesRequestRef.current = null;
  }, []);

  const startUiPreferencesTimeout = useCallback((mode: 'load' | 'save') => {
    clearUiPreferencesTimeout();
    uiPreferencesRequestRef.current = mode;
    uiPreferencesTimeoutRef.current = window.setTimeout(() => {
      const timedOutMode = uiPreferencesRequestRef.current;
      uiPreferencesRequestRef.current = null;
      uiPreferencesTimeoutRef.current = null;

      if (timedOutMode === 'save') {
        setUiPreferences(pendingUiPreferencesRollbackRef.current || lastSavedUiPreferencesRef.current);
        pendingUiPreferencesRollbackRef.current = null;
        setProcessPreferencesSaving(false);
        setProcessPreferencesLoaded(true);
        alert('Saving process panel preferences timed out. Restart the backend so it picks up the new UI preferences API.');
        return;
      }

      setUiPreferences(normalizeUiPreferences(lastSavedUiPreferencesRef.current));
      setProcessPreferencesSaving(false);
      setProcessPreferencesLoaded(true);
    }, 5000);
  }, [clearUiPreferencesTimeout]);

  const requestUiPreferences = useCallback((socket?: WebSocket | null) => {
    const target = socket || wsRef.current;
    if (!target || target.readyState !== WebSocket.OPEN) {
      return;
    }

    setProcessPreferencesLoaded(false);
    startUiPreferencesTimeout('load');
    target.send(JSON.stringify({
      type: 'settings',
      action: 'get_ui_preferences'
    }));
  }, [startUiPreferencesTimeout]);

  const handleProcessPanelPreferenceChange = useCallback((
    key: keyof ProcessPanelPreferences,
    value: boolean
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('Connect to the server before changing synced process panel preferences.');
      return;
    }

    const previousPreferences = uiPreferences;
    const nextPreferences = normalizeUiPreferences({
      ...uiPreferences,
      processPanel: {
        ...uiPreferences.processPanel,
        [key]: value
      }
    });

    pendingUiPreferencesRollbackRef.current = previousPreferences;
    setUiPreferences(nextPreferences);
    setProcessPreferencesSaving(true);
    startUiPreferencesTimeout('save');

    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'save_ui_preferences',
      uiPreferences: nextPreferences
    }));
  }, [startUiPreferencesTimeout, uiPreferences]);

  useEffect(() => {
    if (showSettings && isConnected && !processPreferencesSaving) {
      requestUiPreferences();
    }
  }, [isConnected, processPreferencesSaving, requestUiPreferences, showSettings]);

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

  // Discussion state helpers that also mirror messages into the current chat
  const addMessageToChat = useCallback((message: Message) => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;

    // Append to the top-level session list
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s
    ));

    // Append to the active project's session list
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
      // Remove temporary discussion sessions from the running set
      setRunningSessions(prev => {
        const next = new Set(prev);
        // Discussion sessions use a synthetic discussion_* session ID
        for (const id of next) {
          if (id.startsWith('discussion_')) {
            next.delete(id);
          }
        }
        return next;
      });
      // Keep the mutable ref aligned with the React state
      runningSessionsRef.current = new Set(Array.from(runningSessionsRef.current).filter(id => !id.startsWith('discussion_')));
    },
    onError: (error) => {
      console.error('[Discussion] Error:', error);
      discussionMainSessionRef.current = null;
      // Remove temporary discussion sessions from the running set
      setRunningSessions(prev => {
        const next = new Set(prev);
        for (const id of next) {
          if (id.startsWith('discussion_')) {
            next.delete(id);
          }
        }
        return next;
      });
      // Keep the mutable ref aligned with the React state
      runningSessionsRef.current = new Set(Array.from(runningSessionsRef.current).filter(id => !id.startsWith('discussion_')));
    },
    onSendToMainSession: (summary, rawResult) => {
      // Forward the discussion summary into the main session after completion
      console.log('[Discussion] Sending to main session, summary length:', summary.length);
      // Delay slightly so the discussion UI has time to settle
      setTimeout(() => {
        // Let the primary provider continue from the discussion result.
        const summaryMessage = `Please continue from the following multi-agent discussion result:\n\n${summary}`;
        const targetSession = discussionMainSessionRef.current;
        console.log('[Discussion] Main session target:', targetSession);

        if (targetSession?.sessionId) {
          const sent = sendMessageToSpecificSession(targetSession.sessionId, summaryMessage, [], {
            projectId: targetSession.projectId,
            provider: targetSession.provider
          });
          discussionMainSessionRef.current = null;
          if (sent) {
            return;
          }
        }

        discussionMainSessionRef.current = null;
        handleSend(summaryMessage, []);
      }, 500);
    },
    onCreateHostSession: (title, fullRecord) => {
      // Create a host session that stores the full discussion record
      console.log('[Discussion] onCreateHostSession called');
      console.log('[Discussion]   title:', title);
      console.log('[Discussion]   wsRef.current:', !!wsRef.current);
      console.log('[Discussion]   wsRef.current.readyState:', wsRef.current?.readyState);
      console.log('[Discussion]   isConnected:', isConnected);
      const provider = currentSession?.provider || newSessionProvider;
      // Stash the discussion record until the host session exists
      pendingHostSessionRef.current = { title, fullRecord, provider };
      console.log('[Discussion]   pendingHostSessionRef.current set');

      if (wsRef.current && isConnected) {
        // Create the host session immediately when the socket is ready
        console.log('[Discussion] WebSocket connected, creating new session');
        createNewSession(provider, title);
      } else {
        // Otherwise retry after the connection is restored
        console.log('[Discussion] WebSocket not connected, will send after connection');
        // Poll until the socket becomes available again
        const checkAndSend = () => {
          if (wsRef.current && isConnected) {
            console.log('[Discussion] WebSocket now connected, creating new session');
            createNewSession(provider, title);
          } else {
            // Keep retrying with a short backoff
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

  const findLocalSession = useCallback((sessionId?: string | null, projectId?: string | null): ChatSession | null => {
    if (!sessionId) {
      return null;
    }

    let session = sessions.find(item => item.id === sessionId);
    if (session) {
      return session;
    }

    if (projectId && projectSessions[projectId]) {
      session = projectSessions[projectId].find(item => item.id === sessionId);
      if (session) {
        return session;
      }
    }

    for (const candidateProjectId of Object.keys(projectSessions)) {
      session = projectSessions[candidateProjectId].find(item => item.id === sessionId);
      if (session) {
        return session;
      }
    }

    return null;
  }, [projectSessions, sessions]);

  const sessionHasRenderableResult = useCallback((
    sessionId?: string | null,
    projectId?: string | null,
    fallbackSession?: ChatSession | null
  ): boolean => {
    const session = findLocalSession(sessionId, projectId) || fallbackSession || null;
    if (!session || session.messages.length === 0) {
      return false;
    }

    return session.messages.some(message => {
      if (message.role !== 'model') {
        return false;
      }

      if (message.status === 'error') {
        return true;
      }

      if (typeof message.content === 'string' && message.content.trim() !== '') {
        return true;
      }

      if (message.options && message.options.length > 0) {
        return true;
      }

      if (message.attachments && message.attachments.length > 0) {
        return true;
      }

      return false;
    });
  }, [findLocalSession]);

  const resolveSessionProvider = useCallback((
    sessionId?: string | null,
    projectId?: string | null,
    fallback: Provider = newSessionProvider
  ): Provider => {
    const localSession = findLocalSession(sessionId, projectId);
    if (localSession?.provider) {
      return localSession.provider;
    }

    if (projectId) {
      const project = projects.find(item => item.id === projectId);
      if (project?.provider) {
        return project.provider;
      }
    }

    return fallback;
  }, [findLocalSession, newSessionProvider, projects]);

  // Find current session from either sessions or projectSessions
  const currentSession = useMemo(() => (
    findLocalSession(currentSessionId, currentProjectId)
  ), [findLocalSession, currentProjectId, currentSessionId]);

  const currentProvider = currentSession?.provider || newSessionProvider;

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
      provider: currentSession?.provider,
      limit: 20,
      beforeIndex
    }));

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
  }, [ws, currentSessionId, currentProjectId, currentSession?.provider, hasMoreMessages, totalMessages]);

  // Handle scroll to detect when user scrolls to top
  // Debounce the scroll handler to avoid over-triggering pagination
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // Clear the previous debounce timer
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Only check for pagination after scrolling has paused briefly
    scrollTimeoutRef.current = setTimeout(() => {
      const target = e.target as HTMLDivElement;
      const { scrollTop } = target;

      // Load older messages when the user scrolls near the top
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
    setProcessPreferencesLoaded(false);
    setProcessPreferencesSaving(false);
    setUiPreferences(DEFAULT_UI_PREFERENCES);
    lastSavedUiPreferencesRef.current = DEFAULT_UI_PREFERENCES;
    pendingUiPreferencesRollbackRef.current = null;
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
          requestUiPreferences(newWs);
        } else if (msg.type === 'ping') {
          // Respond to server heartbeat ping
          newWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        } else if (msg.type === 'auth_failed') {
          setIsConnected(false);
          setIsConnecting(false);
          console.error('Auth failed');
          newWs.close();
        } else if (msg.type === 'ui_preferences') {
          clearUiPreferencesTimeout();
          const nextPreferences = normalizeUiPreferences(msg.uiPreferences);
          setUiPreferences(nextPreferences);
          setProcessPreferencesLoaded(true);
          setProcessPreferencesSaving(false);
          lastSavedUiPreferencesRef.current = nextPreferences;
          pendingUiPreferencesRollbackRef.current = null;
        } else if (msg.type === 'ui_preferences_saved') {
          clearUiPreferencesTimeout();
          const nextPreferences = normalizeUiPreferences(msg.uiPreferences);
          setUiPreferences(nextPreferences);
          setProcessPreferencesLoaded(true);
          setProcessPreferencesSaving(false);
          lastSavedUiPreferencesRef.current = nextPreferences;
          pendingUiPreferencesRollbackRef.current = null;
        } else if (msg.type === 'settings_error' && (msg.action === 'get_ui_preferences' || msg.action === 'save_ui_preferences')) {
          clearUiPreferencesTimeout();
          console.error('UI preferences error:', msg.error);
          if (msg.action === 'save_ui_preferences') {
            setUiPreferences(pendingUiPreferencesRollbackRef.current || lastSavedUiPreferencesRef.current);
            setProcessPreferencesSaving(false);
            pendingUiPreferencesRollbackRef.current = null;
            alert(`Failed to save process panel preferences: ${msg.error || 'Unknown error'}`);
          } else {
            const fallbackPreferences = normalizeUiPreferences(lastSavedUiPreferencesRef.current);
            setUiPreferences(fallbackPreferences);
            setProcessPreferencesLoaded(true);
            setProcessPreferencesSaving(false);
          }
        } else if (msg.type === 'running_sessions') {
          // Rehydrated list of running sessions after reconnecting
          console.log('Running sessions on server:', msg.sessions);
          if (msg.sessions && Array.isArray(msg.sessions)) {
            const newRunningSet = new Set<string>();
            const newInfoMap = new Map<string, { title: string; projectId?: string; provider?: Provider }>();

            msg.sessions.forEach((s) => {
              const runningSessionId = s.sessionId || s.id;
              if (!runningSessionId) {
                return;
              }

              newRunningSet.add(runningSessionId);
              newInfoMap.set(runningSessionId, {
                title: normalizeLegacyDisplayText(s.title),
                projectId: s.projectId,
                provider: s.provider
              });
            });

            setRunningSessions(newRunningSet);
            setRunningSessionsInfo(newInfoMap);

            // Focus the first running session after reconnecting
            if (msg.sessions.length > 0) {
              const firstSession = msg.sessions[0];
              const firstRunningSessionId = firstSession.sessionId || firstSession.id;
              if (firstRunningSessionId) {
                setCurrentSessionId(firstRunningSessionId);
                currentSessionIdRef.current = firstRunningSessionId;
                syncNewSessionProvider(firstSession.provider);
                console.log('Reconnected to running session:', firstRunningSessionId);
              }
            }
          }
        } else if (msg.type === 'session_running') {
          // Backward-compatible single-session running event
          console.log('Session running on server:', msg.sessionId);
          if (msg.sessionId) {
            setCurrentSessionId(msg.sessionId);
            currentSessionIdRef.current = msg.sessionId;
            setRunningSessions(prev => new Set(prev).add(msg.sessionId));
            syncNewSessionProvider(msg.provider);
            if (msg.title) {
              setRunningSessionsInfo(prev => {
                const next = new Map(prev);
                next.set(msg.sessionId, { title: msg.title, projectId: msg.projectId, provider: msg.provider });
                return next;
              });
            }
            console.log('Reconnected to running session:', msg.sessionId);
          }
        } else if (msg.type === 'discussion_running') {
          // Rehydrated running discussion after reconnecting
          console.log('Discussion running on server:', msg.discussionId);
          if (msg.discussionId) {
            const discussionSessionId = `discussion_${msg.discussionId}`;
            setRunningSessions(prev => new Set(prev).add(discussionSessionId));

            // Create a temporary session to host discussion updates if nothing is focused
            if (!currentSessionIdRef.current) {
              const tempSessionId = `discussion_${msg.discussionId}`;
              const tempSession: ChatSession = {
                id: tempSessionId,
                title: 'Multi-agent discussion in progress...',
                messages: [],
                createdAt: Date.now(),
                provider: currentProvider
              };
              setSessions(prev => [tempSession, ...prev]);
              setCurrentSessionId(tempSessionId);
              currentSessionIdRef.current = tempSessionId;
              console.log('[Discussion] Created temp session for running discussion:', tempSessionId);
            }

            // Restore the running discussion state
            discussion.restoreRunning(msg.discussionId);
            console.log('Reconnected to running discussion:', msg.discussionId);
          }
        } else if (msg.type === 'claude_start') {
          // Claude is starting to respond
          console.log('Claude started responding');
          const startTimestamp = msg.timestamp || Date.now();
          setSessions(prev => {
            const sessionId = targetSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const provider = msg.provider || s.provider || currentProvider;
              return {
                ...s,
                messages: updateRunningModelMessage(s.messages, provider, startTimestamp, (lastMsg) => ({
                  ...lastMsg,
                  timestamp: startTimestamp,
                  status: 'sending',
                  process: appendMessageProcessEvent(lastMsg.process, provider, {
                    type: 'status',
                    label: `${getProviderLabel(provider)} started working`,
                    timestamp: startTimestamp
                  })
                }))
              };
            });
          });
        } else if (msg.type === 'claude_tool') {
          // Handle tool use events
          console.log('Tool use:', msg.toolName || msg.toolUseId);
          const toolTimestamp = msg.timestamp || Date.now();
          setSessions(prev => {
            const sessionId = targetSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const provider = msg.provider || s.provider || currentProvider;
              const processEvent: MessageProcessEvent = msg.toolName
                ? {
                    type: 'tool_use',
                    toolName: msg.toolName,
                    toolInput: msg.toolInput,
                    toolUseId: msg.toolUseId,
                    timestamp: toolTimestamp
                  }
                : {
                    type: 'tool_result',
                    toolUseId: msg.toolUseId,
                    result: msg.result,
                    isError: msg.isError,
                    timestamp: toolTimestamp
                  };

              return {
                ...s,
                messages: updateRunningModelMessage(s.messages, provider, toolTimestamp, (lastMsg) => ({
                  ...lastMsg,
                  timestamp: toolTimestamp,
                  status: 'sending',
                  tools: upsertToolRecord(lastMsg.tools, msg, toolTimestamp),
                  process: appendMessageProcessEvent(lastMsg.process, provider, processEvent)
                }))
              };
            });
          });
        } else if (msg.type === 'claude_stream') {
          console.log('Stream chunk, sessionId:', targetSessionId, 'replace:', msg.replace, 'done:', msg.done);
          const streamTimestamp = msg.timestamp || Date.now();

          // Apply streamed model updates to the session list
          setSessions(prev => {
            const sessionId = targetSessionId || prev[0]?.id;
            if (!sessionId) return prev;

            return prev.map(s => {
              if (s.id !== sessionId) return s;
              const provider = msg.provider || s.provider || currentProvider;
              let nextMessages = s.messages;
              const messages = nextMessages;
              const lastMsg = messages[messages.length - 1];

              // Handle streamed content or thinking deltas
              if (msg.content || msg.thinking) {
                // Create a new model message when there is no active one
                if (!lastMsg || lastMsg.role !== 'model') {
                  // Start a new streamed model message
                  const newMsg: Message = {
                    id: Date.now().toString(),
                    role: 'model',
                    content: msg.content || '',
                    thinking: msg.thinking || '',
                    timestamp: streamTimestamp,
                    status: msg.done ? 'sent' : 'sending'
                  };
                  return { ...s, messages: [...messages, newMsg] };
                } else {
                  // Update the existing streamed model message
                  const updatedMsg = { ...lastMsg };
                  updatedMsg.timestamp = streamTimestamp;
                  if (msg.replace) {
                    if (msg.content !== undefined) updatedMsg.content = msg.content;
                    if (msg.thinking !== undefined) updatedMsg.thinking = msg.thinking;
                  } else {
                    if (msg.content) updatedMsg.content = (updatedMsg.content || '') + msg.content;
                    if (msg.thinking) updatedMsg.thinking = (updatedMsg.thinking || '') + msg.thinking;
                  }
                  if (msg.done) {
                    updatedMsg.status = 'sent';
                    if (updatedMsg.process) {
                      updatedMsg.process = setMessageProcessState(updatedMsg.process, provider, 'completed');
                    }
                  }
                  return { ...s, messages: [...messages.slice(0, -1), updatedMsg] };
                }
              } else if (msg.done && lastMsg && lastMsg.role === 'model') {
                const updatedMsg = {
                  ...lastMsg,
                  timestamp: streamTimestamp,
                  status: 'sent' as const,
                  process: lastMsg.process
                    ? setMessageProcessState(lastMsg.process, provider, 'completed')
                    : lastMsg.process
                };
                return { ...s, messages: [...messages.slice(0, -1), updatedMsg] };
              }
              return s;
            });
          });

          // When streaming finishes, clear running state and refresh project sessions
          if (msg.done) {
            const sessionId = targetSessionId;
            if (sessionId) {
              console.log('[RunningSessions] Stream done, removing session:', sessionId);
              setRunningSessions(prev => {
                const next = new Set(prev);
                next.delete(sessionId);
                return next;
              });
              // Remove stale running-session metadata
              setRunningSessionsInfo(prev => {
                const next = new Map(prev);
                next.delete(sessionId);
                return next;
              });
              // Mark the session as completed for the sidebar badge
              setCompletedSessions(prev => new Set(prev).add(sessionId));

              // Project sessions only need a lightweight refresh on completion
              setProjectSessions(prev => {
                for (const projectId of Object.keys(prev)) {
                  const projectSessionList = prev[projectId];
                  const session = projectSessionList.find(s => s.id === sessionId);
                  if (session) {
                    return {
                      ...prev,
                      [projectId]: projectSessionList.map(s => {
                        if (s.id !== sessionId) return s;
                        // Message content is synchronized via sessions; keep the identity stable here
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
            // Remove the cached running-session metadata as well
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
              const provider = msg.provider || s.provider || currentProvider;

              if (lastMsg && lastMsg.role === 'model') {
                return {
                  ...s,
                  messages: [...messages.slice(0, -1), {
                    ...lastMsg,
                    timestamp: msg.timestamp || Date.now(),
                    status: 'sent',
                    process: lastMsg.process
                      ? setMessageProcessState(lastMsg.process, provider, 'completed')
                      : lastMsg.process
                  }]
                };
              }
              return s;
            });
          });
        } else if (msg.type === 'claude_log') {
          // Handle server log messages
          console.log('Server log:', msg.level, msg.message);
          const logTimestamp = msg.timestamp || Date.now();
          const logLevel = msg.level === 'debug' || msg.level === 'warn' || msg.level === 'error'
            ? msg.level
            : 'info';
          const logMessage = msg.message || '';
          setServerLogs(prev => [...prev, {
            level: logLevel,
            message: logMessage,
            timestamp: logTimestamp
          }]);
          if (logMessage) {
            setSessions(prev => {
              const sessionId = targetSessionId || prev[0]?.id;
              if (!sessionId) return prev;

              return prev.map(s => {
                if (s.id !== sessionId) return s;
                const provider = msg.provider || s.provider || currentProvider;
                return {
                  ...s,
                  messages: updateRunningModelMessage(s.messages, provider, logTimestamp, (lastMsg) => ({
                    ...lastMsg,
                    timestamp: logTimestamp,
                    status: 'sending',
                    process: appendMessageProcessEvent(lastMsg.process, provider, {
                      type: 'log',
                      level: logLevel,
                      message: logMessage,
                      timestamp: logTimestamp
                    })
                  }))
                };
              });
            });
          }
        } else if (msg.type === 'claude_error') {
          console.log('Claude error:', msg.error);
          // Mark this session as done (error)
          const errorSessionId = targetSessionId;
          const errorTimestamp = msg.timestamp || Date.now();
          const errorMessage = msg.error || 'Unknown error';
          if (errorSessionId) {
            setRunningSessions(prev => {
              const next = new Set(prev);
              next.delete(errorSessionId);
              return next;
            });
            setRunningSessionsInfo(prev => {
              const next = new Map(prev);
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
              const provider = msg.provider || s.provider || currentProvider;
              return {
                ...s,
                messages: updateRunningModelMessage(s.messages, provider, errorTimestamp, (lastMsg) => ({
                  ...lastMsg,
                  content: lastMsg.content?.trim()
                    ? `${lastMsg.content}\n\nError: ${errorMessage}`
                    : `Error: ${errorMessage}`,
                  timestamp: errorTimestamp,
                  status: 'error',
                  process: appendMessageProcessEvent(
                    setMessageProcessState(lastMsg.process, provider, 'error'),
                    provider,
                    {
                      type: 'log',
                      level: 'error',
                      message: errorMessage,
                      timestamp: errorTimestamp
                    },
                    'error'
                  )
                }))
              };
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
                  content = '[DIR] ' + (msg.data.path || '.') + '\n\n';
                  msg.data.items.forEach((item: any) => {
                    const icon = item.type === 'dir' ? '[DIR]' : '[FILE]';
                    content += `${icon} ${item.name}\n`;
                  });
                } else if (msg.command === 'read' && msg.data?.content) {
                  content = '[FILE] ' + msg.data.path + '\n\n```\n' + msg.data.content + '\n```';
                } else if (msg.command === 'glob') {
                  content = '[Search] Found ' + (msg.data?.length || 0) + ' files:\n\n';
                  msg.data?.forEach((file: string) => {
                    content += `[FILE] ${file}\n`;
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
                title: normalizeLegacyDisplayText(s.summary || s.title || 'Untitled'),
                messages: [],
                createdAt: s.createdAt || Date.now(),
                provider: s.provider || msg.provider || 'claude'
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
              title: normalizeLegacyDisplayText(s.title),
              messages: [],
              createdAt: s.createdAt,
              provider: s.provider || msg.provider || 'claude'
            }));
            setSessions(serverSessions);

            // Only auto-resume on initial connection, not on refresh
            if (!isRefreshingRef.current) {
              const latestSessionId = msg.sessions[0].id;
              setCurrentSessionId(latestSessionId);
              currentSessionIdRef.current = latestSessionId;
              // Request to resume latest session to get messages
              newWs.send(JSON.stringify({
                type: 'session',
                action: 'resume',
                sessionId: latestSessionId,
                provider: msg.sessions[0].provider || msg.provider || 'claude'
              }));
            } else {
              isRefreshingRef.current = false;
            }
          } else {
            // No sessions, create a new one (only on initial connection)
            if (!isRefreshingRef.current) {
              newWs.send(JSON.stringify({ type: 'session', action: 'new', provider: newSessionProvider }));
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
            const sessionProvider = msg.session.provider || msg.provider || newSessionProvider;
            const newSession: ChatSession = {
              id: msg.session.id,
              title: normalizeLegacyDisplayText(msg.session.title || 'New Chat'),
              messages: [],
              createdAt: msg.session.createdAt || Date.now(),
              provider: sessionProvider
            };

            // Determine which project this session belongs to
            // If we have a current project, add to that project's sessions
            const targetProjectId = msg.projectId || currentProjectId || null;
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
            setCurrentProjectId(targetProjectId);
            syncNewSessionProvider(sessionProvider);

            // Let the backend know which session is currently focused
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
            const sessionProvider = msg.session.provider || msg.provider || newSessionProvider;
            const resumedSession: ChatSession = {
              id: msg.session.id,
              title: normalizeLegacyDisplayText(msg.session.summary || msg.session.title || 'Untitled'),
              messages: msg.session.messages || [],
              createdAt: msg.session.createdAt || Date.now(),
              provider: sessionProvider
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
              setCurrentProjectId(null);
            }
            setCurrentSessionId(resumedSession.id);
            currentSessionIdRef.current = resumedSession.id;
            syncNewSessionProvider(sessionProvider);

            // Let the backend know which session is currently focused
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
          syncNewSessionProvider(msg.provider);
          setSessions(prev => prev.map(s => {
            if (s.id === msg.oldSessionId) {
              return {
                ...s,
                id: msg.newSessionId,
                title: msg.title || s.title,
                provider: msg.provider || s.provider
              };
            }
            return s;
          }));
          // Update projectSessions as well
          setProjectSessions(prev => {
            const updated: Record<string, ChatSession[]> = {};
            for (const [projectId, sessions] of Object.entries(prev)) {
              updated[projectId] = sessions.map(s => {
                if (s.id === msg.oldSessionId) {
                  return {
                    ...s,
                    id: msg.newSessionId,
                    title: msg.title || s.title,
                    provider: msg.provider || s.provider
                  };
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
          setRunningSessionsInfo(prev => {
            if (!prev.has(msg.oldSessionId)) {
              return prev;
            }

            const next = new Map(prev);
            const info = next.get(msg.oldSessionId);
            next.delete(msg.oldSessionId);
            if (info) {
              next.set(msg.newSessionId, {
                ...info,
                title: msg.title || info.title,
                provider: msg.provider || info.provider
              });
            }
            return next;
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
      clearUiPreferencesTimeout();
      setIsConnected(false);
      setIsConnecting(false);
      setProcessPreferencesLoaded(false);
      setProcessPreferencesSaving(false);
      console.log('WebSocket disconnected');
    };

    newWs.onerror = (error) => {
      clearUiPreferencesTimeout();
      console.error('WebSocket error:', error);
      setIsConnecting(false);
      setIsConnected(false);
      setProcessPreferencesLoaded(false);
      setProcessPreferencesSaving(false);
    };

    wsRef.current = newWs;
    setWs(newWs);
  }, [clearUiPreferencesTimeout, requestUiPreferences, serverUrl, token, ws]);

  const disconnect = useCallback(() => {
    clearUiPreferencesTimeout();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWs(null);
    }
    setIsConnected(false);
    setProcessPreferencesLoaded(false);
    setProcessPreferencesSaving(false);
  }, [clearUiPreferencesTimeout]);

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
  const createNewSession = (provider: Provider = newSessionProvider, title?: string) => {
    if (wsRef.current && isConnected) {
      syncNewSessionProvider(provider);
      wsRef.current.send(JSON.stringify({
        type: 'session',
        action: 'new',
        provider,
        ...(title ? { title } : {})
      }));
    }
  };

  // Resume existing session (supports cross-project)
  const resumeSession = (sessionId: string, projectId?: string, provider?: Provider) => {
    console.log('[resumeSession] Called with sessionId:', sessionId, 'projectId:', projectId, 'isConnected:', isConnected);
    if (wsRef.current && isConnected) {
      const resolvedProvider = provider || resolveSessionProvider(sessionId, projectId);
      syncNewSessionProvider(resolvedProvider);
      const msg: any = {
        type: 'session',
        action: 'resume',
        sessionId,
        provider: resolvedProvider
      };
      if (projectId) {
        msg.projectId = projectId;
      }
      console.log('[resumeSession] Sending resume message:', msg);
      wsRef.current.send(JSON.stringify(msg));

      // Let the backend know which session is currently focused
      wsRef.current.send(JSON.stringify({
        type: 'session_focus',
        sessionId: sessionId
      }));
    } else {
      console.warn('[resumeSession] Cannot resume - WebSocket not connected');
    }
  };

  // Delete session (supports cross-project)
  const deleteSessionById = (sessionId: string, projectId?: string, provider?: Provider) => {
    if (wsRef.current && isConnected) {
      const msg: any = {
        type: 'session',
        action: 'delete',
        sessionId,
        provider: provider || resolveSessionProvider(sessionId, projectId)
      };
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
  const pendingHostSessionRef = useRef<{ title: string; fullRecord: string; provider: Provider } | null>(null);
  const discussionMainSessionRef = useRef<{ sessionId: string; projectId?: string | null; provider: Provider } | null>(null);

  function sendMessageToSpecificSession(
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options?: { projectId?: string | null; provider?: Provider }
  ): boolean {
    const activeWs = wsRef.current;
    if (!activeWs || !isConnected) {
      console.log('[sendMessageToSpecificSession] WebSocket not ready');
      return false;
    }

    const projectId = options?.projectId ?? null;
    const provider = options?.provider || resolveSessionProvider(sessionId, projectId, currentProvider);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments,
      status: 'sent'
    };

    const aiMessage: Message = {
      id: Math.random().toString(36).substring(7),
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

      return [{
        id: sessionId,
        title: text.substring(0, 30),
        messages: [userMessage, aiMessage],
        createdAt: Date.now(),
        provider
      }, ...prev];
    });

    if (projectId) {
      setProjectSessions(prev => {
        const projectList = prev[projectId] || [];
        const sessionExists = projectList.find(s => s.id === sessionId);
        if (sessionExists) {
          return {
            ...prev,
            [projectId]: projectList.map(s =>
              s.id === sessionId ? { ...s, messages: [...s.messages, userMessage, aiMessage] } : s
            )
          };
        }

        return {
          ...prev,
          [projectId]: [{
            id: sessionId,
            title: text.substring(0, 30),
            messages: [userMessage, aiMessage],
            createdAt: Date.now(),
            provider
          }, ...projectList]
        };
      });
    }

    setRunningSessions(prev => new Set(prev).add(sessionId));
    setRunningSessionsInfo(prev => {
      const next = new Map(prev);
      next.set(sessionId, {
        title: text.substring(0, 30),
        projectId: projectId || undefined,
        provider
      });
      return next;
    });

    const message: any = {
      type: 'claude',
      content: text,
      stream: true,
      sessionId,
      provider,
      timestamp: Date.now()
    };

    if (attachments.length > 0) {
      message.attachments = attachments.map(att => ({
        id: att.id,
        name: att.name,
        type: att.type,
        data: att.data
      }));
    }

    if (projectId) {
      message.projectId = projectId;
    }

    console.log('[sendMessageToSpecificSession] Sending message:', JSON.stringify(message));
    activeWs.send(JSON.stringify(message));
    return true;
  }

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

      // Ensure there is a host session before starting the discussion flow
      if (!currentSessionIdRef.current) {
        console.log('[handleSend] No current session for discussion, creating one...');
        pendingMessageRef.current = { text, attachments: [] };
        createNewSession(newSessionProvider);
        // The pending message will be re-sent once the session is created.
        // Returning here avoids double-sending before that session exists.
        return;
      }

      const sessionId = currentSessionIdRef.current;
      const provider = resolveSessionProvider(sessionId, currentProjectId, currentProvider);

      // Optimistically add the user message to the UI
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        status: 'sent'
      };

      // Update the top-level session list
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
          createdAt: Date.now(),
          provider
        }, ...prev];
      });

      // Update the active project's session list
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
              createdAt: Date.now(),
              provider
            }, ...projectList]
          };
        });
      }

      // Scroll to the latest message after appending
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);

      // Start the discussion workflow
      discussionMainSessionRef.current = {
        sessionId,
        projectId: currentProjectId,
        provider
      };
      discussion.startDiscussion(text, { maxRounds: 3 });
      return;
    }

    // If no current session, create one first and queue the message
    if (!currentSessionIdRef.current) {
      console.log('No current session, creating one...');
      pendingMessageRef.current = { text, attachments };
      createNewSession(newSessionProvider);
      return;
    }

    const sessionId = currentSessionIdRef.current;
    const provider = resolveSessionProvider(sessionId, currentProjectId, currentProvider);

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
        createdAt: Date.now(),
        provider
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
            createdAt: Date.now(),
            provider
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
      next.set(sessionId, { title: text.substring(0, 30), projectId: currentProjectId || undefined, provider });
      return next;
    });

    console.log('Sending message to WebSocket, sessionId:', sessionId, 'projectId:', currentProjectId);

    // Send to WebSocket with session info
    const message: any = {
      type: 'claude',
      content: text,
      stream: true,
      sessionId,
      provider,
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
    createNewSession(newSessionProvider);
    setIsSidebarOpen(false);
  };

  const handleTitleChange = (newTitle: string) => {
    if (!currentSessionId) return;
    setSessions(prev => prev.map(s =>
      s.id === currentSessionId ? { ...s, title: newTitle } : s
    ));
  };

  // Persist title changes back to the server
  const handleTitleBlur = (newTitle: string) => {
    if (!currentSessionId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'session',
      action: 'rename',
      sessionId: currentSessionId,
      title: newTitle,
      projectId: currentProjectId,
      provider: currentSession?.provider,
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
        currentProvider={currentProvider}
        newSessionProvider={newSessionProvider}
        onNewSessionProviderChange={setNewSessionProvider}
      />

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 top-[50px] bottom-0 z-[55] overflow-hidden border-b border-white/10 bg-black/55 backdrop-blur-xl settings-panel"
          >
            <div
              className="h-full overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+12px)] touch-pan-y"
              style={{ WebkitOverflowScrolling: 'touch' }}
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
                processPanelPreferences={uiPreferences.processPanel}
                processPreferencesLoaded={processPreferencesLoaded}
                processPreferencesSaving={processPreferencesSaving}
                onProcessPanelPreferenceChange={handleProcessPanelPreferenceChange}
              />
            </div>
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
                        <span className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                          getProviderBadgeClass(project.provider)
                        )}>
                          {getProviderLabel(project.provider)}
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
                              const hasRenderableResult = sessionHasRenderableResult(session.id, project.id, session);
                              const isCompleted = completedSessions.has(session.id) && hasRenderableResult;
                              // Debug: always log for troubleshooting
                              if (runningSessions.size > 0 || completedSessions.size > 0) {
                                console.log('[Sidebar] Checking session:', session.id.substring(0, 12),
                                  'running:', isRunning, 'completed:', isCompleted, 'hasResult:', hasRenderableResult,
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
                                    resumeSession(session.id, project.id, session.provider);
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
                                        Running
                                      </span>
                                    ) : isCompleted ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-green-400 flex-shrink-0 whitespace-nowrap">
                                        Completed
                                      </span>
                                    ) : null}
                                    <span className="truncate flex items-center gap-1 min-w-0 flex-1">
                                      <FileText size={12} className="inline opacity-50 flex-shrink-0" />
                                      <span className="truncate">{normalizeLegacyDisplayText(session.title)}</span>
                                    </span>
                                  </div>
                                  <div className="text-white/30 text-[10px] font-mono truncate mt-0.5">
                                    {session.id.substring(0, 8)}...
                                  </div>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSessionById(session.id, project.id, session.provider);
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
            {/* Running task list */}
            {runningSessions.size > 0 && (
              <div className="w-full max-w-md mb-6 space-y-2">
                {Array.from(runningSessions).map(sessionId => {
                  // Prefer the live running-session metadata, then fall back to cached sessions
                  const infoFromMap = runningSessionsInfo.get(sessionId);
                  let title = infoFromMap?.title;
                  let projectId = infoFromMap?.projectId;
                  let provider = infoFromMap?.provider;

                  // Recover missing title or project info from the session caches
                  if (!title || !projectId) {
                    const sessionInfo = sessions.find(s => s.id === sessionId);
                    if (sessionInfo) {
                      if (!title) title = sessionInfo.title;
                      if (!provider) provider = sessionInfo.provider;
                    }
                    // Search project sessions for the missing project ID or title
                    if (!projectId || !title) {
                      for (const [pid, sessionList] of Object.entries(projectSessions)) {
                        const found = sessionList.find(s => s.id === sessionId);
                        if (found) {
                          if (!title) title = found.title;
                          if (!projectId) projectId = pid;
                          if (!provider) provider = found.provider;
                          break;
                        }
                      }
                    }
                  }

                  // Fall back to a shortened session ID when no title is available
                  const displayTitle = normalizeLegacyDisplayText(title || sessionId.substring(0, 12));

                  return (
                    <motion.div
                      key={sessionId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-3 bg-gradient-to-r from-accent/10 to-purple-500/10 rounded-xl border border-accent/20 cursor-pointer hover:border-accent/40 transition-colors"
                      onClick={() => {
                        console.log('[RunningTaskCard] Clicked session:', sessionId, 'projectId:', projectId);
                        // Resume the selected running session
                        resumeSession(sessionId, projectId, provider);
                        setIsSidebarOpen(false);
                        // Clear the completed badge once the session is opened
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
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-white truncate">{displayTitle}</div>
                          {provider && (
                            <span className={cn(
                              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                              getProviderBadgeClass(provider)
                            )}>
                              {getProviderLabel(provider)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/50">Running · Tap to view</div>
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
              Connect to your development environment and control Claude Code or Codex CLI from anywhere.
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
              // Always keep the actively streaming message visible
              if (msg.status === 'sending') return true;

              // Drop empty messages that contain neither content nor thinking
              const normalizedContent = normalizeLegacyDisplayText(msg.content);
              const normalizedThinking = normalizeLegacyDisplayText(msg.thinking);
              const hasContent = normalizedContent.trim() !== '';
              const hasThinking = normalizedThinking.trim() !== '';
              const hasProcess = !!filterProcessForDisplay(msg.process, uiPreferences.processPanel)?.events?.length;

              // Detect legacy thinking text embedded directly into content
              const hasThinkingInContent = (
                normalizedContent.includes('<thinking>') ||
                normalizedContent.includes('Thinking...')
              );

              if (!hasContent && !hasThinking && !hasThinkingInContent && !hasProcess) return false;

              // Hide messages that only contain a closed thinking block and no process data
              const thinkingRegex = /^<thinking>[\s\S]*<\/thinking>\s*$/;
              if (thinkingRegex.test(normalizedContent.trim()) && !hasProcess) return false;

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
              processPanelPreferences={uiPreferences.processPanel}
            />
          ))
        )}

      {/* Loading indicator while the active provider is processing */}
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
                  <span className="text-sm font-medium text-white">{getProviderLabel(currentProvider)} is processing...</span>
                  {serverLogs.length > 0 && (
                    <span className="text-xs text-white/50 truncate">
                      {normalizeLegacyDisplayText(serverLogs[serverLogs.length - 1].message)}
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
