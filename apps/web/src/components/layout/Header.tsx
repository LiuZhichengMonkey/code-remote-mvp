import { useEffect, useState } from 'react';
import { FolderOpen, Menu, Plus, Settings, Wifi, WifiOff } from 'lucide-react';
import { Provider, ServerAccessState, SessionContextUsage } from '../../types';
import { cn } from '../../utils';
import { getFallbackProvider, getProviderBadgeClass, getProviderLabel, isProviderTemporarilyUnavailable, localizeSessionTitle } from '../../chatUiShared';
import { useI18n } from '../../i18n';

interface HeaderProps {
  isConnected: boolean;
  serverAccess: ServerAccessState;
  currentProvider: Provider;
  title: string;
  onTitleChange: (value: string) => void;
  onTitleBlur: (value: string) => void;
  onMenuClick: () => void;
  onFilesClick?: () => void;
  onSettingsClick: () => void;
  onNewChat: () => void;
  newSessionProvider: Provider;
  supportedProviders: Provider[];
  onNewSessionProviderChange: (provider: Provider) => void;
  contextUsage?: SessionContextUsage | null;
}

export const Header = ({
  isConnected,
  currentProvider,
  title,
  onTitleChange,
  onTitleBlur,
  onMenuClick,
  onFilesClick,
  onSettingsClick,
  onNewChat,
  serverAccess,
  newSessionProvider,
  supportedProviders,
  onNewSessionProviderChange,
  contextUsage
}: HeaderProps) => {
  const { language, t } = useI18n();
  const isTesterMode = serverAccess.accessMode === 'tester';
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isComposingTitle, setIsComposingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const filesLabel = language === 'zh-CN' ? '\u6587\u4ef6' : 'Files';
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const tokenFormatter = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1
  });

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(title);
    }
  }, [isEditingTitle, title]);

  const formatTokenCount = (value: number): string => tokenFormatter.format(Math.max(0, Math.round(value)));
  const contextUsageProgress = contextUsage
    ? Math.max(0, Math.min(100, contextUsage.isOverBudget ? 100 : contextUsage.usedPercent))
    : 0;
  const contextUsageToneClass = contextUsage
    ? (contextUsage.isOverBudget
      ? 'border-red-400/20 bg-red-500/10 text-red-200'
      : contextUsage.remainingPercent <= 20
        ? 'border-amber-400/20 bg-amber-500/10 text-amber-200'
        : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100')
    : '';

  const contextUsageLabel = contextUsage
    ? (language === 'zh-CN'
      ? `剩余 ${contextUsage.remainingPercent}% · ${formatTokenCount(contextUsage.remainingTokens)}`
      : `${contextUsage.remainingPercent}% left · ${formatTokenCount(contextUsage.remainingTokens)}`)
    : '';

  const contextUsageTitle = contextUsage
    ? (language === 'zh-CN'
      ? `估算剩余上下文：${formatTokenCount(contextUsage.remainingTokens)} / ${formatTokenCount(contextUsage.budgetTokens)} tokens`
      : `Estimated remaining context: ${formatTokenCount(contextUsage.remainingTokens)} / ${formatTokenCount(contextUsage.budgetTokens)} tokens`)
    : '';

  const getProviderToggleLabel = (provider: Provider): string => {
    switch (provider) {
      case 'claude':
        return 'Cl';
      case 'codex':
        return 'Cx';
      default:
        return getProviderLabel(provider, t);
    }
  };

  const commitTitle = (value: string) => {
    const nextTitle = value.trim() ? value : 'New Chat';
    setTitleDraft(nextTitle);
    setIsEditingTitle(false);
    onTitleChange(nextTitle);
    onTitleBlur(nextTitle);
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-[50px] z-50 flex items-center justify-between px-4 bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button onClick={onMenuClick} className="shrink-0 p-2 -ml-2 text-white/70 active:text-white">
        <Menu size={20} />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 sm:gap-2 sm:px-4">
        {isConnected ? (
          <Wifi size={14} className="shrink-0 text-green-400" />
        ) : (
          <WifiOff size={14} className="shrink-0 text-red-400" />
        )}
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium sm:px-2',
            getProviderBadgeClass(currentProvider)
          )}
        >
          {getProviderLabel(currentProvider, t)}
        </span>
        {isConnected && isTesterMode && (
          <span className="hidden shrink-0 items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 sm:inline-flex">
            {t('header.testModeBadge', { ownerId: serverAccess.ownerId || 'tester' })}
          </span>
        )}
        {contextUsage && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium sm:px-2',
              contextUsageToneClass
            )}
            title={contextUsageTitle}
          >
            <span className="sm:hidden">{contextUsage.isOverBudget ? '!' : `${contextUsage.remainingPercent}%`}</span>
            <span className="hidden sm:inline">
              {contextUsage.isOverBudget
                ? `Ctx !`
                : `Ctx ${contextUsage.remainingPercent}% left`}
            </span>
            <span className="inline-flex h-1.5 w-10 overflow-hidden rounded-full bg-white/10 sm:w-12">
              <span
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  contextUsage.isOverBudget
                    ? 'bg-red-300'
                    : contextUsage.remainingPercent <= 20
                      ? 'bg-amber-300'
                      : 'bg-cyan-300'
                )}
                style={{ width: `${contextUsageProgress}%` }}
              />
            </span>
          </span>
        )}
        <input
          value={isEditingTitle ? titleDraft : localizeSessionTitle(title, t)}
          onFocus={() => {
            setIsEditingTitle(true);
            setTitleDraft(title);
          }}
          onChange={(e) => {
            const nextTitle = e.target.value;
            setTitleDraft(nextTitle);
            onTitleChange(nextTitle);
          }}
          onBlur={(e) => commitTitle(e.target.value)}
          onCompositionStart={() => setIsComposingTitle(true)}
          onCompositionEnd={(e) => {
            setIsComposingTitle(false);
            const nextTitle = e.currentTarget.value;
            setTitleDraft(nextTitle);
            onTitleChange(nextTitle);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isComposingTitle) {
              e.currentTarget.blur();
            }
          }}
          className="min-w-0 w-full max-w-[88px] bg-transparent text-center text-[12px] font-medium uppercase tracking-wide text-white/50 focus:outline-none focus:text-white/80 sm:max-w-[200px] sm:text-[13px]"
          placeholder={t('session.defaultTitle')}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="flex shrink-0 items-center rounded-lg border border-white/10 bg-white/5 p-0.5 sm:p-1">
          {supportedProviders.map(provider => (
            (() => {
              const isUnavailable = isProviderTemporarilyUnavailable(provider);
              return (
                <button
                  key={provider}
                  disabled={isUnavailable}
                  onClick={() => onNewSessionProviderChange(getFallbackProvider(provider, supportedProviders))}
                  className={cn(
                    'rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors sm:px-2 sm:text-[11px]',
                    isUnavailable
                      ? 'cursor-not-allowed text-white/25 opacity-60'
                      : newSessionProvider === provider
                        ? 'bg-white text-black'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                  )}
                  title={isUnavailable
                    ? t('provider.temporarilyUnavailable', { provider: getProviderLabel(provider, t) })
                    : t('header.newProviderSession', { provider: getProviderLabel(provider, t) })}
                  aria-label={isUnavailable
                    ? t('provider.temporarilyUnavailable', { provider: getProviderLabel(provider, t) })
                    : t('header.newProviderSession', { provider: getProviderLabel(provider, t) })}
                >
                  <span className="inline-flex items-center gap-1 sm:hidden">
                    <span>{getProviderToggleLabel(provider)}</span>
                    {isUnavailable && <span className="text-[8px] text-amber-300">!</span>}
                  </span>
                  <span className="hidden items-center gap-1 sm:inline-flex">
                    <span>{getProviderLabel(provider, t)}</span>
                    {isUnavailable && (
                      <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-200">
                        {t('common.temporarilyUnavailable')}
                      </span>
                    )}
                  </span>
                </button>
              );
            })()
          ))}
        </div>
        <button
          onClick={() => onFilesClick?.()}
          className="shrink-0 p-2 text-white/70 active:text-white"
          title={filesLabel}
        >
          <FolderOpen size={18} />
        </button>
        <button onClick={onSettingsClick} className="settings-toggle-btn shrink-0 p-2 text-white/70 active:text-white">
          <Settings size={18} />
        </button>
        <button onClick={onNewChat} className="shrink-0 p-2 -mr-2 text-white/70 active:text-white">
          <Plus size={20} />
        </button>
      </div>
    </header>
  );
};
