import { Message, MessageProcess, MessageProcessEvent, ProcessPanelPreferences, Provider, ToolUse } from './types';
import type { TranslateFn } from './i18n';

export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex'
};

export const RECONNECTING_AFTER_REFRESH_STATUS_LABEL = 'Reconnecting after refresh';
export const RESTORED_RUNNING_STATUS_LABEL = 'Restored after refresh. Waiting for the next live update...';

const translateOrFallback = (
  translate: TranslateFn | undefined,
  key: Parameters<TranslateFn>[0],
  fallback: string,
  params?: Record<string, string | number>
): string => translate ? translate(key, params) : fallback;

export const getProviderLabel = (provider?: Provider, translate?: TranslateFn): string => {
  const safeProvider = provider || 'claude';

  return safeProvider === 'codex'
    ? translateOrFallback(translate, 'provider.codex', PROVIDER_LABELS.codex)
    : translateOrFallback(translate, 'provider.claude', PROVIDER_LABELS.claude);
};

export const getReconnectPlaceholderContent = (
  provider: Provider = 'claude',
  translate?: TranslateFn
): string => (
  translateOrFallback(
    translate,
    'system.reconnectPlaceholderContent',
    `${getProviderLabel(provider)} is still running. Restoring live progress after refresh...`,
    { provider: getProviderLabel(provider, translate) }
  )
);

export const localizeSessionTitle = (title: string, translate?: TranslateFn): string => (
  title === 'New Chat'
    ? translateOrFallback(translate, 'session.defaultTitle', title)
    : normalizeLegacyDisplayText(title)
);

export const localizeProcessStatusText = (label: string, translate?: TranslateFn): string => {
  if (label === RECONNECTING_AFTER_REFRESH_STATUS_LABEL) {
    return translateOrFallback(translate, 'system.reconnectingAfterRefresh', label);
  }

  if (label === RESTORED_RUNNING_STATUS_LABEL) {
    return translateOrFallback(translate, 'system.restoredAfterRefresh', label);
  }

  const startedWorkingMatch = label.match(/^(Claude|Codex) started working$/);
  if (startedWorkingMatch) {
    return translateOrFallback(
      translate,
      'system.providerStartedWorking',
      label,
      { provider: startedWorkingMatch[1] }
    );
  }

  return label;
};

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

export const normalizeLegacyDisplayText = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  return LEGACY_MOJIBAKE_REPLACEMENTS.reduce(
    (result, [needle, replacement]) => result.replaceAll(needle, replacement),
    value
  );
};

export const getProviderBadgeClass = (provider?: Provider): string => (
  provider === 'codex'
    ? 'border-sky-400/20 bg-sky-500/15 text-sky-200'
    : 'border-orange-400/20 bg-orange-500/15 text-orange-200'
);

export const getProcessPanelSettingOptions = (translate?: TranslateFn): Array<{
  key: keyof ProcessPanelPreferences;
  title: string;
  description: string;
  badge: string;
  accentClass: string;
}> => [
  {
    key: 'showStatus',
    title: translateOrFallback(translate, 'settings.process.option.status.title', 'Status'),
    description: translateOrFallback(translate, 'settings.process.option.status.description', 'Started, reasoning, completed and other lifecycle updates.'),
    badge: translateOrFallback(translate, 'settings.process.option.status.badge', 'Status'),
    accentClass: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
  },
  {
    key: 'showLog',
    title: translateOrFallback(translate, 'settings.process.option.log.title', 'Log'),
    description: translateOrFallback(translate, 'settings.process.option.log.description', 'Commentary and runtime log lines emitted while the model works.'),
    badge: translateOrFallback(translate, 'settings.process.option.log.badge', 'Log'),
    accentClass: 'border-amber-400/20 bg-amber-500/10 text-amber-200'
  },
  {
    key: 'showTool',
    title: translateOrFallback(translate, 'settings.process.option.tool.title', 'Tool'),
    description: translateOrFallback(translate, 'settings.process.option.tool.description', 'Includes both tool calls and tool results in one switch.'),
    badge: translateOrFallback(translate, 'settings.process.option.tool.badge', 'Tool'),
    accentClass: 'border-sky-400/20 bg-sky-500/10 text-sky-200'
  }
];

