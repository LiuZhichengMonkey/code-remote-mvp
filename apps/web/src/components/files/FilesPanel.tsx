import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Folder,
  RefreshCw,
  X
} from 'lucide-react';
import { RemoteFileEntry } from '../../types';
import { cn } from '../../utils';
import { useI18n } from '../../i18n';

type FilesTab = 'session' | 'recent' | 'workspace';

interface FilesPanelProps {
  isOpen: boolean;
  isConnected: boolean;
  activeTab: FilesTab;
  currentPath: string;
  parentPath: string | null;
  sessionFiles: RemoteFileEntry[];
  recentFiles: RemoteFileEntry[];
  workspaceEntries: RemoteFileEntry[];
  isLoading: boolean;
  error?: string | null;
  downloadingPath?: string | null;
  onClose: () => void;
  onTabChange: (tab: FilesTab) => void;
  onRefresh: () => void;
  onOpenPath: (path: string) => void;
  onOpenFile: (entry: RemoteFileEntry) => void;
  onDownload: (path: string, fileName?: string) => void;
}

interface FileLabels {
  title: string;
  session: string;
  recent: string;
  workspace: string;
  close: string;
  refresh: string;
  disconnected: string;
  emptySession: string;
  emptyRecent: string;
  emptyWorkspace: string;
  root: string;
  up: string;
  loading: string;
  unavailable: string;
  download: string;
  downloadFile: string;
  downloadFolder: string;
  openFolder: string;
  source: Record<RemoteFileEntry['source'], string>;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / Math.pow(1024, exponent);
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatFileTime(timestamp: number, language: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function buildBreadcrumbs(currentPath: string, rootLabel: string): Array<{ label: string; path: string }> {
  const segments = currentPath.split('/').filter(Boolean);
  const breadcrumbs = [{ label: rootLabel, path: '' }];
  let nextPath = '';

  for (const segment of segments) {
    nextPath = nextPath ? `${nextPath}/${segment}` : segment;
    breadcrumbs.push({ label: segment, path: nextPath });
  }

  return breadcrumbs;
}

function FileEntryRow({
  entry,
  labels,
  language,
  downloadingPath,
  onOpenPath,
  onOpenFile,
  onDownload
}: {
  entry: RemoteFileEntry;
  labels: FileLabels;
  language: string;
  downloadingPath?: string | null;
  onOpenPath: (path: string) => void;
  onOpenFile: (entry: RemoteFileEntry) => void;
  onDownload: (path: string, fileName?: string) => void;
}) {
  const isDirectory = entry.kind === 'directory';
  const isAvailable = entry.available !== false;
  const isDownloading = isAvailable && downloadingPath === entry.relativePath;
  const canDownload = isAvailable;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors',
        !isAvailable && 'opacity-70',
        isDirectory
          ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
          : (isAvailable
            ? 'border-white/10 bg-black/15 hover:bg-white/[0.04]'
            : 'border-white/10 bg-black/10')
      )}
    >
      <button
        type="button"
        onClick={() => {
          if (isDirectory) {
            onOpenPath(entry.relativePath);
            return;
          }

          if (canDownload) {
            onOpenFile(entry);
          }
        }}
        disabled={!isDirectory && !canDownload}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 text-left',
          !isDirectory && !canDownload && 'cursor-not-allowed'
        )}
      >
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
            isDirectory
              ? 'border-amber-400/20 bg-amber-500/10 text-amber-200'
              : 'border-sky-400/20 bg-sky-500/10 text-sky-200'
          )}
        >
          {isDirectory ? <Folder size={18} /> : <FileText size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{entry.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
                isDirectory
                  ? 'border-white/10 bg-white/5 text-white/40'
                  : 'border-white/10 bg-black/20 text-white/45'
              )}
            >
              {isDirectory ? labels.workspace : labels.source[entry.source]}
            </span>
            {!isDirectory && !isAvailable && (
              <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-200">
                {labels.unavailable}
              </span>
            )}
            {isDirectory ? <span>{labels.downloadFolder}</span> : <span>{formatFileSize(entry.size)}</span>}
            <span>{formatFileTime(entry.mtime, language)}</span>
          </div>
        </div>
      </button>

      {isDirectory ? (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onDownload(entry.relativePath, `${entry.name}.zip`)}
            disabled={!canDownload || isDownloading}
            className={cn(
              'rounded-full border border-white/10 bg-white/5 p-2 transition-colors',
              !canDownload
                ? 'cursor-not-allowed text-white/20'
                : isDownloading
                ? 'text-white/30'
                : 'text-white/50 hover:bg-white/10 hover:text-white'
            )}
            title={labels.downloadFolder}
            aria-label={labels.downloadFolder}
          >
            {isDownloading ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
          </button>
          <button
            type="button"
            onClick={() => onOpenPath(entry.relativePath)}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
            title={labels.openFolder}
            aria-label={labels.openFolder}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onDownload(entry.relativePath, entry.name)}
          disabled={!canDownload || isDownloading}
          className={cn(
            'rounded-full border border-white/10 bg-white/5 p-2 transition-colors',
            !canDownload
              ? 'cursor-not-allowed text-white/20'
              : isDownloading
              ? 'text-white/30'
              : 'text-white/50 hover:bg-white/10 hover:text-white'
          )}
          title={labels.downloadFile}
          aria-label={labels.downloadFile}
        >
          {isDownloading ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
        </button>
      )}
    </div>
  );
}

