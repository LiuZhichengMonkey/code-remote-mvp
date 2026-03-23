/**
 * Agent 配置解析器
 * 直接读取 Claude Code 原生格式 (.claude/agents/*.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentConfig, AgentContext } from './types';

// Claude Code 原生 agent 目录
const CLAUDE_AGENTS_DIR = '.claude/agents';
const USER_CLAUDE_AGENTS_DIR = '.claude/agents';

// 调试模式控制
const DEBUG = process.env.AGENT_DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * 调试日志（仅开发环境输出）
 */
function debugLog(message: string, ...args: unknown[]): void {
  if (DEBUG) {
    // 生产环境隐藏完整路径
    const sanitizedArgs = args.map(arg => {
      if (typeof arg === 'string') {
        return arg.replace(/[A-Z]:\\[^\s]*/gi, '[PATH]');
      }
      return arg;
    });
    console.log(message, ...sanitizedArgs);
  }
}

/**
 * 验证 agent 名称（防止路径遍历攻击）
 * 只允许字母、数字、下划线和连字符
 */
function validateAgentName(agentName: string): string | null {
  if (!agentName || typeof agentName !== 'string') {
    return null;
  }

  // 只允许安全字符
  if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
    debugLog(`[Agent] Invalid agent name (invalid characters): ${agentName}`);
    return null;
  }

  // 防止隐藏文件攻击
  if (agentName.startsWith('.') || agentName.startsWith('-')) {
    debugLog(`[Agent] Invalid agent name (starts with . or -): ${agentName}`);
    return null;
  }

  // 限制长度
  if (agentName.length > 64) {
    debugLog(`[Agent] Invalid agent name (too long): ${agentName}`);
    return null;
  }

  return agentName.toLowerCase();
}

/**
 * 安全截断字符串，确保不破坏多字节字符
 */
function safeTruncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  // 使用 Array.from 正确处理 Unicode 字符
  const chars = Array.from(str);
  if (chars.length <= maxLength) {
    return str;
  }
  return chars.slice(0, maxLength).join('');
}

/**
 * 解析 Markdown 前言 (YAML frontmatter)
 * 支持多行值和引号包裹的值
 */
function parseMarkdownFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = frontmatterMatch[1];
  const body = frontmatterMatch[2];
  const frontmatter: Record<string, string> = {};

  // 解析 YAML（支持多行值）
  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;

  for (const line of yamlContent.split('\n')) {
    // 检查是否是新键值对
    const colonIndex = line.indexOf(':');
    if (!inMultiline && colonIndex > 0) {
      // 保存之前的键值对
      if (currentKey) {
        frontmatter[currentKey] = currentValue.trim();
      }
      currentKey = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // 处理引号包裹的值
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // 检查是否开始多行值（以 | 或 > 开头）
      if (value === '|' || value === '>') {
        inMultiline = true;
        currentValue = '';
      } else {
        currentValue = value;
      }
    } else if (inMultiline) {
      // 多行内容
      if (line.startsWith('  ') || line.startsWith('\t')) {
        currentValue += (currentValue ? '\n' : '') + line.trim();
      } else {
        // 多行结束
        inMultiline = false;
        frontmatter[currentKey] = currentValue.trim();
        currentKey = '';
        currentValue = '';
        // 处理当前行（可能是新键值对）
        const newColonIndex = line.indexOf(':');
        if (newColonIndex > 0) {
          currentKey = line.substring(0, newColonIndex).trim();
          currentValue = line.substring(newColonIndex + 1).trim();
        }
      }
    }
  }

  // 保存最后一个键值对
  if (currentKey) {
    frontmatter[currentKey] = currentValue.trim();
  }

  return { frontmatter, body };
}

/**
 * 解析 tools 字段（逗号分隔的字符串）
 */
function parseTools(toolsStr: string | undefined): string[] | undefined {
  if (!toolsStr) return undefined;
  return toolsStr.split(',').map(t => t.trim()).filter(Boolean);
}

/**
 * 获取项目级 Claude agents 目录
 */
export function getClaudeAgentsDir(projectRoot: string): string {
  return path.join(projectRoot, CLAUDE_AGENTS_DIR);
}

/**
 * 获取用户级 Claude agents 目录
 */
export function getUserClaudeAgentsDir(): string {
  return path.join(os.homedir(), USER_CLAUDE_AGENTS_DIR);
}

/**
 * 安全地扫描目录中的 agent 文件
 */
