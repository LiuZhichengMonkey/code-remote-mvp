import fs from 'fs';
import path from 'path';
import { AccessIdentity } from './accessControl';
import { ClaudeMessage, ClaudeSession, MessageProcessEvent } from './claude/types';
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
  available?: boolean;
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
  available?: boolean;
}

interface ResolvedRemoteFileReference {
  absolutePath: string;
  relativePath: string;
  available: boolean;
}

interface SessionFileReference {
  absolutePath: string;
  entry: RemoteFileEntry;
}

const RECENT_SCAN_LIMIT = 60;
const SESSION_RECENT_LIMIT = 40;
const RECENT_SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT_FILE_PATH_PATTERN = /(?:[A-Za-z]:[\\/][^\s"'`<>|]+|(?:\.{1,2}[\\/]|\/)[^\s"'`<>|]+|(?:[\w.-]+[\\/])+[\w.-]+(?:\.[\w.-]+)?)/g;
const MARKDOWN_FILE_LINK_PATTERN = /\[[^\]]+\]\(([^)\s]+)\)/g;

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

function normalizeReferencePathKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
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

  if (
    normalized.includes('/.coderemote/uploads/')
    || normalized.startsWith('uploads/')
    || normalized.includes('/runtime/uploads/')
    || normalized.includes('/storage/uploads/')
  ) {
    return 'upload';
  }

  if (
    normalized.includes('/storage/exports/')
    || normalized.includes('/exports/')
    || normalized.endsWith('.zip')
  ) {
    return 'export';
  }

  return 'recent';
}

export function getMimeTypeForPath(filePath: string): string {
  return MIME_TYPE_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function getSourcePriority(source: RemoteFileSource): number {
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

  return files
    .sort((a, b) => {
      const priorityDelta = getSourcePriority(b.source) - getSourcePriority(a.source);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return b.mtime - a.mtime;
    })
    .slice(0, limit);
}

function resolveFileReference(
  workspaceRoot: string,
  candidatePath: string,
  options?: {
    allowExternal?: boolean;
    includeMissing?: boolean;
  }
): ResolvedRemoteFileReference | null {
  if (!candidatePath) {
    return null;
  }

  const trimmed = candidatePath
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^[\\/](?=[A-Za-z]:[\\/])/, '');
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const absolutePath = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(workspaceRoot, trimmed);

    let relativePath: string;
    try {
      relativePath = getSafeRelativePath(workspaceRoot, absolutePath);
    } catch {
      if (!options?.allowExternal) {
        return null;
      }
      relativePath = toPortablePath(absolutePath);
    }

    const available = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    if (!available && !options?.includeMissing) {
      return null;
    }

    return {
      absolutePath,
      relativePath,
      available
    };
  } catch {
    return null;
  }
}

function extractPathCandidatesFromText(text: string): string[] {
  if (!text) {
    return [];
  }

  const candidates = new Set<string>();
  const registerCandidate = (value: string) => {
    const trimmed = value.trim().replace(/[),.;:]+$/g, '');
    if (trimmed) {
      candidates.add(trimmed);
    }
  };

  for (const match of text.matchAll(MARKDOWN_FILE_LINK_PATTERN)) {
    registerCandidate(match[1] || '');
  }

  const matches = text.match(TEXT_FILE_PATH_PATTERN);
  matches?.forEach(registerCandidate);

  return Array.from(candidates);
}

function collectStringValues(value: unknown, sink: string[]): void {
  if (typeof value === 'string') {
    sink.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectStringValues(item, sink));
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStringValues(item, sink));
  }
}

function getCandidatePathsFromProcessEvent(event: MessageProcessEvent): string[] {
  const values: string[] = [];

  if (event.type === 'tool_use' && event.toolInput) {
    collectStringValues(event.toolInput, values);
  }

  if (event.type === 'tool_result' && typeof event.result === 'string') {
    values.push(event.result);
  }

  return values.flatMap(extractPathCandidatesFromText);
}

