import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Language } from './types';

export const LANGUAGE_STORAGE_KEY = 'coderemote_language';
export const SUPPORTED_LANGUAGES: Language[] = ['zh-CN', 'en-US'];

export type TranslationParams = Record<string, string | number>;

const messages = {
  'en-US': {
    'provider.claude': 'Claude',
    'provider.codex': 'Codex',

    'common.connect': 'Connect',
    'common.disconnect': 'Disconnect',
    'common.connected': 'Connected',
    'common.connecting': 'Connecting...',
    'common.disconnected': 'Disconnected',
    'common.loading': 'Loading...',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.download': 'Download',
    'common.close': 'Close',
    'common.done': 'Done',
    'common.saveAndApply': 'Save and apply',
    'common.on': 'On',
    'common.off': 'Off',
    'common.history': 'History',
    'common.newChat': 'New Chat',
    'common.noSessions': 'No sessions',
    'common.refreshProjects': 'Refresh projects',
    'common.deleteSession': 'Delete session',
    'common.baseUrl': 'Base URL',
    'common.webSocketUrl': 'WebSocket URL',
    'common.token': 'Token',
    'common.auth': 'Auth',
    'common.authToken': 'Auth Token',
    'common.model': 'Model',
    'common.language': 'Language',
    'common.offline': 'Offline',
    'common.pendingSync': 'Pending sync',
    'common.workspaceSynced': 'Workspace synced',
    'common.code': 'code',
    'common.unknownModel': 'Unknown model',
    'common.unknownError': 'Unknown error',

    'header.newProviderSession': 'New {provider} session',
    'header.testModeBadge': 'Test · {ownerId}',

    'session.defaultTitle': 'New Chat',

    'settings.bridge.title': 'Bridge Connection',
    'settings.bridge.subtitle': 'Local CLI transport for Claude and Codex sessions',
    'settings.bridge.description': 'This connection also carries synced UI preferences for the current workspace.',
    'settings.bridge.connected': 'Connected',
    'settings.bridge.disconnected': 'Disconnected',
    'settings.bridge.urlReady': 'URL ready',
    'settings.bridge.urlMissing': 'URL missing',
    'settings.bridge.tokenReady': 'Token ready',
    'settings.bridge.tokenMissing': 'Token missing',
    'settings.bridge.urlPlaceholder': 'WebSocket URL (ws://...)',
    'settings.access.testerBadge': 'Tester · {ownerId}',
    'settings.access.testerNotice': 'Connected in tester mode as {ownerId}. You can only view and manage your own test sessions. Shared runtime and workspace settings are hidden.',

    'settings.runtime.title': 'Runtime Profile',
    'settings.runtime.subtitle': 'Manage local Claude and Codex runtime settings',
    'settings.runtime.description': 'Sessions keep their provider, but this panel lets you switch or edit the local runtime configuration for either CLI.',
    'settings.runtime.unknownModel': 'Unknown model',
    'settings.runtime.valuesSuffix': ' · {count} values',
    'settings.runtime.summaryFallback': 'Load a saved {provider} profile or edit the active local configuration.',
    'settings.runtime.empty.codex': 'No saved Codex profiles found. Manual override edits the active local Codex configuration.',
    'settings.runtime.empty.claude': 'No saved Claude profiles found.',
    'settings.runtime.loadingProfiles': 'Loading {provider} profiles...',
    'settings.runtime.selectProfile': 'Select {provider} profile',
    'settings.runtime.authTokenConfigured': 'Auth token configured',
    'settings.runtime.tokenConfigured': 'Token configured',
    'settings.runtime.manualOverride': 'Manual override',
    'settings.runtime.closeEditor': 'Close editor',
    'settings.runtime.manualOverrideTitle': 'Manual Override',
    'settings.runtime.manualOverrideDescription': 'Edit the active {provider} configuration. Leave the auth token blank to keep the current token.',
    'settings.runtime.connectBeforeSwitch': 'Connect to the server before switching runtime profiles.',
    'settings.runtime.connectBeforeEdit': 'Connect to the server before editing runtime profiles.',
    'settings.runtime.error': 'Runtime profile error: {error}',

    'settings.language.title': 'Language',
    'settings.language.subtitle': 'Choose the UI language for this device',
    'settings.language.description': 'Only fixed UI text and locally generated status text are translated. Model replies, tool output, and backend raw logs stay unchanged.',
    'settings.language.option.zh-CN': '简体中文',
    'settings.language.option.en-US': 'English',

    'settings.process.title': 'Process Panel',
    'settings.process.subtitle': 'Choose which process channels are visible',
    'settings.process.status.syncing': 'Syncing preferences to the current workspace...',
    'settings.process.status.synced': 'Synced across devices for this workspace.',
    'settings.process.status.loading': 'Using current values while sync finishes.',
    'settings.process.status.offline': 'Connect to load synced workspace preferences.',
    'settings.process.option.status.title': 'Status',
    'settings.process.option.status.description': 'Started, reasoning, completed and other lifecycle updates.',
    'settings.process.option.status.badge': 'Status',
    'settings.process.option.log.title': 'Log',
    'settings.process.option.log.description': 'Commentary and runtime log lines emitted while the model works.',
    'settings.process.option.log.badge': 'Log',
    'settings.process.option.tool.title': 'Tool',
    'settings.process.option.tool.description': 'Includes both tool calls and tool results in one switch.',
    'settings.process.option.tool.badge': 'Tool',
    'settings.process.note': '`Status` covers lifecycle updates. `Log` covers commentary and runtime logs. `Tool` combines both `tool_use` and `tool_result`.',
    'settings.process.saveTimeout': 'Saving process panel preferences timed out. Restart the backend so it picks up the new UI preferences API.',
    'settings.process.connectBeforeChange': 'Connect to the server before changing synced process panel preferences.',
    'settings.process.saveFailed': 'Failed to save process panel preferences: {error}',

    'sidebar.runningNow': 'Running Now',
    'sidebar.noProjects.connected': 'No saved projects found yet',
    'sidebar.noProjects.disconnected': 'Connect to view history',
    'sidebar.loadingProjects': 'Loading...',
    'sidebar.runningTapToView': 'Running · Tap to view',

    'empty.description': 'Connect to your development environment and control Claude Code or Codex CLI from anywhere.',
    'empty.commands': 'Commands: /read, /ls, /glob, /grep, /help',

    'messages.loadEarlier': 'Load earlier messages ({count} more)',

    'stream.processingProvider': '{provider} is processing...',

    'input.placeholder.connected': 'Message... (/ for commands, @ for multi-agent discussion)',
    'input.placeholder.disconnected': 'Connect to start...',
    'input.listening': 'Listening...',
    'input.filePreviewAlt': 'preview',
    'input.skills.title': 'Select a skill',
    'input.skills.empty': 'No matching skills found',
    'input.agents.title': '@ Choose agents (multi-select)',
    'input.agents.empty': 'No matching agents found',
    'input.skill.gitCommit.name': 'Git Commit',
    'input.skill.gitCommit.description': 'Create and push a git commit',
    'input.skill.createReadme.name': 'Create README',
    'input.skill.createReadme.description': 'Generate a project README',
    'input.skill.simplify.name': 'Simplify Code',
    'input.skill.simplify.description': 'Refactor and simplify code',
    'input.skill.brainstorm.name': 'Brainstorm',
    'input.skill.brainstorm.description': 'Explore ideas for a new feature',
    'input.agent.codeReviewer.name': 'Code Reviewer',
    'input.agent.codeReviewer.description': 'Code quality, bugs, and best practices',
    'input.agent.architect.name': 'Architect',
    'input.agent.architect.description': 'System design and architecture decisions',
    'input.agent.tester.name': 'Tester',
    'input.agent.tester.description': 'Coverage, edge cases, and validation',
    'input.agent.security.name': 'Security',
    'input.agent.security.description': 'Security risks and authentication flows',
    'input.agent.performance.name': 'Performance',
    'input.agent.performance.description': 'Performance bottlenecks and optimization',
    'input.agent.product.name': 'Product',
    'input.agent.product.description': 'Requirements and user experience',
    'input.agent.devops.name': 'DevOps',
    'input.agent.devops.description': 'Deployment, monitoring, and CI/CD',

    'bubble.process': 'Process',
    'bubble.thinkingProcess': 'Thinking Process',
    'bubble.agentFallbackName': 'Agent',
    'bubble.mermaid.rendering': 'Rendering diagram...',
    'bubble.mermaid.failed': 'Failed to render diagram.',
    'bubble.filePreviewLoading': 'Loading preview...',
    'bubble.filePreviewFailed': 'Failed to load preview: {error}',
    'bubble.suggestions': 'Suggestions',

    'system.reconnectingAfterRefresh': 'Reconnecting after refresh',
    'system.restoredAfterRefresh': 'Restored after refresh. Waiting for the next live update...',
    'system.reconnectPlaceholderContent': '{provider} is still running. Restoring live progress after refresh...',
    'system.providerStartedWorking': '{provider} started working',

    'process.state.running': 'Running',
    'process.state.completed': 'Completed',
    'process.state.error': 'Error',
    'process.event.status': 'Status',
    'process.event.debug': 'Debug',
    'process.event.warning': 'Warning',
    'process.event.log': 'Log',
    'process.event.tool': 'Tool',
    'process.event.toolError': 'Tool Error',
    'process.event.toolResult': 'Tool Result',
    'process.event.fallback': 'Process',
    'process.summary.toolError': 'Tool returned an error',
    'process.summary.toolResult': 'Tool returned output'
  },
  'zh-CN': {
    'provider.claude': 'Claude',
    'provider.codex': 'Codex',

    'common.connect': '连接',
    'common.disconnect': '断开连接',
    'common.connected': '已连接',
    'common.connecting': '连接中...',
    'common.disconnected': '未连接',
    'common.loading': '加载中...',
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.done': '完成',
    'common.saveAndApply': '保存并应用',
    'common.on': '开启',
    'common.off': '关闭',
    'common.history': '历史记录',
    'common.newChat': '新会话',
    'common.noSessions': '没有会话',
    'common.refreshProjects': '刷新项目',
    'common.deleteSession': '删除会话',
    'common.baseUrl': 'Base URL',
    'common.webSocketUrl': 'WebSocket 地址',
    'common.token': '令牌',
    'common.auth': '认证',
    'common.authToken': '认证令牌',
    'common.model': '模型',
    'common.language': '语言',
    'common.offline': '离线',
    'common.pendingSync': '等待同步',
    'common.workspaceSynced': '工作区已同步',
    'common.code': '代码',
    'common.unknownModel': '未知模型',
    'common.unknownError': '未知错误',

    'header.newProviderSession': '新建 {provider} 会话',
    'header.testModeBadge': '测试 · {ownerId}',

    'session.defaultTitle': '新会话',

    'settings.bridge.title': '桥接连接',
    'settings.bridge.subtitle': 'Claude 与 Codex 会话的本地 CLI 传输通道',
    'settings.bridge.description': '这个连接也会承载当前工作区的已同步 UI 偏好设置。',
    'settings.bridge.connected': '已连接',
    'settings.bridge.disconnected': '未连接',
    'settings.bridge.urlReady': 'URL 已就绪',
    'settings.bridge.urlMissing': 'URL 缺失',
    'settings.bridge.tokenReady': '令牌已就绪',
    'settings.bridge.tokenMissing': '令牌缺失',
    'settings.bridge.urlPlaceholder': 'WebSocket 地址 (ws://...)',
    'settings.access.testerBadge': '测试用户 · {ownerId}',
    'settings.access.testerNotice': '当前以测试模式连接，身份为 {ownerId}。你只能查看和管理自己的测试会话，共享运行配置和工作区设置已被隐藏。',

    'settings.runtime.title': '运行配置',
    'settings.runtime.subtitle': '管理本地 Claude 与 Codex 运行时设置',
    'settings.runtime.description': '每个会话会固定自己的 provider，但这里可以切换或编辑任一 CLI 的本地运行配置。',
    'settings.runtime.unknownModel': '未知模型',
    'settings.runtime.valuesSuffix': ' · {count} 项',
    'settings.runtime.summaryFallback': '加载已保存的 {provider} 配置，或编辑当前生效的本地配置。',
    'settings.runtime.empty.codex': '没有找到已保存的 Codex 配置。手动覆盖会直接编辑当前生效的本地 Codex 配置。',
    'settings.runtime.empty.claude': '没有找到已保存的 Claude 配置。',
    'settings.runtime.loadingProfiles': '正在加载 {provider} 配置...',
    'settings.runtime.selectProfile': '选择 {provider} 配置',
    'settings.runtime.authTokenConfigured': '已配置认证令牌',
    'settings.runtime.tokenConfigured': '已配置令牌',
    'settings.runtime.manualOverride': '手动覆盖',
    'settings.runtime.closeEditor': '关闭编辑器',
    'settings.runtime.manualOverrideTitle': '手动覆盖',
    'settings.runtime.manualOverrideDescription': '编辑当前生效的 {provider} 配置。认证令牌留空时会保留现有令牌。',
    'settings.runtime.connectBeforeSwitch': '切换运行配置前，请先连接到服务端。',
    'settings.runtime.connectBeforeEdit': '编辑运行配置前，请先连接到服务端。',
    'settings.runtime.error': '运行配置错误：{error}',

    'settings.language.title': '语言',
    'settings.language.subtitle': '选择当前设备上的界面语言',
    'settings.language.description': '只翻译固定 UI 文案和本地生成的状态文案。模型回复、工具输出和后端原始日志保持不变。',
    'settings.language.option.zh-CN': '简体中文',
    'settings.language.option.en-US': 'English',

    'settings.process.title': '过程面板',
    'settings.process.subtitle': '选择要显示的过程通道',
    'settings.process.status.syncing': '正在将偏好同步到当前工作区...',
    'settings.process.status.synced': '当前工作区已在多设备间同步。',
    'settings.process.status.loading': '同步完成前先使用当前值。',
    'settings.process.status.offline': '连接后才能加载工作区同步偏好。',
    'settings.process.option.status.title': '状态',
    'settings.process.option.status.description': '开始、推理、完成等生命周期更新。',
    'settings.process.option.status.badge': '状态',
    'settings.process.option.log.title': '日志',
    'settings.process.option.log.description': '模型执行期间发出的 commentary 和运行日志。',
    'settings.process.option.log.badge': '日志',
    'settings.process.option.tool.title': '工具',
    'settings.process.option.tool.description': '一个开关同时控制工具调用和工具结果。',
    'settings.process.option.tool.badge': '工具',
    'settings.process.note': '`Status` 用于生命周期更新，`Log` 用于 commentary 和运行日志，`Tool` 同时包含 `tool_use` 与 `tool_result`。',
    'settings.process.saveTimeout': '保存过程面板偏好超时了。请重启后端，让它加载新的 UI 偏好 API。',
    'settings.process.connectBeforeChange': '修改已同步的过程面板偏好前，请先连接到服务端。',
    'settings.process.saveFailed': '保存过程面板偏好失败：{error}',

    'sidebar.runningNow': '当前运行中',
    'sidebar.noProjects.connected': '暂时还没有已保存的项目',
    'sidebar.noProjects.disconnected': '连接后查看历史',
    'sidebar.loadingProjects': '加载中...',
    'sidebar.runningTapToView': '运行中 · 点击查看',

    'empty.description': '连接到你的开发环境，随时随地控制 Claude Code 或 Codex CLI。',
    'empty.commands': '命令：/read, /ls, /glob, /grep, /help',

    'messages.loadEarlier': '加载更早的消息（还有 {count} 条）',

    'stream.processingProvider': '{provider} 正在处理中...',

    'input.placeholder.connected': '输入消息...（`/` 打开命令，`@` 发起多智能体讨论）',
    'input.placeholder.disconnected': '连接后开始...',
    'input.listening': '正在监听...',
    'input.filePreviewAlt': '预览',
    'input.skills.title': '选择一个技能',
    'input.skills.empty': '没有匹配的技能',
    'input.agents.title': '@ 选择智能体（可多选）',
    'input.agents.empty': '没有匹配的智能体',
    'input.skill.gitCommit.name': 'Git 提交',
    'input.skill.gitCommit.description': '创建并推送一个 git commit',
    'input.skill.createReadme.name': '生成 README',
    'input.skill.createReadme.description': '生成项目 README',
    'input.skill.simplify.name': '简化代码',
    'input.skill.simplify.description': '重构并简化代码',
    'input.skill.brainstorm.name': '头脑风暴',
    'input.skill.brainstorm.description': '探索新功能想法',
    'input.agent.codeReviewer.name': '代码审查',
    'input.agent.codeReviewer.description': '关注代码质量、缺陷和最佳实践',
    'input.agent.architect.name': '架构师',
    'input.agent.architect.description': '关注系统设计和架构决策',
    'input.agent.tester.name': '测试',
    'input.agent.tester.description': '关注覆盖率、边界情况和验证',
    'input.agent.security.name': '安全',
    'input.agent.security.description': '关注安全风险和认证流程',
    'input.agent.performance.name': '性能',
    'input.agent.performance.description': '关注性能瓶颈和优化',
    'input.agent.product.name': '产品',
    'input.agent.product.description': '关注需求和用户体验',
    'input.agent.devops.name': 'DevOps',
    'input.agent.devops.description': '关注部署、监控和 CI/CD',

    'bubble.process': '过程',
    'bubble.thinkingProcess': '思考过程',
    'bubble.agentFallbackName': '智能体',
    'bubble.mermaid.rendering': '正在渲染图表...',
    'bubble.mermaid.failed': '图表渲染失败。',
    'bubble.suggestions': '建议',

    'system.reconnectingAfterRefresh': '刷新后正在重新连接',
    'system.restoredAfterRefresh': '刷新后已恢复，等待下一条实时更新...',
    'system.reconnectPlaceholderContent': '{provider} 仍在运行中。刷新后正在恢复实时进度...',
    'system.providerStartedWorking': '{provider} 已开始处理',

    'process.state.running': '运行中',
    'process.state.completed': '已完成',
    'process.state.error': '错误',
    'process.event.status': '状态',
    'process.event.debug': '调试',
    'process.event.warning': '警告',
    'process.event.log': '日志',
    'process.event.tool': '工具',
    'process.event.toolError': '工具错误',
    'process.event.toolResult': '工具结果',
    'process.event.fallback': '过程',
    'process.summary.toolError': '工具返回了错误',
    'process.summary.toolResult': '工具返回了输出'
    , 'common.download': '\u4e0b\u8f7d',
    'common.close': '\u5173\u95ed',
    'bubble.filePreviewLoading': '\u6b63\u5728\u52a0\u8f7d\u9884\u89c8...',
    'bubble.filePreviewFailed': '\u9884\u89c8\u52a0\u8f7d\u5931\u8d25\uff1a{error}'
  }
} as const;

