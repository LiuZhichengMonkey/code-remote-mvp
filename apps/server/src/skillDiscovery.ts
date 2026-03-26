import fs from 'fs';
import os from 'os';
import path from 'path';
import { Provider } from './session/provider';

export type SkillSource = 'project' | 'user' | 'system';

export interface SkillSummary {
  command: string;
  name: string;
  description?: string;
  source: SkillSource;
}

interface SkillSearchRoot {
  rootPath: string;
  source: Exclude<SkillSource, 'system'>;
}

interface ParsedSkillMetadata {
  name?: string;
  description?: string;
}

const SKILL_FILE_NAME = 'SKILL.md';
const MAX_SCAN_DEPTH = 3;

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function parseSkillMetadata(markdown: string): ParsedSkillMetadata {
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch) {
    return {};
  }

  const metadata: ParsedSkillMetadata = {};

  for (const rawLine of frontmatterMatch[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripMatchingQuotes(line.slice(separatorIndex + 1));

    if (!value) {
      continue;
    }

    if (key === 'name' && !metadata.name) {
      metadata.name = value;
    }

    if (key === 'description' && !metadata.description) {
      metadata.description = value;
    }
  }

  return metadata;
}

function getSkillSearchRoots(
  workspaceRoot: string,
  provider: Provider,
  homeDir: string
): SkillSearchRoot[] {
  const genericRoots: SkillSearchRoot[] = [
    {
      rootPath: path.join(workspaceRoot, '.agents', 'skills'),
      source: 'project'
    },
    {
      rootPath: path.join(homeDir, '.agents', 'skills'),
      source: 'user'
    }
  ];

  if (provider === 'codex') {
    return [
      {
        rootPath: path.join(workspaceRoot, '.codex', 'skills'),
        source: 'project'
      },
      {
        rootPath: path.join(homeDir, '.codex', 'skills'),
        source: 'user'
      },
      ...genericRoots
    ];
  }

  return [
    {
      rootPath: path.join(workspaceRoot, '.claude', 'skills'),
      source: 'project'
    },
    {
      rootPath: path.join(homeDir, '.claude', 'skills'),
      source: 'user'
    },
    ...genericRoots
  ];
}

function scanSkillDirectory(
  directoryPath: string,
  source: Exclude<SkillSource, 'system'>,
  sink: Map<string, SkillSummary>,
  depth = 0
): void {
  if (depth > MAX_SCAN_DEPTH || !fs.existsSync(directoryPath)) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    const allowHiddenTraversal = entry.name === '.system';
    if (entry.name.startsWith('.') && !allowHiddenTraversal) {
      continue;
    }

    const skillDirectory = path.join(directoryPath, entry.name);
    const skillFilePath = path.join(skillDirectory, SKILL_FILE_NAME);
    let hasSkillFile = false;
    try {
      hasSkillFile = fs.existsSync(skillFilePath) && fs.statSync(skillFilePath).isFile();
    } catch {
      hasSkillFile = false;
    }

    if (hasSkillFile) {
      const command = path.basename(skillDirectory);
      const normalizedCommand = command.toLowerCase();

      if (!sink.has(normalizedCommand)) {
        let markdown = '';
        try {
          markdown = fs.readFileSync(skillFilePath, 'utf-8');
        } catch {
          markdown = '';
        }

        const metadata = parseSkillMetadata(markdown);
        sink.set(normalizedCommand, {
          command,
          name: metadata.name || command,
          ...(metadata.description ? { description: metadata.description } : {}),
          source: skillDirectory.includes(`${path.sep}.system${path.sep}`) ? 'system' : source
        });
      }

      continue;
    }

    scanSkillDirectory(skillDirectory, source, sink, depth + 1);
  }
}

export function listAvailableSkills(
  workspaceRoot: string,
  provider: Provider,
  options?: {
    homeDir?: string;
  }
): SkillSummary[] {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot || process.cwd());
  const homeDir = options?.homeDir || os.homedir();
  const skills = new Map<string, SkillSummary>();

  for (const root of getSkillSearchRoots(resolvedWorkspaceRoot, provider, homeDir)) {
    scanSkillDirectory(root.rootPath, root.source, skills);
  }

  return Array.from(skills.values()).sort((left, right) => (
    left.command.localeCompare(right.command, undefined, { sensitivity: 'base' })
  ));
}
