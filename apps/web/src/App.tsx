import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  X,
  Hash,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Wifi,
  WifiOff,
  Folder,
  FileText,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Message,
  Attachment,
  ChatSession,
  MessageProcessEvent,
  ProcessPanelPreferences,
  UiPreferences,
  Provider,
  ServerAccessState
} from './types';
import { cn } from './utils';
import { useDiscussion } from './useDiscussion';
import {
  DEFAULT_UI_PREFERENCES,
  filterProcessForDisplay,
  normalizeUiPreferences
} from './uiPreferences';
import {
  applyRuntimeProfileError,
  applyRuntimeProfileList,
  applyRuntimeProfileMutation,
  createEmptyRuntimeProfileForm,
  createRuntimeProfileFormFromProfile,
  createRuntimeProfilesState,
  RuntimeProfileForm,
  RuntimeProfileProviderState,
  RuntimeProfileSummary
} from './runtimeProfiles';
import { debugLog } from './debugLog';
import {
  appendMessageProcessEvent,
  createReconnectedRunningMessage,
  getProcessPanelSettingOptions,
  getProviderBadgeClass,
  getProviderLabel,
  localizeSessionTitle,
  normalizeLegacyDisplayText,
  setMessageProcessState,
  updateRunningModelMessage,
  upsertToolRecord
} from './chatUiShared';
import {
  ActiveRunningSessionCacheEntry,
  cacheRunningSessionEntry as cacheRunningSessionEntryStore,
  createReconnectPlaceholderSession as createReconnectPlaceholderSessionStore,
  loadActiveRunningSessionCache as loadActiveRunningSessionCacheStore,
  loadRunningSessionCache as loadRunningSessionCacheStore,
  removeCachedRunningSessionEntry as removeCachedRunningSessionEntryStore,
  RECONNECT_PLACEHOLDER_MESSAGE_PREFIX as RECONNECT_PLACEHOLDER_MESSAGE_PREFIX_STORE,
  RUNNING_SESSION_REHYDRATION_TIMEOUT_MS as RUNNING_SESSION_REHYDRATION_TIMEOUT_MS_STORE,
  RunningSessionCacheEntry,
  saveActiveRunningSessionCache as saveActiveRunningSessionCacheStore,
  saveRunningSessionCache as saveRunningSessionCacheStore
} from './state/chatStateCache';
import {
  findLocalSession as findLocalSessionInCollections,
  mergeResumedSession,
  mergeSessionSummaryList,
  restoreRunningSessionMessage,
  resolveRunningSessionDetails as resolveRunningSessionDetailsInCollections,
  resolveSessionProvider as resolveSessionProviderInCollections,
  sessionHasRenderableResult as sessionHasRenderableResultInCollections
} from './state/chatSessionState';
import { Header as HeaderView } from './components/layout/Header';
import { InputArea as InputAreaView } from './components/chat/InputArea';
import { ScrollIndex as ScrollIndexView } from './components/chat/ScrollIndex';
import { ChatBubble as ChatBubbleView } from './components/chat/ChatBubble';
import { SUPPORTED_LANGUAGES, useI18n } from './i18n';

interface ProjectInfo {
  id: string;
  displayName: string;
  sessionCount: number;
  provider: Provider;
  lastActivity?: number;
}

interface WSMessage {
  type: string;
  action?: string;
  provider?: Provider;
  settings?: unknown;
  activeProfile?: unknown;
  selectedProfileName?: unknown;
  settingsName?: unknown;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  result?: string;
  isError?: boolean;
  [key: string]: any;
}