export type TranslationKey = keyof typeof messages['en-US'];
export type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const interpolate = (template: string, params?: TranslationParams): string => {
  if (!params) {
    return template;
  }

  return Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
};

const isLanguage = (value: string | null | undefined): value is Language => (
  value === 'zh-CN' || value === 'en-US'
);

export const translate = (
  language: Language,
  key: TranslationKey,
  params?: TranslationParams
): string => {
  const template = messages[language][key] || messages['en-US'][key] || key;
  return interpolate(template, params);
};

export const createTranslator = (language: Language): TranslateFn => {
  return (key, params) => translate(language, key, params);
};

export const loadStoredLanguage = (): Language | null => {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
};

export const detectBrowserLanguage = (browserLanguage?: string | null): Language => {
  const language = browserLanguage
    ?? (typeof navigator !== 'undefined' ? navigator.language : null);

  return typeof language === 'string' && language.toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : 'en-US';
};

export const resolveInitialLanguage = (
  storedLanguage?: string | null,
  browserLanguage?: string | null
): Language => (
  isLanguage(storedLanguage)
    ? storedLanguage
    : detectBrowserLanguage(browserLanguage)
);

export const persistLanguage = (language: Language): void => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage access errors.
  }
};

export const translateKnownLocalText = (value: string, language: Language): string => {
  if (value === 'New Chat') {
    return translate(language, 'session.defaultTitle');
  }

  if (value === 'Running · Tap to view') {
    return translate(language, 'sidebar.runningTapToView');
  }

  if (value === 'Choose agents (multi-select)') {
    return translate(language, 'input.agents.title').replace(/^@\s*/, '');
  }

  if (value === 'No matching agents found') {
    return translate(language, 'input.agents.empty');
  }

  if (value === 'No matching skills found') {
    return translate(language, 'input.skills.empty');
  }

  const reconnectMatch = value.match(/^(Claude|Codex) is still running\. Restoring live progress after refresh\.\.\.$/);
  if (reconnectMatch) {
    return translate(language, 'system.reconnectPlaceholderContent', {
      provider: reconnectMatch[1]
    });
  }

  const startedMatch = value.match(/^(Claude|Codex) started working$/);
  if (startedMatch) {
    return translate(language, 'system.providerStartedWorking', {
      provider: startedMatch[1]
    });
  }

  return value;
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const storedLanguage = typeof window !== 'undefined'
      ? window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
      : null;
    const browserLanguage = typeof navigator !== 'undefined'
      ? navigator.language
      : null;

    return resolveInitialLanguage(storedLanguage, browserLanguage);
  });

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    persistLanguage(nextLanguage);
  }, []);

  const t = useMemo(() => createTranslator(language), [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }

  return context;
};