function buildSessionFileReferences(
  workspaceRoot: string,
  session: Pick<ClaudeSession, 'messages'>
): Map<string, SessionFileReference> {
  const references = new Map<string, SessionFileReference>();

  const registerFile = (
    candidatePath: string,
    timestamp: number,
    preferredSource?: RemoteFileSource
  ) => {
    const resolved = resolveFileReference(workspaceRoot, candidatePath, {
      allowExternal: true,
      includeMissing: true
    });
    if (!resolved) {
      return;
    }

    const mimeType = getMimeTypeForPath(resolved.absolutePath);
    if (!resolved.available && preferredSource !== 'attachment' && !mimeType.startsWith('image/')) {
      return;
    }

    const fileStats = resolved.available ? fs.statSync(resolved.absolutePath) : null;
    const source = preferredSource || inferRemoteFileSource(resolved.relativePath);
    const entry: RemoteFileEntry = {
      name: path.basename(resolved.absolutePath),
      relativePath: resolved.relativePath,
      kind: 'file',
      size: fileStats?.size || 0,
      mtime: timestamp || fileStats?.mtimeMs || Date.now(),
      source,
      mimeType,
      ...(resolved.available ? {} : { available: false })
    };
    const key = normalizeReferencePathKey(entry.relativePath);
    const existing = references.get(key);

    if (!existing) {
      references.set(key, {
        absolutePath: resolved.absolutePath,
        entry
      });
      return;
    }

    const availabilityDelta = Number(entry.available !== false) - Number(existing.entry.available !== false);
    if (availabilityDelta > 0) {
      references.set(key, {
        absolutePath: resolved.absolutePath,
        entry
      });
      return;
    }

    if (availabilityDelta < 0) {
      return;
    }

    const priorityDelta = getSourcePriority(entry.source) - getSourcePriority(existing.entry.source);
    if (priorityDelta > 0 || (priorityDelta === 0 && entry.mtime > existing.entry.mtime)) {
      references.set(key, {
        absolutePath: resolved.absolutePath,
        entry
      });
    }
  };

  for (const message of session.messages as ClaudeMessage[]) {
    const timestamp = message.timestamp || Date.now();

    for (const imagePath of message.images || []) {
      registerFile(imagePath, timestamp, 'attachment');
    }

    for (const candidatePath of extractPathCandidatesFromText(message.content || '')) {
      registerFile(candidatePath, timestamp);
    }

    for (const event of message.process?.events || []) {
      for (const candidatePath of getCandidatePathsFromProcessEvent(event)) {
        registerFile(candidatePath, event.timestamp || timestamp);
      }
    }
  }

  return references;
}

export function listSessionRecentFiles(
  workspaceRoot: string,
  session: Pick<ClaudeSession, 'messages'>,
  limit = SESSION_RECENT_LIMIT
): RemoteFileEntry[] {
  return Array.from(buildSessionFileReferences(workspaceRoot, session).values())
    .map(reference => reference.entry)
    .sort((a, b) => {
      const priorityDelta = getSourcePriority(b.source) - getSourcePriority(a.source);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const imageDelta = Number((b.mimeType || '').startsWith('image/')) - Number((a.mimeType || '').startsWith('image/'));
      if (imageDelta !== 0) {
        return imageDelta;
      }

      const mtimeDelta = b.mtime - a.mtime;
      if (mtimeDelta !== 0) {
        return mtimeDelta;
      }

      return Number(b.available !== false) - Number(a.available !== false);
    })
    .slice(0, limit);
}

export function resolveSessionReferencedFile(
  workspaceRoot: string,
  session: Pick<ClaudeSession, 'messages'>,
  referencePath: string
): { absolutePath: string; entry: RemoteFileEntry } | null {
  if (!referencePath) {
    return null;
  }

  const resolved = buildSessionFileReferences(workspaceRoot, session)
    .get(normalizeReferencePathKey(referencePath));

  return resolved
    ? {
        absolutePath: resolved.absolutePath,
        entry: resolved.entry
      }
    : null;
}

export function createRemoteAttachmentDescriptor(
  workspaceRoot: string,
  filePath: string,
  options?: {
    id?: string;
    originalName?: string;
    mimeType?: string;
    allowExternal?: boolean;
    includeMissing?: boolean;
  }
): RemoteAttachmentDescriptor {
  const resolved = resolveFileReference(workspaceRoot, filePath, {
    allowExternal: options?.allowExternal,
    includeMissing: options?.includeMissing
  });
  if (!resolved) {
    throw new Error('PATH_OUTSIDE_ROOT');
  }

  const fileStats = resolved.available ? fs.statSync(resolved.absolutePath) : null;

  return {
    id: options?.id || resolved.relativePath,
    name: options?.originalName || path.basename(resolved.absolutePath),
    type: options?.mimeType || getMimeTypeForPath(resolved.absolutePath),
    relativePath: resolved.relativePath,
    ...(fileStats ? { size: fileStats.size } : {}),
    ...(resolved.available ? {} : { available: false })
  };
}