export const FilesPanel = ({
  isOpen,
  isConnected,
  activeTab,
  currentPath,
  parentPath,
  sessionFiles,
  recentFiles,
  workspaceEntries,
  isLoading,
  error,
  downloadingPath,
  onClose,
  onTabChange,
  onRefresh,
  onOpenPath,
  onOpenFile,
  onDownload
}: FilesPanelProps) => {
  const { language } = useI18n();

  const labels = useMemo<FileLabels>(() => (
    language === 'zh-CN'
      ? {
          title: '\u6587\u4ef6',
          session: '\u4f1a\u8bdd',
          recent: '\u6700\u8fd1',
          workspace: '\u5de5\u4f5c\u533a',
          close: '\u5173\u95ed',
          refresh: '\u5237\u65b0',
          disconnected: '\u8bf7\u5148\u8fde\u63a5\u5230\u670d\u52a1\u7aef\uff0c\u518d\u6d4f\u89c8\u6216\u4e0b\u8f7d\u6587\u4ef6\u3002',
          emptySession: '\u8fd9\u4e2a\u4f1a\u8bdd\u8fd8\u6ca1\u6709\u5173\u8054\u6587\u4ef6\u3002',
          emptyRecent: '\u6682\u65e0\u6700\u8fd1\u6587\u4ef6\u3002',
          emptyWorkspace: '\u5f53\u524d\u76ee\u5f55\u4e3a\u7a7a\u3002',
          root: '\u5de5\u4f5c\u533a\u6839\u76ee\u5f55',
          up: '\u8fd4\u56de\u4e0a\u4e00\u7ea7',
          loading: '\u6b63\u5728\u52a0\u8f7d\u6587\u4ef6...',
          unavailable: '\u5df2\u5931\u6548',
          download: '\u4e0b\u8f7d',
          downloadFile: '\u4e0b\u8f7d\u6587\u4ef6',
          downloadFolder: '\u4e0b\u8f7d\u6587\u4ef6\u5939',
          openFolder: '\u6253\u5f00\u6587\u4ef6\u5939',
          source: {
            workspace: '\u5de5\u4f5c\u533a',
            attachment: '\u9644\u4ef6',
            upload: '\u4e0a\u4f20',
            export: '\u5bfc\u51fa',
            recent: '\u6700\u8fd1'
          }
        }
      : {
          title: 'Files',
          session: 'Session',
          recent: 'Recent',
          workspace: 'Workspace',
          close: 'Close',
          refresh: 'Refresh',
          disconnected: 'Connect to the server before browsing or downloading files.',
          emptySession: 'No files linked to this session yet.',
          emptyRecent: 'No recent files yet.',
          emptyWorkspace: 'This folder is empty.',
          root: 'Workspace Root',
          up: 'Up',
          loading: 'Loading files...',
          unavailable: 'Unavailable',
          download: 'Download',
          downloadFile: 'Download file',
          downloadFolder: 'Download folder',
          openFolder: 'Open folder',
          source: {
            workspace: 'Workspace',
            attachment: 'Attachment',
            upload: 'Upload',
            export: 'Export',
            recent: 'Recent'
          }
        }
  ), [language]);

  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(currentPath, labels.root),
    [currentPath, labels.root]
  );
  const activeEntries = activeTab === 'session'
    ? sessionFiles
    : (activeTab === 'recent' ? recentFiles : workspaceEntries);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-0 top-[50px] bottom-0 z-[56] overflow-hidden bg-black/55 backdrop-blur-xl"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Folder size={16} className="text-amber-200" />
                  <span>{labels.title}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-white/45">
                  <Clock3 size={12} />
                  <span>{activeTab === 'session' ? labels.session : (activeTab === 'recent' ? labels.recent : labels.workspace)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRefresh}
                  className="rounded-full border border-white/10 bg-white/5 p-2 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  title={labels.refresh}
                >
                  <RefreshCw size={16} className={cn(isLoading && 'animate-spin')} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/10 bg-white/5 p-2 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  title={labels.close}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="border-b border-white/10 px-4 py-3">
              <div className="grid grid-cols-3 gap-2">
                {(['session', 'recent', 'workspace'] as FilesTab[]).map(tab => {
                  const selected = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => onTabChange(tab)}
                      className={cn(
                        'rounded-2xl border px-3 py-3 text-left transition-colors',
                        selected
                          ? 'border-accent/35 bg-accent/15 text-white'
                          : 'border-white/10 bg-black/15 text-white/65 hover:bg-white/[0.05]'
                      )}
                    >
                      <div className="text-sm font-medium">
                        {tab === 'session' ? labels.session : (tab === 'recent' ? labels.recent : labels.workspace)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {activeTab === 'workspace' && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {breadcrumbs.map((crumb, index) => (
                      <React.Fragment key={crumb.path || 'root'}>
                        {index > 0 && <ChevronRight size={12} className="text-white/25" />}
                        <button
                          type="button"
                          onClick={() => onOpenPath(crumb.path)}
                          className={cn(
                            'max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                            crumb.path === currentPath
                              ? 'border-white/15 bg-white/[0.08] text-white'
                              : 'border-white/10 bg-black/20 text-white/55 hover:bg-white/[0.05]'
                          )}
                        >
                          {crumb.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenPath(parentPath || '')}
                    disabled={parentPath === null}
                    className={cn(
                      'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                      parentPath === null
                        ? 'cursor-not-allowed border-white/10 bg-black/20 text-white/25'
                        : 'border-white/10 bg-black/20 text-white/60 hover:bg-white/[0.05]'
                    )}
                  >
                    {labels.up}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownload(
                      currentPath,
                      `${(currentPath.split('/').filter(Boolean).pop() || 'workspace')}.zip`
                    )}
                    disabled={downloadingPath === currentPath}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] transition-colors',
                      downloadingPath === currentPath
                        ? 'cursor-wait text-white/35'
                        : 'text-white/60 hover:bg-white/[0.05]'
                    )}
                    title={labels.downloadFolder}
                    aria-label={labels.downloadFolder}
                  >
                    {downloadingPath === currentPath ? (
                      <RefreshCw size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    <span>{labels.download}</span>
                  </button>
                </div>
              )}
            </div>

            <div
              className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+20px)] touch-pan-y"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {!isConnected ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/55">
                  {labels.disconnected}
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">
                  {error}
                </div>
              ) : isLoading && activeEntries.length === 0 ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/45">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>{labels.loading}</span>
                </div>
              ) : activeEntries.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/45">
                  {activeTab === 'session'
                    ? labels.emptySession
                    : (activeTab === 'recent' ? labels.emptyRecent : labels.emptyWorkspace)}
                </div>
              ) : (
                <div className="space-y-2">
                  {activeEntries.map(entry => (
                    <FileEntryRow
                      key={`${entry.kind}:${entry.relativePath || entry.name}`}
                      entry={entry}
                      labels={labels}
                      language={language}
                      downloadingPath={downloadingPath}
                      onOpenPath={onOpenPath}
                      onOpenFile={onOpenFile}
                      onDownload={onDownload}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