const DEFAULT_SERVER_ACCESS_STATE: ServerAccessState = {
  accessMode: 'admin',
  permissions: {
    canViewAllSessions: true,
    canManageSettings: true
  }
};

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
  serverAccess,
  runtimeProfileProvider,
  runtimeProfileState,
  onRuntimeProfileProviderChange,
  onLoadRuntimeProfiles,
  onSwitchRuntimeProfile,
  onToggleRuntimeProfileEditor,
  onRuntimeProfileFieldChange,
  onSaveRuntimeProfile,
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
  serverAccess: ServerAccessState;
  runtimeProfileProvider: Provider;
  runtimeProfileState: RuntimeProfileProviderState;
  onRuntimeProfileProviderChange: (provider: Provider) => void;
  onLoadRuntimeProfiles: (provider: Provider) => void;
  onSwitchRuntimeProfile: (provider: Provider, settingsName: string) => void;
  onToggleRuntimeProfileEditor: () => void;
  onRuntimeProfileFieldChange: (field: keyof RuntimeProfileForm, value: string) => void;
  onSaveRuntimeProfile: () => void;
  processPanelPreferences: ProcessPanelPreferences;
  processPreferencesLoaded: boolean;
  processPreferencesSaving: boolean;
  onProcessPanelPreferenceChange: (key: keyof ProcessPanelPreferences, value: boolean) => void;
}) => {
  const { language, setLanguage, t } = useI18n();
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const processPanelSettingOptions = useMemo(() => getProcessPanelSettingOptions(t), [t]);
  const canManageSharedSettings = serverAccess.permissions.canManageSettings;
  const isTesterMode = serverAccess.accessMode === 'tester';

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

  useEffect(() => {
    if (!isConnected) {
      setShowSettingsDropdown(false);
    }
  }, [isConnected]);

  const selectedSettingsItem = runtimeProfileState.activeProfile
    || runtimeProfileState.settingsList.find(settings => settings.name === runtimeProfileState.selectedProfileName)
    || null;
  const runtimeProfileProviderLabel = getProviderLabel(runtimeProfileProvider, t);
  const runtimeProfileSummaryText = selectedSettingsItem
    ? `${selectedSettingsItem.model || t('settings.runtime.unknownModel')}${selectedSettingsItem.valueCount ? t('settings.runtime.valuesSuffix', { count: selectedSettingsItem.valueCount }) : ''}`
    : t('settings.runtime.summaryFallback', { provider: runtimeProfileProviderLabel });
  const runtimeProfileEmptyText = runtimeProfileProvider === 'codex'
    ? t('settings.runtime.empty.codex')
    : t('settings.runtime.empty.claude');
  const connectionStatusLabel = isConnected
    ? t('settings.bridge.connected')
    : isConnecting
      ? t('common.connecting')
      : t('settings.bridge.disconnected');
  const processPreferencesStatusText = isConnected
    ? (processPreferencesSaving
      ? t('settings.process.status.syncing')
      : (processPreferencesLoaded
        ? t('settings.process.status.synced')
        : t('settings.process.status.loading')))
    : t('settings.process.status.offline');
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
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">{t('settings.bridge.title')}</div>
              <div className="mt-1 text-sm font-medium text-white">{t('settings.bridge.subtitle')}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/45">
                {t('settings.bridge.description')}
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
            {url ? t('settings.bridge.urlReady') : t('settings.bridge.urlMissing')}
          </div>
          <div className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">
            {token ? t('settings.bridge.tokenReady') : t('settings.bridge.tokenMissing')}
          </div>
          {isConnected && isTesterMode && (
            <div className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-amber-200">
              {t('settings.access.testerBadge', { ownerId: serverAccess.ownerId || 'tester' })}
            </div>
          )}
        </div>

        {isConnected && isTesterMode && (
          <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-[11px] leading-5 text-amber-100">
            {t('settings.access.testerNotice', { ownerId: serverAccess.ownerId || 'tester' })}
          </div>
        )}

        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/45">{t('common.webSocketUrl')}</span>
            <input
              type="text"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder={t('settings.bridge.urlPlaceholder')}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-accent/50 focus:outline-none"
              disabled={isConnected}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/45">{t('common.token')}</span>
            <input
              type="password"
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder={t('common.token')}
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
              {t('common.disconnect')}
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={isConnecting || !url || !token}
              className="w-full rounded-xl bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:opacity-50"
            >
              {isConnecting ? t('common.connecting') : t('common.connect')}
            </button>
          )}
        </div>

      </div>

      {isConnected && canManageSharedSettings && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">{t('settings.runtime.title')}</div>
              <div className="mt-1 text-sm font-medium text-white">{t('settings.runtime.subtitle')}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/45">
                {t('settings.runtime.description')}
              </div>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleRuntimeProfileEditor();
              }}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors',
                runtimeProfileState.isEditing
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'
              )}
            >
              {runtimeProfileState.isEditing ? t('settings.runtime.closeEditor') : t('settings.runtime.manualOverride')}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['claude', 'codex'] as Provider[]).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => {
                  setShowSettingsDropdown(false);
                  onRuntimeProfileProviderChange(provider);
                }}
                className={cn(
                  'inline-flex items-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors',
                  runtimeProfileProvider === provider
                    ? getProviderBadgeClass(provider)
                    : 'border-white/10 bg-white/5 text-white/55 hover:bg-white/10'
                )}
              >
                {getProviderLabel(provider, t)}
              </button>
            ))}
          </div>
          <div className="relative mt-3" ref={settingsDropdownRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!showSettingsDropdown && !runtimeProfileState.loaded && !runtimeProfileState.loading) {
                  onLoadRuntimeProfiles(runtimeProfileProvider);
                }
                setShowSettingsDropdown(!showSettingsDropdown);
              }}
              disabled={runtimeProfileState.loading}
              className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-left transition-colors hover:bg-white/[0.08]"
            >
              <div className="min-w-0">
                <div className={cn('truncate text-sm font-medium', selectedSettingsItem ? 'text-white' : 'text-white/40')}>
                  {runtimeProfileState.loading
                    ? t('settings.runtime.loadingProfiles', { provider: runtimeProfileProviderLabel })
                    : (runtimeProfileState.selectedProfileName || selectedSettingsItem?.name || t('settings.runtime.selectProfile', { provider: runtimeProfileProviderLabel }))}
                </div>
                <div className="mt-1 text-[11px] text-white/40">
                  {runtimeProfileSummaryText}
                </div>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                {runtimeProfileState.loading && <RefreshCw size={14} className="animate-spin text-white/35" />}
                <ChevronDown size={14} className={cn('text-white/40 transition-transform', showSettingsDropdown && 'rotate-180')} />
              </div>
            </button>
            {showSettingsDropdown && (
              <div className="absolute left-0 right-0 top-full z-[100] mt-2 max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-card p-1 shadow-2xl">
                {runtimeProfileState.settingsList.length === 0 ? (
                  <div className="p-4 text-center text-sm text-white/40">
                    {runtimeProfileEmptyText}
                  </div>
                ) : (
                  runtimeProfileState.settingsList.map((settings) => (
                    <button
                      key={settings.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSwitchRuntimeProfile(runtimeProfileProvider, settings.name);
                        setShowSettingsDropdown(false);
                      }}
                      className={cn(
                        'w-full rounded-xl px-3 py-2.5 text-left text-sm text-white transition-colors hover:bg-white/10',
                        runtimeProfileState.selectedProfileName === settings.name && 'bg-white/[0.08]'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{settings.name}</span>
                        <span className="shrink-0 text-[11px] text-white/40">{settings.model}</span>
                      </div>
                      {(settings.baseUrl || settings.model || settings.authTokenConfigured) && (
                        <div className="mt-1.5 space-y-1 text-[11px] text-white/45">
                          {settings.baseUrl && (
                            <div className="truncate">{t('common.baseUrl')}: {settings.baseUrl}</div>
                          )}
                          {settings.model && (
                            <div className="truncate">{t('common.model')}: {settings.model}</div>
                          )}
                          {settings.authTokenConfigured && (
                            <div>{t('settings.runtime.authTokenConfigured')}</div>
                          )}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {runtimeProfileState.errorMessage && (
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              {runtimeProfileState.errorMessage}
            </div>
          )}
          {selectedSettingsItem && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {selectedSettingsItem.baseUrl && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">{t('common.baseUrl')}</div>
                  <div className="mt-1 truncate text-xs text-white/75">{selectedSettingsItem.baseUrl}</div>
                </div>
              )}
              {selectedSettingsItem.model && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">{t('common.model')}</div>
                  <div className="mt-1 truncate text-xs text-white/75">{selectedSettingsItem.model}</div>
                </div>
              )}
              {selectedSettingsItem.authTokenConfigured && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">{t('common.auth')}</div>
                  <div className="mt-1 text-xs text-white/75">{t('settings.runtime.tokenConfigured')}</div>
                </div>
              )}
            </div>
          )}
          {runtimeProfileState.isEditing && (
            <div className="mt-3 rounded-2xl border border-accent/15 bg-white/[0.04] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">{t('settings.runtime.manualOverrideTitle')}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/45">
                {t('settings.runtime.manualOverrideDescription', { provider: runtimeProfileProviderLabel })}
              </div>
              <div className="mt-3 space-y-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-white/45">{t('common.baseUrl')}</span>
                  <input
                    type="text"
                    value={runtimeProfileState.editForm.baseUrl}
                    onChange={(e) => onRuntimeProfileFieldChange('baseUrl', e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-white/45">{t('common.authToken')}</span>
                  <input
                    type="password"
                    value={runtimeProfileState.editForm.authToken}
                    onChange={(e) => onRuntimeProfileFieldChange('authToken', e.target.value)}
                    placeholder={runtimeProfileProvider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-white/45">{t('common.model')}</span>
                  <input
                    type="text"
                    value={runtimeProfileState.editForm.model}
                    onChange={(e) => onRuntimeProfileFieldChange('model', e.target.value)}
                    placeholder={runtimeProfileProvider === 'codex' ? 'gpt-5.4' : 'claude-sonnet-4'}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
                  />
                </label>
              </div>
              <button
                onClick={onSaveRuntimeProfile}
                className="mt-3 w-full rounded-xl bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
              >
                {t('common.saveAndApply')}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">{t('settings.language.title')}</div>
          <div className="mt-1 text-sm font-medium text-white">{t('settings.language.subtitle')}</div>
          <div className="mt-1 text-[11px] leading-5 text-white/45">
            {t('settings.language.description')}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {SUPPORTED_LANGUAGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLanguage(option)}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition-all',
                language === option
                  ? 'border-accent/35 bg-accent/15 text-white'
                  : 'border-white/10 bg-black/15 text-white/70 hover:bg-white/[0.05]'
              )}
            >
              <div className="text-sm font-medium">{t(`settings.language.option.${option}` as 'settings.language.option.zh-CN')}</div>
              <div className="mt-1 text-[11px] text-white/45">{option}</div>
            </button>
          ))}
        </div>
      </div>
      {canManageSharedSettings && (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/55">{t('settings.process.title')}</div>
            <div className="mt-1 text-sm font-medium text-white">{t('settings.process.subtitle')}</div>
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
              {isConnected ? (processPreferencesLoaded ? t('common.workspaceSynced') : t('common.pendingSync')) : t('common.offline')}
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {processPanelSettingOptions.map((option) => {
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
                    {enabled ? t('common.on') : t('common.off')}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-white/45">
          {t('settings.process.note')}
        </div>
      </div>
      )}
    </div>
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

const getStoredJson = <T,>(key: string, fallbackValue: T): T => {
  try {
    const storedValue = localStorage.getItem(key);
    if (!storedValue) {
      return fallbackValue;
    }

    return JSON.parse(storedValue) as T;
  } catch {
    return fallbackValue;
  }
};

// Default WebSocket URL - change this to your tunnel URL
const DEFAULT_WS_URL = 'wss://acropetal-nonfalteringly-ruben.ngrok-free.dev';
const DEFAULT_TOKEN = '';
const TOKEN_STORAGE_KEY = 'coderemote_token';
const SESSION_TOKEN_STORAGE_KEY = 'coderemote_token_session';
const TOKEN_PERSISTED_KEY = 'coderemote_token_persisted';
const LEGACY_DEFAULT_TOKEN = 'test123';

const clearPersistedToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_PERSISTED_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
};

const clearSessionToken = (): void => {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
};

const getStoredToken = (): string => {
  try {
    const sessionToken = sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '';
    if (sessionToken) {
      return sessionToken;
    }

    const token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
    const persisted = localStorage.getItem(TOKEN_PERSISTED_KEY) === '1';

    if (!token) {
      return '';
    }

    // Legacy builds persisted the shared admin token locally. Always clear it.
    if (token === LEGACY_DEFAULT_TOKEN) {
      clearPersistedToken();
      return '';
    }

    if (!persisted) {
      clearPersistedToken();
      return '';
    }

    return token;
  } catch {
    return DEFAULT_TOKEN;
  }
};

const persistTokenForAccessMode = (token: string, accessMode: ServerAccessState['accessMode']): void => {
  if (!token) {
    clearPersistedToken();
    clearSessionToken();
    return;
  }

  try {
    if (accessMode === 'tester') {
      clearSessionToken();
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      localStorage.setItem(TOKEN_PERSISTED_KEY, '1');
      return;
    }

    sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    clearPersistedToken();
  } catch (e) {
    console.warn('Failed to persist token:', e);
  }
};

const RECONNECT_PLACEHOLDER_MESSAGE_PREFIX = RECONNECT_PLACEHOLDER_MESSAGE_PREFIX_STORE;
const RUNNING_SESSION_REHYDRATION_TIMEOUT_MS = RUNNING_SESSION_REHYDRATION_TIMEOUT_MS_STORE;

const loadRunningSessionCache = (): RunningSessionCacheEntry[] => loadRunningSessionCacheStore();
const loadActiveRunningSessionCache = (): ActiveRunningSessionCacheEntry | null => loadActiveRunningSessionCacheStore();
const saveRunningSessionCache = (entries: RunningSessionCacheEntry[]): void => saveRunningSessionCacheStore(entries);
const saveActiveRunningSessionCache = (entry: ActiveRunningSessionCacheEntry | null): void => saveActiveRunningSessionCacheStore(entry);
const cacheRunningSessionEntry = (entry: RunningSessionCacheEntry): void => cacheRunningSessionEntryStore(entry);
const removeCachedRunningSessionEntry = (sessionId: string): void => removeCachedRunningSessionEntryStore(sessionId);
const createReconnectPlaceholderSession = (entry: RunningSessionCacheEntry): ChatSession => createReconnectPlaceholderSessionStore(entry);

export default function App() {
  const { t } = useI18n();
  // WebSocket state
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => getStoredValue('coderemote_url', DEFAULT_WS_URL));
  const [token, setToken] = useState(() => getStoredToken());
  const [showSettings, setShowSettings] = useState(false);
  const [serverAccess, setServerAccess] = useState<ServerAccessState>(DEFAULT_SERVER_ACCESS_STATE);
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
  const currentSessionIdRef = useRef<string | null>(loadActiveRunningSessionCache()?.sessionId || null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRefreshingRef = useRef(false);
  const runningSessionsRef = useRef<Set<string>>(new Set(loadRunningSessionCache().map(entry => entry.sessionId))); // Track running sessions in ref for WebSocket callbacks
  const serverRehydratedRunningSessionsRef = useRef<Set<string>>(new Set());
  const runningSessionRehydrationTimeoutRef = useRef<number | null>(null);
  const pendingRunningSessionRestoreRef = useRef<ActiveRunningSessionCacheEntry | null>(null);

  // Chat state - start empty, will be populated from server
  const [sessions, setSessions] = useState<ChatSession[]>(() => (
    loadRunningSessionCache().map(createReconnectPlaceholderSession)
  ));
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => loadActiveRunningSessionCache()?.sessionId || null);
  const [runningSessions, setRunningSessions] = useState<Set<string>>(() => (
    new Set(loadRunningSessionCache().map(entry => entry.sessionId))
  )); // Track running sessions by ID
  const [runningSessionsInfo, setRunningSessionsInfo] = useState<Map<string, { title: string; projectId?: string; provider?: Provider }>>(() => (
    new Map(loadRunningSessionCache().map(entry => [entry.sessionId, {
      title: entry.title,
      projectId: entry.projectId,
      provider: entry.provider
    }]))
  )); // Store session info
  const [completedSessions, setCompletedSessions] = useState<Set<string>>(new Set()); // Track completed sessions (for notification)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [newSessionProvider, setNewSessionProvider] = useState<Provider>(() => loadActiveRunningSessionCache()?.provider || 'claude');
  const syncNewSessionProvider = useCallback((provider?: Provider) => {
    if (provider) {
      setNewSessionProvider(provider);
    }
  }, []);

  // Keep runningSessionsRef in sync with runningSessions
  useEffect(() => {
    runningSessionsRef.current = runningSessions;
  }, [runningSessions]);

  const clearRunningSessionRehydrationTimeout = useCallback(() => {
    if (runningSessionRehydrationTimeoutRef.current !== null) {
      window.clearTimeout(runningSessionRehydrationTimeoutRef.current);
      runningSessionRehydrationTimeoutRef.current = null;
    }
  }, []);

  // Debug: log runningSessions changes
  useEffect(() => {
    debugLog('[RunningSessions] State changed:', Array.from(runningSessions));
  }, [runningSessions]);

  // Debug: log completedSessions changes
  useEffect(() => {
    debugLog('[CompletedSessions] State changed:', Array.from(completedSessions));
  }, [completedSessions]);

  // Current session is generating only if it's in the running set
  const isGenerating = currentSessionId ? runningSessions.has(currentSessionId) : false;

  // Server logs state
  const [serverLogs, setServerLogs] = useState<Array<{ level: string; message: string; timestamp: number }>>([]);
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES);
  const [runtimeProfileProvider, setRuntimeProfileProvider] = useState<Provider>('claude');
  const [runtimeProfiles, setRuntimeProfiles] = useState(createRuntimeProfilesState);
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
        alert(t('settings.process.saveTimeout'));
        return;
      }

      setUiPreferences(normalizeUiPreferences(lastSavedUiPreferencesRef.current));
      setProcessPreferencesSaving(false);
      setProcessPreferencesLoaded(true);
    }, 5000);
  }, [clearUiPreferencesTimeout]);

  const requestUiPreferences = useCallback((socket?: WebSocket | null) => {
    if (!serverAccess.permissions.canManageSettings) {
      return;
    }

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
  }, [serverAccess.permissions.canManageSettings, startUiPreferencesTimeout]);

  const requestRuntimeProfiles = useCallback((provider: Provider, socket?: WebSocket | null) => {
    if (!serverAccess.permissions.canManageSettings) {
      return;
    }

    const target = socket || wsRef.current;
    if (!target || target.readyState !== WebSocket.OPEN) {
      return;
    }

    setRuntimeProfiles(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        loading: true,
        errorMessage: null
      }
    }));

    target.send(JSON.stringify({
      type: 'settings',
      action: 'list',
      provider
    }));
  }, [serverAccess.permissions.canManageSettings]);

  const handleRuntimeProfileProviderChange = useCallback((provider: Provider) => {
    setRuntimeProfileProvider(provider);

    if (showSettings && isConnected && !runtimeProfiles[provider].loaded && !runtimeProfiles[provider].loading) {
      requestRuntimeProfiles(provider);
    }
  }, [isConnected, requestRuntimeProfiles, runtimeProfiles, showSettings]);

  const handleToggleRuntimeProfileEditor = useCallback(() => {
    setRuntimeProfiles(prev => {
      const currentState = prev[runtimeProfileProvider];
      const nextIsEditing = !currentState.isEditing;

      return {
        ...prev,
        [runtimeProfileProvider]: {
          ...currentState,
          isEditing: nextIsEditing,
          editForm: nextIsEditing
            ? createRuntimeProfileFormFromProfile(currentState.activeProfile)
            : currentState.editForm,
          errorMessage: null
        }
      };
    });
  }, [runtimeProfileProvider]);

  const handleRuntimeProfileFieldChange = useCallback((field: keyof RuntimeProfileForm, value: string) => {
    setRuntimeProfiles(prev => ({
      ...prev,
      [runtimeProfileProvider]: {
        ...prev[runtimeProfileProvider],
        editForm: {
          ...prev[runtimeProfileProvider].editForm,
          [field]: value
        }
      }
    }));
  }, [runtimeProfileProvider]);

  const handleSwitchRuntimeProfile = useCallback((provider: Provider, settingsName: string) => {
    if (!serverAccess.permissions.canManageSettings) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert(t('settings.runtime.connectBeforeSwitch'));
      return;
    }

    setRuntimeProfiles(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        loading: true,
        errorMessage: null
      }
    }));

    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'switch',
      provider,
      settingsName
    }));
  }, [serverAccess.permissions.canManageSettings]);

  const handleSaveRuntimeProfile = useCallback(() => {
    if (!serverAccess.permissions.canManageSettings) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert(t('settings.runtime.connectBeforeEdit'));
      return;
    }

    const currentState = runtimeProfiles[runtimeProfileProvider];

    setRuntimeProfiles(prev => ({
      ...prev,
      [runtimeProfileProvider]: {
        ...prev[runtimeProfileProvider],
        loading: true,
        errorMessage: null
      }
    }));

    wsRef.current.send(JSON.stringify({
      type: 'settings',
      action: 'save',
      provider: runtimeProfileProvider,
      envDetails: {
        baseUrl: currentState.editForm.baseUrl,
        authToken: currentState.editForm.authToken,
        model: currentState.editForm.model
      }
    }));
  }, [runtimeProfileProvider, runtimeProfiles, serverAccess.permissions.canManageSettings]);

  const handleProcessPanelPreferenceChange = useCallback((
    key: keyof ProcessPanelPreferences,
    value: boolean
  ) => {
    if (!serverAccess.permissions.canManageSettings) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert(t('settings.process.connectBeforeChange'));
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
  }, [serverAccess.permissions.canManageSettings, startUiPreferencesTimeout, uiPreferences]);

  useEffect(() => {
    if (showSettings && isConnected && serverAccess.permissions.canManageSettings && !processPreferencesSaving) {
      requestUiPreferences();
    }
  }, [isConnected, processPreferencesSaving, requestUiPreferences, serverAccess.permissions.canManageSettings, showSettings]);

  useEffect(() => {
    if (!showSettings || !isConnected || !serverAccess.permissions.canManageSettings) {
      return;
    }

    const currentState = runtimeProfiles[runtimeProfileProvider];
    if (!currentState.loaded && !currentState.loading) {
      requestRuntimeProfiles(runtimeProfileProvider);
    }
  }, [isConnected, requestRuntimeProfiles, runtimeProfileProvider, runtimeProfiles, serverAccess.permissions.canManageSettings, showSettings]);

  useEffect(() => {
    if (!isConnected) {
      setRuntimeProfiles(createRuntimeProfilesState());
      setRuntimeProfileProvider('claude');
    }
  }, [isConnected]);

  // Multi-project History state
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectSessions, setProjectSessions] = useState<Record<string, ChatSession[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(new Set());
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => loadActiveRunningSessionCache()?.projectId || null);

  const updateSessionAcrossCollections = useCallback((
    sessionId: string | undefined | null,
    updater: (session: ChatSession) => ChatSession
  ) => {
    if (!sessionId) {
      return;
    }

    setSessions(prev => {
      let changed = false;
      const next = prev.map(session => {
        if (session.id !== sessionId) {
          return session;
        }

        const updated = updater(session);
        if (updated !== session) {
          changed = true;
        }
        return updated;
      });

      return changed ? next : prev;
    });

    setProjectSessions(prev => {
      let changed = false;
      const nextEntries = Object.entries(prev).map(([projectId, sessionList]) => {
        let listChanged = false;
        const nextSessionList = sessionList.map(session => {
          if (session.id !== sessionId) {
            return session;
          }

          const updated = updater(session);
          if (updated !== session) {
            listChanged = true;
          }
          return updated;
        });

        if (listChanged) {
          changed = true;
        }

        return [projectId, listChanged ? nextSessionList : sessionList] as const;
      });

      return changed ? Object.fromEntries(nextEntries) : prev;
    });
  }, []);

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
      debugLog('[Discussion] Complete:', result.conclusion?.substring(0, 100));
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
      setRunningSessionsInfo(prev => {
        const next = new Map(prev);
        for (const id of Array.from(next.keys())) {
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
      setRunningSessionsInfo(prev => {
        const next = new Map(prev);
        for (const id of Array.from(next.keys())) {
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
      debugLog('[Discussion] Sending to main session, summary length:', summary.length);
      // Delay slightly so the discussion UI has time to settle
      setTimeout(() => {
        // Let the primary provider continue from the discussion result.
        const summaryMessage = `Please continue from the following multi-agent discussion result:\n\n${summary}`;
        const targetSession = discussionMainSessionRef.current;
        debugLog('[Discussion] Main session target:', targetSession);

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
      debugLog('[Discussion] onCreateHostSession called');
      debugLog('[Discussion]   title:', title);
      debugLog('[Discussion]   wsRef.current:', !!wsRef.current);
      debugLog('[Discussion]   wsRef.current.readyState:', wsRef.current?.readyState);
      debugLog('[Discussion]   isConnected:', isConnected);
      const provider = currentSession?.provider || newSessionProvider;
      // Stash the discussion record until the host session exists
      pendingHostSessionRef.current = { title, fullRecord, provider };
      debugLog('[Discussion]   pendingHostSessionRef.current set');

      if (wsRef.current && isConnected) {
        // Create the host session immediately when the socket is ready
        debugLog('[Discussion] WebSocket connected, creating new session');
        createNewSession(provider, title);
      } else {
        // Otherwise retry after the connection is restored
        debugLog('[Discussion] WebSocket not connected, will send after connection');
        // Poll until the socket becomes available again
        const checkAndSend = () => {
          if (wsRef.current && isConnected) {
            debugLog('[Discussion] WebSocket now connected, creating new session');
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

    debugLog('[checkForDiscussion] text:', text?.substring(0, 50), 'mentions:', mentions, 'hasValidMention:', hasValidMention);
    return hasValidMention;
  }, []);

  const findLocalSession = useCallback((sessionId?: string | null, projectId?: string | null): ChatSession | null => {
    return findLocalSessionInCollections(sessions, projectSessions, sessionId, projectId);
  }, [projectSessions, sessions]);

  const resolveRunningSessionDetails = useCallback((sessionId: string) => {
    return resolveRunningSessionDetailsInCollections(sessionId, sessions, projectSessions, runningSessionsInfo);
  }, [projectSessions, runningSessionsInfo, sessions]);

  const markSessionAsRunning = useCallback((
    sessionId?: string | null,
    options?: {
      title?: string;
      projectId?: string | null;
      provider?: Provider;
    }
  ) => {
    if (!sessionId) {
      return;
    }

    const existingDetails = resolveRunningSessionDetails(sessionId);
    const title = normalizeLegacyDisplayText(options?.title || existingDetails.title || sessionId.substring(0, 12));
    const projectId = options?.projectId === undefined
      ? existingDetails.projectId
      : options.projectId || undefined;
    const provider = options?.provider || existingDetails.provider || 'claude';
    const nextRunningSessions = new Set(runningSessionsRef.current);
    nextRunningSessions.add(sessionId);
    runningSessionsRef.current = nextRunningSessions;

    setRunningSessions(prev => {
      if (prev.has(sessionId)) {
        return prev;
      }

      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
    setRunningSessionsInfo(prev => {
      const next = new Map(prev);
      next.set(sessionId, { title, projectId, provider });
      return next;
    });
    cacheRunningSessionEntry({
      sessionId,
      title,
      projectId,
      provider
    });
  }, [resolveRunningSessionDetails]);

  const clearRunningSessionState = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    const nextRunningSessions = new Set(runningSessionsRef.current);
    nextRunningSessions.delete(sessionId);
    runningSessionsRef.current = nextRunningSessions;

    setRunningSessions(prev => {
      if (!prev.has(sessionId)) {
        return prev;
      }

      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setRunningSessionsInfo(prev => {
      if (!prev.has(sessionId)) {
        return prev;
      }

      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    removeCachedRunningSessionEntry(sessionId);
  }, []);

  const renameRunningSessionState = useCallback((
    oldSessionId?: string | null,
    newSessionId?: string | null,
    options?: {
      title?: string;
      projectId?: string | null;
      provider?: Provider;
    }
  ) => {
    if (!oldSessionId || !newSessionId) {
      return;
    }

    if (oldSessionId === newSessionId) {
      markSessionAsRunning(newSessionId, options);
      return;
    }

    const existingDetails = resolveRunningSessionDetails(oldSessionId);
    const title = normalizeLegacyDisplayText(options?.title || existingDetails.title || newSessionId.substring(0, 12));
    const projectId = options?.projectId === undefined
      ? existingDetails.projectId
      : options.projectId || undefined;
    const provider = options?.provider || existingDetails.provider || 'claude';
    const nextRunningSessions = new Set(runningSessionsRef.current);
    nextRunningSessions.delete(oldSessionId);
    nextRunningSessions.add(newSessionId);
    runningSessionsRef.current = nextRunningSessions;

    setRunningSessions(prev => {
      if (!prev.has(oldSessionId) && prev.has(newSessionId)) {
        return prev;
      }

      const next = new Set(prev);
      next.delete(oldSessionId);
      next.add(newSessionId);
      return next;
    });
    setRunningSessionsInfo(prev => {
      const next = new Map(prev);
      next.delete(oldSessionId);
      next.set(newSessionId, { title, projectId, provider });
      return next;
    });
    removeCachedRunningSessionEntry(oldSessionId);
    cacheRunningSessionEntry({
      sessionId: newSessionId,
      title,
      projectId,
      provider
    });
  }, [markSessionAsRunning, resolveRunningSessionDetails]);

  const ensureRunningSessionShell = useCallback((
    sessionId: string,
    options?: {
      title?: string;
      projectId?: string | null;
      provider?: Provider;
      timestamp?: number;
    }
  ) => {
    const timestamp = options?.timestamp || Date.now();
    const provider = options?.provider || 'claude';
    const title = normalizeLegacyDisplayText(options?.title || sessionId.substring(0, 12));
    const projectId = options?.projectId || undefined;
    const shell: ChatSession = {
      id: sessionId,
      title,
      createdAt: timestamp,
      provider,
      messages: [createReconnectedRunningMessage(provider, timestamp)]
    };

    setSessions(prev => (
      prev.some(session => session.id === sessionId)
        ? prev
        : [shell, ...prev]
    ));

    if (projectId) {
      setProjectSessions(prev => {
        const projectList = prev[projectId] || [];
        if (projectList.some(session => session.id === sessionId)) {
          return prev;
        }

        return {
          ...prev,
          [projectId]: [shell, ...projectList]
        };
      });
    }
  }, []);

  const applyRunningSessionSnapshot = useCallback((
    sessionId?: string | null,
    options?: {
      title?: string;
      projectId?: string | null;
      provider?: Provider;
      timestamp?: number;
    }
  ) => {
    if (!sessionId) {
      return;
    }

    const existingDetails = resolveRunningSessionDetails(sessionId);
    const title = normalizeLegacyDisplayText(options?.title || existingDetails.title || sessionId.substring(0, 12));
    const projectId = options?.projectId === undefined
      ? existingDetails.projectId
      : options.projectId || undefined;
    const provider = options?.provider || existingDetails.provider || 'claude';
    const timestamp = options?.timestamp || Date.now();

    markSessionAsRunning(sessionId, {
      title,
      projectId,
      provider
    });

    const localSession = findLocalSession(sessionId, projectId || null);
    if (!localSession) {
      ensureRunningSessionShell(sessionId, {
        title,
        projectId,
        provider,
        timestamp
      });
      return;
    }

    updateSessionAcrossCollections(sessionId, session => restoreRunningSessionMessage({
      ...session,
      title,
      provider
    }, provider, timestamp));
  }, [
    ensureRunningSessionShell,
    findLocalSession,
    markSessionAsRunning,
    resolveRunningSessionDetails,
    updateSessionAcrossCollections
  ]);

  const sessionHasRenderableResult = useCallback((
    sessionId?: string | null,
    projectId?: string | null,
    fallbackSession?: ChatSession | null
  ): boolean => {
    return sessionHasRenderableResultInCollections(
      sessions,
      projectSessions,
      sessionId,
      projectId,
      fallbackSession
    );
  }, [projectSessions, sessions]);

  const resolveSessionProvider = useCallback((
    sessionId?: string | null,
    projectId?: string | null,
    fallback: Provider = newSessionProvider
  ): Provider => {
    return resolveSessionProviderInCollections(
      sessions,
      projectSessions,
      projects,
      sessionId,
      projectId,
      fallback
    );
  }, [newSessionProvider, projectSessions, projects, sessions]);

  // Find current session from either sessions or projectSessions
  const currentSession = useMemo(() => (
    findLocalSession(currentSessionId, currentProjectId)
  ), [findLocalSession, currentProjectId, currentSessionId]);

  const currentProvider = currentSession?.provider || newSessionProvider;

  const messages = currentSession?.messages || [];

  useEffect(() => {
    const cachedEntries = Array.from(runningSessions).map(sessionId => {
      const details = resolveRunningSessionDetails(sessionId);
      return {
        sessionId,
        title: details.title,
        projectId: details.projectId,
        provider: details.provider || 'claude'
      } satisfies RunningSessionCacheEntry;
    });

    saveRunningSessionCache(cachedEntries);

    const activeRunningSessionId = currentSessionId && runningSessions.has(currentSessionId)
      ? currentSessionId
      : cachedEntries[0]?.sessionId;
    const activeEntry = cachedEntries.find(entry => entry.sessionId === activeRunningSessionId) || cachedEntries[0] || null;

    saveActiveRunningSessionCache(activeEntry
      ? {
          sessionId: activeEntry.sessionId,
          projectId: activeEntry.projectId,
          provider: activeEntry.provider
        }
      : null);
  }, [currentSessionId, resolveRunningSessionDetails, runningSessions]);

  useEffect(() => {
    setSessions(prev => {
      const next = prev.filter(session => {
        const firstMessage = session.messages[0];
        const isReconnectPlaceholder = session.messages.length === 1
          && typeof firstMessage?.id === 'string'
          && firstMessage.id.startsWith(RECONNECT_PLACEHOLDER_MESSAGE_PREFIX);

        return !isReconnectPlaceholder || runningSessions.has(session.id);
      });

      return next.length === prev.length ? prev : next;
    });
  }, [runningSessions]);

  useEffect(() => {
    if (!currentSessionId || runningSessions.has(currentSessionId)) {
      return;
    }

    if (findLocalSession(currentSessionId, currentProjectId)) {
      return;
    }

    setCurrentSessionId(null);
    currentSessionIdRef.current = null;
    setCurrentProjectId(null);
  }, [currentProjectId, currentSessionId, findLocalSession, runningSessions]);

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

  const sendResumeRequest = useCallback((
    socket: WebSocket | null,
    sessionId: string,
    projectId?: string | null,
    provider?: Provider
  ) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const resolvedProvider = provider || resolveSessionProvider(sessionId, projectId);
    const resumeMessage: Record<string, unknown> = {
      type: 'session',
      action: 'resume',
      sessionId,
      provider: resolvedProvider
    };

    if (projectId) {
      resumeMessage.projectId = projectId;
    }

    socket.send(JSON.stringify(resumeMessage));
    socket.send(JSON.stringify({
      type: 'session_focus',
      sessionId
    }));
  }, [resolveSessionProvider]);

  // WebSocket connection
  const connect = useCallback(() => {
    if (ws) {
      ws.close();
    }

    setIsConnecting(true);
    setProcessPreferencesLoaded(false);
    setProcessPreferencesSaving(false);
    setUiPreferences(DEFAULT_UI_PREFERENCES);
    setServerAccess(DEFAULT_SERVER_ACCESS_STATE);
    lastSavedUiPreferencesRef.current = DEFAULT_UI_PREFERENCES;
    pendingUiPreferencesRollbackRef.current = null;
    const newWs = new WebSocket(serverUrl);

    newWs.onopen = () => {
      debugLog('WebSocket connected');
      newWs.send(JSON.stringify({ type: 'auth', token }));
    };

    newWs.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        debugLog('Received:', msg.type, msg);

        // Use message's sessionId if available, otherwise fallback to active session
        // This ensures messages go to the correct session even when running in background
        const targetSessionId = msg.sessionId || currentSessionIdRef.current;

        if (msg.type === 'auth_success') {
          const nextServerAccess: ServerAccessState = {
            accessMode: msg.accessMode === 'tester' ? 'tester' : 'admin',
            ...(typeof msg.ownerId === 'string' ? { ownerId: msg.ownerId } : {}),
            permissions: {
              canViewAllSessions: msg.permissions?.canViewAllSessions !== false,
              canManageSettings: msg.permissions?.canManageSettings !== false
            }
          };

          setIsConnected(true);
          setIsConnecting(false);
          setShowSettings(false); // Auto-close settings panel on success
          setServerAccess(nextServerAccess);
          debugLog('Auth successful');
          serverRehydratedRunningSessionsRef.current = new Set();
          clearRunningSessionRehydrationTimeout();
          // Save connection settings to localStorage
          try {
            localStorage.setItem('coderemote_url', serverUrl);
            persistTokenForAccessMode(token, nextServerAccess.accessMode);
          } catch (e) {
            console.warn('Failed to save settings:', e);
          }

          const cachedRunningSession = loadActiveRunningSessionCache();
          if (cachedRunningSession) {
            pendingRunningSessionRestoreRef.current = cachedRunningSession;
            setCurrentSessionId(cachedRunningSession.sessionId);
            currentSessionIdRef.current = cachedRunningSession.sessionId;
            setCurrentProjectId(cachedRunningSession.projectId || null);
            syncNewSessionProvider(cachedRunningSession.provider);
            sendResumeRequest(
              newWs,
              cachedRunningSession.sessionId,
              cachedRunningSession.projectId,
              cachedRunningSession.provider
            );

            runningSessionRehydrationTimeoutRef.current = window.setTimeout(() => {
              const confirmedSessionIds = serverRehydratedRunningSessionsRef.current;
              const nextRunningSessions = new Set(
                Array.from(runningSessionsRef.current).filter(sessionId => confirmedSessionIds.has(sessionId))
              );

              runningSessionsRef.current = nextRunningSessions;

              setRunningSessions(nextRunningSessions);
              setRunningSessionsInfo(prev => {
                const next = new Map(prev);
                for (const sessionId of Array.from(next.keys())) {
                  if (!confirmedSessionIds.has(sessionId)) {
                    next.delete(sessionId);
                  }
                }
                return next;
              });
              if (!confirmedSessionIds.has(cachedRunningSession.sessionId)) {
                pendingRunningSessionRestoreRef.current = null;
              }
            }, RUNNING_SESSION_REHYDRATION_TIMEOUT_MS);
          } else {
            pendingRunningSessionRestoreRef.current = null;
          }

          // Request project list from server
          newWs.send(JSON.stringify({ type: 'session', action: 'list_projects' }));
          if (nextServerAccess.permissions.canManageSettings) {
            requestUiPreferences(newWs);
          }
        } else if (msg.type === 'ping') {
          // Respond to server heartbeat ping
          newWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        } else if (msg.type === 'auth_failed') {
          setIsConnected(false);
          setIsConnecting(false);
          setServerAccess(DEFAULT_SERVER_ACCESS_STATE);
          console.error('Auth failed');
          newWs.close();
        } else if (msg.type === 'ui_preferences') {
          if (!serverAccess.permissions.canManageSettings) {
            return;
          }
          clearUiPreferencesTimeout();
          const nextPreferences = normalizeUiPreferences(msg.uiPreferences);
          setUiPreferences(nextPreferences);
          setProcessPreferencesLoaded(true);
          setProcessPreferencesSaving(false);
          lastSavedUiPreferencesRef.current = nextPreferences;
          pendingUiPreferencesRollbackRef.current = null;
        } else if (msg.type === 'ui_preferences_saved') {
          if (!serverAccess.permissions.canManageSettings) {
            return;
          }
          clearUiPreferencesTimeout();
          const nextPreferences = normalizeUiPreferences(msg.uiPreferences);
          setUiPreferences(nextPreferences);
          setProcessPreferencesLoaded(true);
          setProcessPreferencesSaving(false);
          lastSavedUiPreferencesRef.current = nextPreferences;
          pendingUiPreferencesRollbackRef.current = null;
        } else if (msg.type === 'settings_error' && (msg.action === 'get_ui_preferences' || msg.action === 'save_ui_preferences')) {
          if (!serverAccess.permissions.canManageSettings) {
            return;
          }
          clearUiPreferencesTimeout();
          console.error('UI preferences error:', msg.error);
          if (msg.action === 'save_ui_preferences') {
            setUiPreferences(pendingUiPreferencesRollbackRef.current || lastSavedUiPreferencesRef.current);
            setProcessPreferencesSaving(false);
            pendingUiPreferencesRollbackRef.current = null;
            alert(t('settings.process.saveFailed', { error: msg.error || t('common.unknownError') }));
          } else {
            const fallbackPreferences = normalizeUiPreferences(lastSavedUiPreferencesRef.current);
            setUiPreferences(fallbackPreferences);
            setProcessPreferencesLoaded(true);
            setProcessPreferencesSaving(false);
          }
        } else if (msg.type === 'settings_list') {
          const provider = msg.provider || 'claude';
          setRuntimeProfiles(prev => ({
            ...prev,
            [provider]: applyRuntimeProfileList(prev[provider], msg, provider)
          }));
        } else if (msg.type === 'settings_switched' || msg.type === 'settings_saved') {
          const provider = msg.provider || 'claude';
          setRuntimeProfiles(prev => ({
            ...prev,
            [provider]: applyRuntimeProfileMutation(prev[provider], msg, provider)
          }));
          if (msg.message) {
            alert(msg.message);
          }
        } else if (msg.type === 'settings_error') {
          const provider = msg.provider || 'claude';
          setRuntimeProfiles(prev => ({
            ...prev,
            [provider]: applyRuntimeProfileError(prev[provider], msg.error)
          }));
          alert(t('settings.runtime.error', { error: msg.error || t('common.unknownError') }));
        } else if (msg.type === 'running_sessions') {
          // Rehydrated list of running sessions after reconnecting
          debugLog('Running sessions on server:', msg.sessions);
          if (msg.sessions && Array.isArray(msg.sessions)) {
            const newRunningSet = new Set<string>();
            const newInfoMap = new Map<string, { title: string; projectId?: string; provider?: Provider }>();
            const shouldPreserveLocalRunningState = Boolean(pendingRunningSessionRestoreRef.current);

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

            serverRehydratedRunningSessionsRef.current = new Set(newRunningSet);
            const nextRunningSessions = shouldPreserveLocalRunningState
              ? new Set([...runningSessionsRef.current, ...newRunningSet])
              : new Set(newRunningSet);

            runningSessionsRef.current = nextRunningSessions;

            setRunningSessions(nextRunningSessions);
            setRunningSessionsInfo(prev => {
              if (!shouldPreserveLocalRunningState) {
                return newInfoMap;
              }

              const next = new Map(prev);
              newInfoMap.forEach((info, sessionId) => {
                next.set(sessionId, info);
              });
              return next;
            });

            // Focus the previously active running session after reconnecting when possible.
            if (msg.sessions.length > 0) {
              const preferredSessionId = pendingRunningSessionRestoreRef.current?.sessionId || currentSessionIdRef.current;
              const preferredSession = msg.sessions.find(session => (session.sessionId || session.id) === preferredSessionId) || msg.sessions[0];
              const preferredRunningSessionId = preferredSession.sessionId || preferredSession.id;
              if (preferredRunningSessionId) {
                ensureRunningSessionShell(preferredRunningSessionId, {
                  title: preferredSession.title,
                  projectId: preferredSession.projectId,
                  provider: preferredSession.provider,
                  timestamp: msg.timestamp || Date.now()
                });
                setCurrentSessionId(preferredRunningSessionId);
                currentSessionIdRef.current = preferredRunningSessionId;
                setCurrentProjectId(preferredSession.projectId || null);
                syncNewSessionProvider(preferredSession.provider);
                sendResumeRequest(newWs, preferredRunningSessionId, preferredSession.projectId, preferredSession.provider);
                pendingRunningSessionRestoreRef.current = null;
                debugLog('Reconnected to running session:', preferredRunningSessionId);
              }
            }
          }
        } else if (msg.type === 'session_running') {
          // Backward-compatible single-session running event
          debugLog('Session running on server:', msg.sessionId);
          if (msg.sessionId) {
            serverRehydratedRunningSessionsRef.current.add(msg.sessionId);
            if (pendingRunningSessionRestoreRef.current?.sessionId === msg.sessionId) {
              pendingRunningSessionRestoreRef.current = null;
            }
            setCurrentSessionId(msg.sessionId);
            currentSessionIdRef.current = msg.sessionId;
            setCurrentProjectId(msg.projectId || null);
            syncNewSessionProvider(msg.provider);
            applyRunningSessionSnapshot(msg.sessionId, {
              title: msg.title,
              projectId: msg.projectId,
              provider: msg.provider,
              timestamp: msg.timestamp || Date.now()
            });
            sendResumeRequest(newWs, msg.sessionId, msg.projectId, msg.provider);
            debugLog('Reconnected to running session:', msg.sessionId);
          }
        } else if (msg.type === 'session_running_state') {
          debugLog('Running session snapshot on server:', msg.sessionId, msg.reason);
          if (msg.sessionId) {
            serverRehydratedRunningSessionsRef.current.add(msg.sessionId);
            if (pendingRunningSessionRestoreRef.current?.sessionId === msg.sessionId) {
              pendingRunningSessionRestoreRef.current = null;
            }
            applyRunningSessionSnapshot(msg.sessionId, {
              title: msg.title,
              projectId: msg.projectId,
              provider: msg.provider,
              timestamp: msg.timestamp || Date.now()
            });
          }
        } else if (msg.type === 'discussion_running') {
          // Rehydrated running discussion after reconnecting
          debugLog('Discussion running on server:', msg.discussionId);
          if (msg.discussionId) {
            const discussionSessionId = `discussion_${msg.discussionId}`;
            serverRehydratedRunningSessionsRef.current.add(discussionSessionId);
            setRunningSessions(prev => new Set(prev).add(discussionSessionId));
            setRunningSessionsInfo(prev => {
              const next = new Map(prev);
              next.set(discussionSessionId, {
                title: 'Multi-agent discussion in progress...',
                provider: currentProvider
              });
              return next;
            });

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
              debugLog('[Discussion] Created temp session for running discussion:', tempSessionId);
            }

            // Restore the running discussion state
            discussion.restoreRunning(msg.discussionId);
            debugLog('Reconnected to running discussion:', msg.discussionId);
          }
        } else if (msg.type === 'claude_start') {
          // Claude is starting to respond
          debugLog('Claude started responding');
          const startTimestamp = msg.timestamp || Date.now();
          updateSessionAcrossCollections(targetSessionId, (session) => {
            const provider = msg.provider || session.provider || currentProvider;
            return {
              ...session,
              messages: updateRunningModelMessage(session.messages, provider, startTimestamp, (lastMsg) => ({
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
        } else if (msg.type === 'claude_tool') {
          // Handle tool use events
          debugLog('Tool use:', msg.toolName || msg.toolUseId);
          const toolTimestamp = msg.timestamp || Date.now();
          updateSessionAcrossCollections(targetSessionId, (session) => {
            const provider = msg.provider || session.provider || currentProvider;
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
              ...session,
              messages: updateRunningModelMessage(session.messages, provider, toolTimestamp, (lastMsg) => ({
                ...lastMsg,
                timestamp: toolTimestamp,
                status: 'sending',
                tools: upsertToolRecord(lastMsg.tools, msg, toolTimestamp),
                process: appendMessageProcessEvent(lastMsg.process, provider, processEvent)
              }))
            };
          });
        } else if (msg.type === 'claude_stream') {
          debugLog('Stream chunk, sessionId:', targetSessionId, 'replace:', msg.replace, 'done:', msg.done);
          const streamTimestamp = msg.timestamp || Date.now();

          // Apply streamed model updates to the session list
          updateSessionAcrossCollections(targetSessionId, (session) => {
            const provider = msg.provider || session.provider || currentProvider;
            const messages = session.messages;
            const lastMsg = messages[messages.length - 1];

            if (msg.content || msg.thinking) {
              if (!lastMsg || lastMsg.role !== 'model') {
                const newMsg: Message = {
                  id: Date.now().toString(),
                  role: 'model',
                  content: msg.content || '',
                  thinking: msg.thinking || '',
                  timestamp: streamTimestamp,
                  status: msg.done ? 'sent' : 'sending'
                };

                return { ...session, messages: [...messages, newMsg] };
              }

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

              return { ...session, messages: [...messages.slice(0, -1), updatedMsg] };
            }

            if (msg.done && lastMsg && lastMsg.role === 'model') {
              const updatedMsg = {
                ...lastMsg,
                timestamp: streamTimestamp,
                status: 'sent' as const,
                process: lastMsg.process
                  ? setMessageProcessState(lastMsg.process, provider, 'completed')
                  : lastMsg.process
              };

              return { ...session, messages: [...messages.slice(0, -1), updatedMsg] };
            }

            return session;
          });

          // When streaming finishes, clear running state and refresh project sessions
          if (msg.done) {
            const sessionId = targetSessionId;
            if (sessionId) {
              debugLog('[RunningSessions] Stream done, removing session:', sessionId);
              clearRunningSessionState(sessionId);
              // Mark the session as completed for the sidebar badge
              setCompletedSessions(prev => new Set(prev).add(sessionId));
            }
          }
        } else if (msg.type === 'claude_done' || msg.done) {
          debugLog('Claude done, sessionId:', targetSessionId);
          // Mark this session as done
          const doneSessionId = targetSessionId;
          if (doneSessionId) {
            debugLog('[RunningSessions] Removing session:', doneSessionId);
            clearRunningSessionState(doneSessionId);
            // Mark as completed for notification
            setCompletedSessions(prev => new Set(prev).add(doneSessionId));
          } else {
            console.warn('[RunningSessions] No sessionId in claude_done message!');
          }
          // Clear logs when done
          setServerLogs([]);
          updateSessionAcrossCollections(doneSessionId, (session) => {
            const messages = session.messages;
            const lastMsg = messages[messages.length - 1];
            const provider = msg.provider || session.provider || currentProvider;

            if (lastMsg && lastMsg.role === 'model') {
              return {
                ...session,
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

            return session;
          });
        } else if (msg.type === 'claude_log') {
          // Handle server log messages
          debugLog('Server log:', msg.level, msg.message);
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
            updateSessionAcrossCollections(targetSessionId, (session) => {
              const provider = msg.provider || session.provider || currentProvider;
              return {
                ...session,
                messages: updateRunningModelMessage(session.messages, provider, logTimestamp, (lastMsg) => ({
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
          }
        } else if (msg.type === 'claude_error') {
          debugLog('Claude error:', msg.error);
          // Mark this session as done (error)
          const errorSessionId = targetSessionId;
          const errorTimestamp = msg.timestamp || Date.now();
          const errorMessage = msg.error || t('common.unknownError');
          if (errorSessionId) {
            clearRunningSessionState(errorSessionId);
          }
          // Clear logs when done
          setServerLogs([]);
          updateSessionAcrossCollections(errorSessionId, (session) => {
            const provider = msg.provider || session.provider || currentProvider;
            return {
              ...session,
              messages: updateRunningModelMessage(session.messages, provider, errorTimestamp, (lastMsg) => ({
                ...lastMsg,
                content: lastMsg.content?.trim()
                  ? `${lastMsg.content}\n\n${t('process.state.error')}: ${errorMessage}`
                  : `${t('process.state.error')}: ${errorMessage}`,
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
        } else if (msg.type === 'command_result') {
          debugLog('Command result:', msg.command);
          // Handle command results
          const cmdSessionId = targetSessionId;
          updateSessionAcrossCollections(cmdSessionId, (session) => {
            const messages = session.messages;
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

              return { ...session, messages: [...messages.slice(0, -1), { ...lastMsg, content, status: 'sent' }] };
            }

            return session;
          });
          // Mark session as done after command result
          if (cmdSessionId) {
            clearRunningSessionState(cmdSessionId);
          }
        } else if (msg.type === 'stopped') {
          // Handle stop response from server
          debugLog('Session stopped:', msg.sessionId, 'success:', msg.success);
          if (msg.sessionId) {
            clearRunningSessionState(msg.sessionId);
          }
        } else if (msg.type === 'project_list') {
          // Handle project list from server
          debugLog('Received project list:', msg.projects);
          setProjects(msg.projects || []);
          setLoadingProjects(new Set());
          if (msg.projects && msg.projects.length > 0) {
            // Auto-expand the first (most recent) project to show sessions
            const firstProject = msg.projects[0];
            setExpandedProjects(prev => new Set(prev).add(firstProject.id));
            setLoadingProjects(prev => new Set(prev).add(firstProject.id));
            newWs.send(JSON.stringify({ type: 'session', action: 'list_by_project', projectId: firstProject.id }));
          }
        } else if (msg.type === 'session_list') {
          // Handle session list from server
          debugLog('Received session list:', msg.sessions, 'projectId:', msg.projectId);
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
                [msg.projectId!]: mergeSessionSummaryList(prev[msg.projectId!] || [], serverSessions)
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
            setSessions(prev => mergeSessionSummaryList(prev, serverSessions));

            // Skip auto-resume when a running session is already being restored.
            const shouldSkipAutoResume = Boolean(pendingRunningSessionRestoreRef.current) || runningSessionsRef.current.size > 0;
            if (!isRefreshingRef.current && !shouldSkipAutoResume) {
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
            const shouldSkipAutoCreate = Boolean(pendingRunningSessionRestoreRef.current) || runningSessionsRef.current.size > 0;
            if (!isRefreshingRef.current && !shouldSkipAutoCreate) {
              newWs.send(JSON.stringify({ type: 'session', action: 'new', provider: newSessionProvider }));
            } else {
              setSessions([]);
              isRefreshingRef.current = false;
            }
          }
        } else if (msg.type === 'session_created') {
          // Handle new session creation
          debugLog('Session created:', msg.session);
          debugLog('[session_created] pendingHostSessionRef.current:', pendingHostSessionRef.current ? 'HAS VALUE' : 'NULL');
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
            debugLog('[session_created] targetProjectId:', targetProjectId, 'currentProjectId:', currentProjectId);

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
              debugLog('[Discussion] Sending discussion record to new host session');
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
          debugLog('Session resumed:', msg.session, 'projectId:', msg.projectId, 'hasMore:', msg.hasMore, 'totalMessages:', msg.totalMessages);
          if (msg.session) {
            const sessionProvider = msg.session.provider || msg.provider || newSessionProvider;
            const resumedMessages = msg.session.messages || [];
            const shouldAppendRunningPlaceholder = runningSessionsRef.current.has(msg.session.id)
              && !(
                resumedMessages.length > 0
                && resumedMessages[resumedMessages.length - 1].role === 'model'
                && resumedMessages[resumedMessages.length - 1].status === 'sending'
              );
            const resumedSession: ChatSession = {
              id: msg.session.id,
              title: normalizeLegacyDisplayText(msg.session.summary || msg.session.title || 'Untitled'),
              messages: shouldAppendRunningPlaceholder
                ? [...resumedMessages, createReconnectedRunningMessage(sessionProvider, Date.now())]
                : resumedMessages,
              createdAt: msg.session.createdAt || Date.now(),
              provider: sessionProvider
            };
            if (pendingRunningSessionRestoreRef.current?.sessionId === resumedSession.id) {
              pendingRunningSessionRestoreRef.current = null;
            }

            // Update pagination state
            setHasMoreMessages(msg.hasMore || false);
            setTotalMessages(msg.totalMessages || msg.session.messages?.length || 0);

            // Check if this session is currently running (use ref for latest value)
            const isSessionRunning = runningSessionsRef.current.has(resumedSession.id);
            debugLog('[session_resumed] Session:', resumedSession.id.substring(0, 12), 'isRunning:', isSessionRunning);

            setSessions(prev => {
              const existingSession = prev.find(s => s.id === resumedSession.id) || null;
              const nextSession = mergeResumedSession(existingSession, resumedSession, isSessionRunning);

              if (existingSession) {
                debugLog(
                  '[session_resumed] Root merge chose',
                  nextSession.messages === existingSession.messages ? 'local messages' : 'resumed messages'
                );
                return prev.map(s => s.id === resumedSession.id ? nextSession : s);
              }

              return [nextSession, ...prev];
            });

            if (msg.projectId) {
              setProjectSessions(prev => {
                const projectSessionList = prev[msg.projectId!] || [];
                const existingSession = projectSessionList.find(s => s.id === resumedSession.id) || null;
                const nextSession = mergeResumedSession(existingSession, resumedSession, isSessionRunning);

                if (existingSession) {
                  debugLog(
                    '[session_resumed] Project merge chose',
                    nextSession.messages === existingSession.messages ? 'local messages' : 'resumed messages'
                  );
                  return {
                    ...prev,
                    [msg.projectId!]: projectSessionList.map(s => s.id === resumedSession.id ? nextSession : s)
                  };
                }

                return {
                  ...prev,
                  [msg.projectId!]: [nextSession, ...projectSessionList]
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
          debugLog('Session deleted:', msg.sessionId);
          setSessions(prev => prev.filter(s => s.id !== msg.sessionId));
          clearRunningSessionState(msg.sessionId);
          if (currentSessionIdRef.current === msg.sessionId) {
            setCurrentSessionId(null);
            currentSessionIdRef.current = null;
          }
        } else if (msg.type === 'session_renamed') {
          debugLog('Session renamed:', msg.sessionId, 'success:', msg.success, 'title:', msg.title);
          if (msg.sessionId && msg.success) {
            updateSessionAcrossCollections(msg.sessionId, session => ({
              ...session,
              title: normalizeLegacyDisplayText(msg.title || session.title)
            }));
          }
        } else if (msg.type === 'session_id_updated') {
          // Handle session ID update from server (when Claude CLI returns a new session ID)
          debugLog('Session ID updated:', msg.oldSessionId, '->', msg.newSessionId);
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
          renameRunningSessionState(msg.oldSessionId, msg.newSessionId, {
            title: msg.title,
            provider: msg.provider
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
      clearRunningSessionRehydrationTimeout();
      clearUiPreferencesTimeout();
      setIsConnected(false);
      setIsConnecting(false);
      setProcessPreferencesLoaded(false);
      setProcessPreferencesSaving(false);
      setServerAccess(DEFAULT_SERVER_ACCESS_STATE);
      debugLog('WebSocket disconnected');
    };

    newWs.onerror = (error) => {
      clearRunningSessionRehydrationTimeout();
      clearUiPreferencesTimeout();
      console.error('WebSocket error:', error);
      setIsConnecting(false);
      setIsConnected(false);
      setProcessPreferencesLoaded(false);
      setProcessPreferencesSaving(false);
      setServerAccess(DEFAULT_SERVER_ACCESS_STATE);
    };

    wsRef.current = newWs;
    setWs(newWs);
  }, [
    applyRunningSessionSnapshot,
    clearRunningSessionState,
    clearRunningSessionRehydrationTimeout,
    clearUiPreferencesTimeout,
    currentProvider,
    ensureRunningSessionShell,
    markSessionAsRunning,
    renameRunningSessionState,
    requestUiPreferences,
    sendResumeRequest,
    serverUrl,
    syncNewSessionProvider,
    token,
    updateSessionAcrossCollections,
    ws
  ]);

  const disconnect = useCallback(() => {
    clearUiPreferencesTimeout();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWs(null);
    }
    clearRunningSessionRehydrationTimeout();
    setIsConnected(false);
    setProcessPreferencesLoaded(false);
    setProcessPreferencesSaving(false);
    setServerAccess(DEFAULT_SERVER_ACCESS_STATE);
  }, [clearRunningSessionRehydrationTimeout, clearUiPreferencesTimeout]);

  useEffect(() => {
    return () => {
      clearRunningSessionRehydrationTimeout();
    };
  }, [clearRunningSessionRehydrationTimeout]);

  // Auto-connect on mount if URL and token are available
  useEffect(() => {
    if (serverUrl && token && !isConnected && !isConnecting) {
      debugLog('Auto-connecting with saved settings...');
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
    debugLog('[resumeSession] Called with sessionId:', sessionId, 'projectId:', projectId, 'isConnected:', isConnected);
    if (wsRef.current && isConnected) {
      const resolvedProvider = provider || resolveSessionProvider(sessionId, projectId);
      syncNewSessionProvider(resolvedProvider);
      setCurrentSessionId(sessionId);
      currentSessionIdRef.current = sessionId;
      setCurrentProjectId(projectId || null);
      debugLog('[resumeSession] Sending resume message for provider:', resolvedProvider);
      sendResumeRequest(wsRef.current, sessionId, projectId, resolvedProvider);
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
      debugLog('[sendMessageToSpecificSession] WebSocket not ready');
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

    markSessionAsRunning(sessionId, {
      title: text.substring(0, 30),
      projectId,
      provider
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

    debugLog('[sendMessageToSpecificSession] Sending message:', JSON.stringify(message));
    activeWs.send(JSON.stringify(message));
    return true;
  }

  // Send message
  const handleSend = async (text: string, attachments: Attachment[]) => {
    debugLog('[handleSend] called with text:', text?.substring(0, 30));
    debugLog('[handleSend] text length:', text?.length);
    debugLog('[handleSend] full text:', text);
    debugLog('[CLIENT-DEBUG] raw text:', JSON.stringify(text));
    debugLog('[handleSend] currentSessionIdRef.current:', currentSessionIdRef.current);
    debugLog('[handleSend] currentProjectId:', currentProjectId);
    debugLog('[handleSend] sessions.length:', sessions.length);
    debugLog('[handleSend] sessions[0]?.id:', sessions[0]?.id);

    if (!text.trim() && attachments.length === 0) return;

    // Use wsRef for latest connection
    const activeWs = wsRef.current;
    if (!activeWs || !isConnected) {
      debugLog('Not connected, ws:', activeWs, 'isConnected:', isConnected);
      return;
    }

    // Check for @ mentions - trigger discussion mode
    if (checkForDiscussion(text)) {
      debugLog('[handleSend] Detected @ mentions, starting discussion...');

      // Ensure there is a host session before starting the discussion flow
      if (!currentSessionIdRef.current) {
        debugLog('[handleSend] No current session for discussion, creating one...');
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
      debugLog('No current session, creating one...');
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
    debugLog('[RunningSessions] Adding session:', sessionId);
    markSessionAsRunning(sessionId, {
      title: text.substring(0, 30),
      projectId: currentProjectId,
      provider
    });

    debugLog('Sending message to WebSocket, sessionId:', sessionId, 'projectId:', currentProjectId);

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
      debugLog('[handleSend] Sending attachments:', attachments.length);
    }
    debugLog('[handleSend] Final message:', JSON.stringify(message));
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
      debugLog('[handleStop] Sent stop request for session:', sessionIdToStop);
    }
    // Update UI - mark this session as not running
    if (sessionIdToStop) {
      clearRunningSessionState(sessionIdToStop);
    }
  };

  const handleNewChat = () => {
    createNewSession(newSessionProvider);
    setIsSidebarOpen(false);
  };

  const handleTitleChange = (newTitle: string) => {
    if (!currentSessionId) return;
    updateSessionAcrossCollections(currentSessionId, session => (
      session.title === newTitle ? session : { ...session, title: newTitle }
    ));
  };

  // Persist title changes back to the server
  const handleTitleBlur = (newTitle: string) => {
    if (!currentSessionId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const nextTitle = newTitle.trim() ? newTitle : 'New Chat';
    updateSessionAcrossCollections(currentSessionId, session => (
      session.title === nextTitle ? session : { ...session, title: nextTitle }
    ));

    const message = {
      type: 'session',
      action: 'rename',
      sessionId: currentSessionId,
      title: nextTitle,
      projectId: currentProjectId,
      provider: currentSession?.provider,
      timestamp: Date.now()
    };
    wsRef.current.send(JSON.stringify(message));
    debugLog('[handleTitleBlur] Sent rename request:', message);
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
      <HeaderView
        onMenuClick={() => setIsSidebarOpen(true)}
        onNewChat={handleNewChat}
        title={currentSession?.title || ''}
        onTitleChange={handleTitleChange}
        onTitleBlur={handleTitleBlur}
        onSettingsClick={() => setShowSettings(!showSettings)}
        isConnected={isConnected}
        serverAccess={serverAccess}
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
                serverAccess={serverAccess}
                runtimeProfileProvider={runtimeProfileProvider}
                runtimeProfileState={runtimeProfiles[runtimeProfileProvider]}
                onRuntimeProfileProviderChange={handleRuntimeProfileProviderChange}
                onLoadRuntimeProfiles={requestRuntimeProfiles}
                onSwitchRuntimeProfile={handleSwitchRuntimeProfile}
                onToggleRuntimeProfileEditor={handleToggleRuntimeProfileEditor}
                onRuntimeProfileFieldChange={handleRuntimeProfileFieldChange}
                onSaveRuntimeProfile={handleSaveRuntimeProfile}
                processPanelPreferences={uiPreferences.processPanel}
                processPreferencesLoaded={processPreferencesLoaded}
                processPreferencesSaving={processPreferencesSaving}
                onProcessPanelPreferenceChange={handleProcessPanelPreferenceChange}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ScrollIndexView messages={messages} onJump={jumpToMessage} scrollRef={scrollRef} />

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
                <h2 className="text-xl font-semibold">{t('common.history')}</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadProjects(true)}
                    className="text-white/40 hover:text-white transition-colors"
                    title={t('common.refreshProjects')}
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button onClick={() => setIsSidebarOpen(false)} className="text-white/40">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 space-y-2 no-scrollbar">
                {runningSessions.size > 0 && (
                  <div className="space-y-1 pb-2">
                    <div className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
                      {t('sidebar.runningNow')}
                    </div>
                    {Array.from(runningSessions).map(sessionId => {
                      const { title, projectId, provider } = resolveRunningSessionDetails(sessionId);
                      const isActive = currentSessionId === sessionId && (currentProjectId || null) === (projectId || null);
                      return (
                        <button
                          key={`running-${sessionId}`}
                          onClick={() => {
                            resumeSession(sessionId, projectId, provider);
                            setIsSidebarOpen(false);
                            setCompletedSessions(prev => {
                              const next = new Set(prev);
                              next.delete(sessionId);
                              return next;
                            });
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors",
                            isActive
                              ? "border-accent/50 bg-accent/20 text-white"
                              : "border-yellow-500/20 bg-yellow-500/10 text-white/80 hover:border-yellow-400/30 hover:bg-yellow-500/15"
                          )}
                        >
                          <Loader2 size={16} className="text-yellow-300 animate-spin shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-300 flex-shrink-0 whitespace-nowrap">
                                {t('process.state.running')}
                              </span>
                              <span className="truncate text-sm font-medium">{localizeSessionTitle(title, t)}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-white/45">
                              <span className="font-mono truncate">{sessionId.substring(0, 8)}...</span>
                              {provider && (
                                <span className={cn(
                                  'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                  getProviderBadgeClass(provider)
                                )}>
                                  {getProviderLabel(provider, t)}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-white/30 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {projects.length === 0 ? (
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/60">
                    {isConnected ? t('sidebar.noProjects.connected') : t('sidebar.noProjects.disconnected')}
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
                          {getProviderLabel(project.provider, t)}
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
                              {t('sidebar.loadingProjects')}
                            </div>
                          ) : (
                            (projectSessions[project.id] || []).map(session => {
                              const isRunning = runningSessions.has(session.id);
                              const hasRenderableResult = sessionHasRenderableResult(session.id, project.id, session);
                              const isCompleted = completedSessions.has(session.id) && hasRenderableResult;
                              // Debug: always log for troubleshooting
                              if (runningSessions.size > 0 || completedSessions.size > 0) {
                                debugLog('[Sidebar] Checking session:', session.id.substring(0, 12),
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
                                        {t('process.state.running')}
                                      </span>
                                    ) : isCompleted ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-green-400 flex-shrink-0 whitespace-nowrap">
                                        {t('process.state.completed')}
                                      </span>
                                    ) : null}
                                    <span className="truncate flex items-center gap-1 min-w-0 flex-1">
                                      <FileText size={12} className="inline opacity-50 flex-shrink-0" />
                                      <span className="truncate">{localizeSessionTitle(normalizeLegacyDisplayText(session.title), t)}</span>
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
                                  title={t('common.deleteSession')}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            );
                            })
                          )}
                          {projectSessions[project.id]?.length === 0 && !loadingProjects.has(project.id) && (
                            <div className="p-2 text-xs text-white/40 text-center">
                              {t('common.noSessions')}
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
                  {t('common.newChat')}
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
                  <span>{t('common.loading')}</span>
                </>
              ) : (
                <>
                  <ChevronUp size={16} />
                  <span>{t('messages.loadEarlier', { count: totalMessages - messages.length })}</span>
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
                  const { title, projectId, provider } = resolveRunningSessionDetails(sessionId);
                  const displayTitle = title;

                  return (
                    <motion.div
                      key={sessionId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-3 bg-gradient-to-r from-accent/10 to-purple-500/10 rounded-xl border border-accent/20 cursor-pointer hover:border-accent/40 transition-colors"
                      onClick={() => {
                        debugLog('[RunningTaskCard] Clicked session:', sessionId, 'projectId:', projectId);
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
                          <div className="text-sm font-medium text-white truncate">{localizeSessionTitle(displayTitle, t)}</div>
                          {provider && (
                            <span className={cn(
                              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                              getProviderBadgeClass(provider)
                            )}>
                              {getProviderLabel(provider, t)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/50">{t('sidebar.runningTapToView')}</div>
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
              {t('empty.description')}
            </p>
            <div className="mt-6 text-xs text-white/30">
              <div className="flex items-center gap-2 mb-2">
                <Hash size={12} />
                <span>{t('empty.commands')}</span>
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
              <ChatBubbleView
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
                  <span className="text-sm font-medium text-white">{t('stream.processingProvider', { provider: getProviderLabel(currentProvider, t) })}</span>
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

      <InputAreaView
        onSend={handleSend}
        isGenerating={isGenerating}
        onStop={handleStop}
        isConnected={isConnected}
        onFocus={handleInputFocus}
      />
    </div>
  );
}
