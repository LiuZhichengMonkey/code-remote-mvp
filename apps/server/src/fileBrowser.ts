import fs from 'fs';
import path from 'path';
import { AccessIdentity } from './accessControl';
import { resolveSessionWorkspace } from './sessionWorkspace';

export type RemoteFileSource = 'workspace' | 'attachment' | 'upload' | 'export' | 'recent';

export interface RemoteFileEntry {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  size: number;
  mtime: number;
  source: RemoteFileSource;
  mimeType?: string;
}

export interface WorkspaceFileListResult {
  rootPath: string;
  path: string;
  parentPath: string | null;
  entries: RemoteFileEntry[];
}

export interface RemoteAttachmentDescriptor {
  id: string;
  name: string;
  type: string;
  relativePath: string;
  size?: number;
}

const RECENT_SCAN_LIMIT = 60;
const RECENT_SKIP_DIRS = new Set(['.git', 'node_modules']);

const MIME_TYPE_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.log': 'text/plain'
};

function toPortablePath(value: string): string {
  return value.split(path.sep).join('/');
}

function getParentRelativePath(value: string): string | null {
  if (!value) {
    return null;
  }

  const parent = path.dirname(value);
  return parent === '.' ? '' : toPortablePath(parent);
}

function getSafeRelativePath(rootPath: string, targetPath: string): string {
  const relativePath = path.relative(rootPath, targetPath);
  if (
    relativePath.startsWith('..')
    || path.isAbsolute(relativePath)
    || relativePath.includes(`..${path.sep}`)
  ) {
    throw new Error('PATH_OUTSIDE_ROOT');
  }

  return relativePath === '' ? '' : toPortablePath(relativePath);
}

export function resolveAccessibleWorkspaceRoot(
  workspaceRoot: string,
  accessIdentity?: AccessIdentity
): string {
  return resolveSessionWorkspace(workspaceRoot, accessIdentity).workspacePath;
}

export function resolvePathWithinWorkspaceRoot(
  workspaceRoot: string,
  relativePath?: string | null
): { absolutePath: string; relativePath: string } {
  const safePath = (relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const absolutePath = path.resolve(workspaceRoot, safePath || '.');
  return {
    absolutePath,
    relativePath: getSafeRelativePath(workspaceRoot, absolutePath)
  };
}

export function sanitizeUploadFileName(originalName: string, index = 0): string {
  const fallbackExt = path.extname(originalName) || '';
  const extension = fallbackExt || '';
  const baseName = path.basename(originalName || `uploaded-file-${index}`, extension)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const safeBaseName = baseName || `uploaded-file-${index}`;
  return `${safeBaseName}_${Date.now()}_${index}${extension}`;
}

export function inferRemoteFileSource(relativePath: string): RemoteFileSource {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();

  if (normalized.includes('/.coderemote/temp_images/') || normalized.startsWith('.coderemote/temp_images/')) {
    return 'attachment';
  }

  if (normalized.includes('/uploads/') || normalized.startsWith('uploads/') || normalized.includes('/runtime/uploads/')) {
    return 'upload';
  }

  if (normalized.includes('/export') || normalized.includes('/exports/') || normalized.endsWith('.zip')) {
    return 'export';
  }

  return 'recent';
}

export function getMimeTypeForPath(filePath: string): string {
  return MIME_TYPE_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function toRemoteFileEntry(rootPath: string, absolutePath: string, kind: 'file' | 'directory'): RemoteFileEntry {
  const stats = fs.statSync(absolutePath);
  const relativePath = getSafeRelativePath(rootPath, absolutePath);

  return {
    name: path.basename(absolutePath),
    relativePath,
    kind,
    size: kind === 'file' ? stats.size : 0,
    mtime: stats.mtimeMs,
    source: kind === 'file' ? inferRemoteFileSource(relativePath) : 'workspace',
    ...(kind === 'file' ? { mimeType: getMimeTypeForPath(absolutePath) } : {})
  };
}

export function listWorkspaceEntries(
  workspaceRoot: string,
  relativePath?: string | null
): WorkspaceFileListResult {
  const { absolutePath, relativePath: resolvedRelativePath } = resolvePathWithinWorkspaceRoot(workspaceRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error('FILE_NOT_FOUND');
  }

  const stats = fs.statSync(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error('NOT_A_DIRECTORY');
  }

  const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
    .filter(entry => !entry.isSymbolicLink())
    .map(entry => ({
      entry,
      absoluteEntryPath: path.join(absolutePath, entry.name)
    }))
    .filter(({ entry, absoluteEntryPath }) => (
      entry.isDirectory() || (entry.isFile() && fs.existsSync(absoluteEntryPath))
    ))
    .map(({ entry, absoluteEntryPath }) => toRemoteFileEntry(
      workspaceRoot,
      absoluteEntryPath,
      entry.isDirectory() ? 'directory' : 'file'
    ))
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1;
      }

      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

  return {
    rootPath: workspaceRoot,
    path: resolvedRelativePath,
    parentPath: getParentRelativePath(resolvedRelativePath),
    entries
  };
}

export function listRecentWorkspaceFiles(
  workspaceRoot: string,
  limit = RECENT_SCAN_LIMIT
): RemoteFileEntry[] {
  const stack = [workspaceRoot];
  const files: RemoteFileEntry[] = [];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath || !fs.existsSync(currentPath)) {
      continue;
    }

    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const absoluteEntryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!RECENT_SKIP_DIRS.has(entry.name)) {
          stack.push(absoluteEntryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push(toRemoteFileEntry(workspaceRoot, absoluteEntryPath, 'file'));
    }
  }

  const sourcePriority = (source: RemoteFileSource): number => {
    switch (source) {
      case 'attachment':
        return 4;
      case 'upload':
        return 3;
      case 'export':
        return 2;
      case 'recent':
        return 1;
      default:
        return 0;
    }
  };

  return files
    .sort((a, b) => {
      const priorityDelta = sourcePriority(b.source) - sourcePriority(a.source);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return b.mtime - a.mtime;
    })
    .slice(0, limit);
}

export function createRemoteAttachmentDescriptor(
  workspaceRoot: string,
  filePath: string,
  options?: {
    id?: string;
    originalName?: string;
    mimeType?: string;
  }
): RemoteAttachmentDescriptor {
  const relativePath = getSafeRelativePath(workspaceRoot, filePath);
  const fileStats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;

  return {
    id: options?.id || relativePath,
    name: options?.originalName || path.basename(filePath),
    type: options?.mimeType || getMimeTypeForPath(filePath),
    relativePath,
    ...(fileStats ? { size: fileStats.size } : {})
  };
}
