import { useEffect, useState } from 'react';
import { FolderOpen, Menu, Plus, Settings, Wifi, WifiOff } from 'lucide-react';
import { Provider, ServerAccessState } from '../../types';
import { cn } from '../../utils';
import { getProviderBadgeClass, getProviderLabel, localizeSessionTitle } from '../../chatUiShared';
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
  onNewSessionProviderChange: (provider: Provider) => void;
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
  onNewSessionProviderChange
}: HeaderProps) => {
  const { language, t } = useI18n();
  const isTesterMode = serverAccess.accessMode === 'tester';
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isComposingTitle, setIsComposingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const filesLabel = language === 'zh-CN' ? '\u6587\u4ef6' : 'Files';

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(title);
    }
  }, [isEditingTitle, title]);

  const commitTitle = (value: string) => {
    const nextTitle = value.trim() ? value : 'New Chat';
    setTitleDraft(nextTitle);
    setIsEditingTitle(false);
    onTitleChange(nextTitle);
    onTitleBlur(nextTitle);
  };

  return (
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
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
            getProviderBadgeClass(currentProvider)
          )}
        >
          {getProviderLabel(currentProvider, t)}
        </span>
        {isConnected && isTesterMode && (
          <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
            {t('header.testModeBadge', { ownerId: serverAccess.ownerId || 'tester' })}
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
          className="bg-transparent text-[13px] font-medium text-white/50 tracking-wide uppercase text-center focus:outline-none focus:text-white/80 w-full max-w-[200px]"
          placeholder={t('session.defaultTitle')}
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
              title={t('header.newProviderSession', { provider: getProviderLabel(provider, t) })}
            >
              {getProviderLabel(provider, t)}
            </button>
          ))}
        </div>
        <button
          onClick={() => onFilesClick?.()}
          className="p-2 text-white/70 active:text-white"
          title={filesLabel}
        >
          <FolderOpen size={18} />
        </button>
        <button onClick={onSettingsClick} className="settings-toggle-btn p-2 text-white/70 active:text-white">
          <Settings size={18} />
        </button>
        <button onClick={onNewChat} className="p-2 -mr-2 text-white/70 active:text-white">
          <Plus size={20} />
        </button>
      </div>
    </header>
  );
};