function scanAgentDirectory(dir: string, agents: Set<string>): void {
  try {
    if (!fs.existsSync(dir)) {
      return;
    }

    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      // 只处理普通文件且以 .md 结尾
      if (file.isFile() && file.name.endsWith('.md')) {
        // 提取名称并验证
        const name = file.name.replace('.md', '');
        if (/^[a-zA-Z0-9_-]+$/.test(name) && !name.startsWith('.')) {
          agents.add(name);
        }
      }
    }
  } catch (error) {
    // 权限错误等，记录警告但不中断程序
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[Agent] Failed to read directory ${dir}:`, error);
    }
  }
}

/**
 * 从 .md 文件加载 agent 配置（使用文件描述符避免 TOCTOU）
 */
function loadAgentFromMarkdown(filePath: string, source: 'project' | 'user' | 'parent'): AgentContext | null {
  let fd: number | null = null;
  try {
    // 使用文件描述符确保原子操作
    fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);

    // 验证是普通文件
    if (!stats.isFile()) {
      console.error(`[Agent] Path is not a regular file: ${filePath}`);
      return null;
    }

    const content = fs.readFileSync(fd, 'utf-8');
    const { frontmatter, body } = parseMarkdownFrontmatter(content);

    const name = frontmatter.name || path.basename(filePath, '.md');
    // 验证名称安全性
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.error(`[Agent] Invalid agent name in file: ${name}`);
      return null;
    }

    const description = frontmatter.description || '';
    const tools = parseTools(frontmatter.tools);
    const systemPrompt = body.trim();

    const config: AgentConfig = {
      name,
      description,
      systemPrompt,
      tools,
      // 对于 Claude Code 原生格式，默认使用 prompt 模式
      // 主 Agent 会自动委托
      subagent: { type: 'prompt' }
    };

    return {
      config,
      basePath: path.dirname(filePath),
      source
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // 文件不存在是正常情况，不报错
      return null;
    }
    console.error(`[Agent] Failed to load agent:`, error);
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // 忽略关闭错误
      }
    }
  }
}

/**
 * 加载 agent 上下文
 */
export function loadAgentContext(
  agentName: string,
  projectRoot?: string
): AgentContext | null {
  // 验证 agent 名称（防止路径遍历攻击）
  const validatedName = validateAgentName(agentName);
  if (!validatedName) {
    console.warn(`[Agent] Invalid agent name rejected: ${agentName}`);
    return null;
  }

  debugLog(`[loadAgentContext] Loading agent: ${validatedName}`);
  const searchPaths: Array<{ path: string; source: 'project' | 'user' | 'parent' }> = [];

  // 项目级 agent 优先
  if (projectRoot) {
    const projectAgentDir = getClaudeAgentsDir(projectRoot);
    debugLog(`[loadAgentContext] Project agent dir:`, projectAgentDir);
    searchPaths.push({
      path: path.join(projectAgentDir, `${validatedName}.md`),
      source: 'project'
    });

    // 也搜索父目录（适用于 monorepo 或 cli 子目录情况）
    const parentDir = path.dirname(projectRoot);
    if (parentDir && parentDir !== projectRoot) {
      const parentAgentDir = path.join(parentDir, CLAUDE_AGENTS_DIR);
      debugLog(`[loadAgentContext] Parent agent dir:`, parentAgentDir);
      searchPaths.push({
        path: path.join(parentAgentDir, `${validatedName}.md`),
        source: 'parent'
      });
    }
  }

  // 用户级 agent
  const userAgentDir = getUserClaudeAgentsDir();
  debugLog(`[loadAgentContext] User agent dir:`, userAgentDir);
  searchPaths.push({
    path: path.join(userAgentDir, `${validatedName}.md`),
    source: 'user'
  });

  // 按优先级搜索
  for (const { path: agentPath, source } of searchPaths) {
    debugLog(`[loadAgentContext] Checking ${source}:`, agentPath);
    const context = loadAgentFromMarkdown(agentPath, source);
    if (context) {
      debugLog(`[loadAgentContext] Agent loaded: success`);
      return context;
    }
  }

  return null;
}

/**
 * 列出所有可用 agent
 */
export function listAvailableAgents(projectRoot?: string): string[] {
  const agents = new Set<string>();

  if (projectRoot) {
    scanAgentDirectory(getClaudeAgentsDir(projectRoot), agents);

    const parentDir = path.dirname(projectRoot);
    if (parentDir && parentDir !== projectRoot) {
      scanAgentDirectory(path.join(parentDir, CLAUDE_AGENTS_DIR), agents);
    }
  }

  scanAgentDirectory(getUserClaudeAgentsDir(), agents);

  return Array.from(agents).sort();
}

// 导出兼容的常量（从 types.ts 重新导出）
export { AGENT_DIR_NAME, USER_AGENT_DIR_NAME, CONFIG_FILE, MEMORY_FILE, SKILLS_DIR } from './types';

export function getProjectAgentDir(projectRoot: string): string {
  return getClaudeAgentsDir(projectRoot);
}

export function getUserAgentDir(): string {
  return getUserClaudeAgentsDir();
}

/**
 * @deprecated 此函数已废弃，请使用 loadAgentContext
 * @throws Error 总是抛出错误，表明函数已废弃
 */
export function parseAgentConfig(_yamlContent: string): AgentConfig {
  throw new Error('parseAgentConfig is deprecated. Use loadAgentContext instead.');
}

/**
 * @deprecated 此函数已废弃，请使用 loadAgentContext
 * @throws Error 总是抛出错误，表明函数已废弃
 */
export async function loadAgentConfig(_agentName: string, _agentsDir?: string): Promise<AgentConfig | null> {
  throw new Error('loadAgentConfig is deprecated. Use loadAgentContext instead.');
}

/**
 * @deprecated 此函数已废弃，不再支持独立的 memory 文件
 * @throws Error 总是抛出错误，表明函数已废弃
 */
export async function loadAgentMemory(_agentName: string, _agentsDir?: string): Promise<string | undefined> {
  throw new Error('loadAgentMemory is deprecated. Memory is now embedded in agent config.');
}