export const PROCESS_PANEL_SETTING_OPTIONS = getProcessPanelSettingOptions();

export const formatToolCall = (toolName: string, toolInput?: Record<string, unknown>): string => {
  if (!toolInput) {
    return toolName;
  }

  const getFileName = (path: string): string => {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map(v => formatValue(v)).join(', ');
    }

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
        const truncated = cmd.length > 60 ? `${cmd.substring(0, 60)}...` : cmd;
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
        const truncated = formatted.length > 50 ? `${formatted.substring(0, 50)}...` : formatted;
        return `${toolName}(${truncated})`;
      }
      return toolName;
    }
  }
};

export const createMessageProcess = (
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

export const appendMessageProcessEvent = (
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

export const setMessageProcessState = (
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

export const createStreamingModelMessage = (provider: Provider, timestamp: number): Message => ({
  id: `${provider}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
  role: 'model',
  content: '',
  timestamp,
  status: 'sending'
});

export const createReconnectedRunningMessage = (provider: Provider, timestamp: number): Message => ({
  ...createStreamingModelMessage(provider, timestamp),
  process: appendMessageProcessEvent(undefined, provider, {
    type: 'status',
    label: RESTORED_RUNNING_STATUS_LABEL,
    timestamp
  })
});

export const updateRunningModelMessage = (
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

type ToolEventPayload = {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  result?: string;
  isError?: boolean;
};

export const upsertToolRecord = (
  tools: ToolUse[] | undefined,
  event: ToolEventPayload,
  timestamp: number
): ToolUse[] | undefined => {
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

export const PROCESS_STATE_LABELS: Record<MessageProcess['state'], string> = {
  running: 'Running',
  completed: 'Completed',
  error: 'Error'
};

export const getProcessStateLabel = (
  state: MessageProcess['state'],
  translate?: TranslateFn
): string => {
  switch (state) {
    case 'completed':
      return translateOrFallback(translate, 'process.state.completed', PROCESS_STATE_LABELS.completed);
    case 'error':
      return translateOrFallback(translate, 'process.state.error', PROCESS_STATE_LABELS.error);
    case 'running':
    default:
      return translateOrFallback(translate, 'process.state.running', PROCESS_STATE_LABELS.running);
  }
};

export const getProcessStateBadgeClass = (state: MessageProcess['state']): string => (
  state === 'error'
    ? 'border-red-400/20 bg-red-500/10 text-red-200'
    : state === 'completed'
      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
      : 'border-sky-400/20 bg-sky-500/10 text-sky-200'
);

export const getProcessEventDotClass = (event: MessageProcessEvent): string => {
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

export const getProcessEventLabel = (event: MessageProcessEvent, translate?: TranslateFn): string => {
  switch (event.type) {
    case 'status':
      return translateOrFallback(translate, 'process.event.status', 'Status');
    case 'log':
      return event.level === 'debug'
        ? translateOrFallback(translate, 'process.event.debug', 'Debug')
        : event.level === 'warn'
          ? translateOrFallback(translate, 'process.event.warning', 'Warning')
          : event.level === 'error'
            ? getProcessStateLabel('error', translate)
            : translateOrFallback(translate, 'process.event.log', 'Log');
    case 'tool_use':
      return translateOrFallback(translate, 'process.event.tool', 'Tool');
    case 'tool_result':
      return event.isError
        ? translateOrFallback(translate, 'process.event.toolError', 'Tool Error')
        : translateOrFallback(translate, 'process.event.toolResult', 'Tool Result');
    default:
      return translateOrFallback(translate, 'process.event.fallback', 'Process');
  }
};

export const getProcessEventSummary = (event: MessageProcessEvent, translate?: TranslateFn): string => {
  switch (event.type) {
    case 'status':
      return localizeProcessStatusText(event.label, translate);
    case 'log':
      return event.message;
    case 'tool_use':
      return formatToolCall(event.toolName, event.toolInput);
    case 'tool_result':
      return event.isError
        ? translateOrFallback(translate, 'process.summary.toolError', 'Tool returned an error')
        : translateOrFallback(translate, 'process.summary.toolResult', 'Tool returned output');
    default:
      return '';
  }
};
