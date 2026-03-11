/**
 * Agent 配置解析器
 * 支持 YAML 格式配置文件
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentConfig, AgentContext, AGENT_DIR_NAME, USER_AGENT_DIR_NAME, CONFIG_FILE, MEMORY_FILE, SKILLS_DIR } from './types';

// 简单的 YAML 解析器（不支持复杂特性）
function parseSimpleYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentKey = '';
  let currentValue: any = '';
  let inMultiline = false;
  let multilineKey = '';

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 检测多行字符串开始 (key: | 或 key: >)
    const multilineMatch = trimmed.match(/^(\w+):\s*[|>]\s*$/);
    if (multilineMatch) {
      multilineKey = multilineMatch[1];
      inMultiline = true;
      currentValue = '';
      continue;
    }

    // 处理多行内容
    if (inMultiline) {
      if (line.startsWith('  ') || line.startsWith('\t') || trimmed === '') {
        currentValue += (currentValue ? '\n' : '') + trimmed;
        continue;
      } else {
        // 多行结束
        result[multilineKey] = currentValue;
        inMultiline = false;
        multilineKey = '';
      }
    }

    // 解析 key: value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.substring(0, colonIndex).trim();
      let value: any = trimmed.substring(colonIndex + 1).trim();

      // 处理数组 [a, b, c]
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      // 处理布尔值
      else if (value === 'true') value = true;
      else if (value === 'false') value = false;
      // 处理数字
      else if (/^\d+$/.test(value)) value = parseInt(value);
      else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
      // 处理引号字符串
      else if ((value.startsWith('"') && value.endsWith('"')) ||
               (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
      currentKey = key;
      currentValue = value;
    }
    // 处理数组项 (- value)
    else if (trimmed.startsWith('- ')) {
      const arrayValue = trimmed.substring(2).trim();
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      result[currentKey].push(arrayValue);
    }
  }

  // 处理最后的多行
  if (inMultiline && multilineKey) {
    result[multilineKey] = currentValue;
  }

  return result;
}

/**
 * 解析 YAML 配置文件
 */
export function parseAgentConfig(yamlContent: string): AgentConfig {
  const parsed = parseSimpleYaml(yamlContent);

  return {
    name: parsed.name || '',
    description: parsed.description || '',
    systemPrompt: parsed.systemPrompt || '',
    tools: parsed.tools || undefined,
    mcpServers: parsed.mcpServers || undefined,
    model: parsed.model || undefined,
    temperature: parsed.temperature || undefined,
    role: parsed.role || 'both',
    expertise: parsed.expertise || undefined,
  };
}

/**
 * 获取项目级 agent 目录
 */
export function getProjectAgentDir(projectRoot: string): string {
  return path.join(projectRoot, AGENT_DIR_NAME);
}

/**
 * 获取用户级 agent 目录
 */
export function getUserAgentDir(): string {
  return path.join(os.homedir(), USER_AGENT_DIR_NAME);
}

/**
 * 加载 agent 上下文
 */
export function loadAgentContext(
  agentName: string,
  projectRoot?: string
): AgentContext | null {
  const searchPaths: Array<{ path: string; source: 'project' | 'user' }> = [];

  // 项目级 agent 优先
  if (projectRoot) {
    searchPaths.push({
      path: path.join(getProjectAgentDir(projectRoot), agentName),
      source: 'project'
    });
  }

  // 用户级 agent
  searchPaths.push({
    path: path.join(getUserAgentDir(), agentName),
    source: 'user'
  });

  // 按优先级搜索
  for (const { path: agentPath, source } of searchPaths) {
    if (fs.existsSync(agentPath)) {
      const configPath = path.join(agentPath, CONFIG_FILE);

      if (fs.existsSync(configPath)) {
        try {
          const yamlContent = fs.readFileSync(configPath, 'utf-8');
          const config = parseAgentConfig(yamlContent);

          // 确保 name 正确
          config.name = agentName;

          // 加载记忆
          let memory: string | undefined;
          const memoryPath = path.join(agentPath, MEMORY_FILE);
          if (fs.existsSync(memoryPath)) {
            memory = fs.readFileSync(memoryPath, 'utf-8');
          }

          // 加载技能
          let skills: string[] | undefined;
          const skillsPath = path.join(agentPath, SKILLS_DIR);
          if (fs.existsSync(skillsPath)) {
            skills = fs.readdirSync(skillsPath)
              .filter(f => f.endsWith('.md'))
              .map(f => {
                const skillPath = path.join(skillsPath, f);
                return fs.readFileSync(skillPath, 'utf-8');
              });
          }

          return {
            config,
            memory,
            skills,
            basePath: agentPath,
            source
          };
        } catch (error) {
          console.error(`[Agent] Failed to load agent ${agentName} from ${agentPath}:`, error);
        }
      }
    }
  }

  return null;
}

/**
 * 列出所有可用 agent
 */
export function listAvailableAgents(projectRoot?: string): string[] {
  const agents = new Set<string>();

  // 扫描项目级 agent
  if (projectRoot) {
    const projectDir = getProjectAgentDir(projectRoot);
    if (fs.existsSync(projectDir)) {
      const dirs = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory()) {
          agents.add(dir.name);
        }
      }
    }
  }

  // 扫描用户级 agent
  const userDir = getUserAgentDir();
  if (fs.existsSync(userDir)) {
    const dirs = fs.readdirSync(userDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        agents.add(dir.name);
      }
    }
  }

  return Array.from(agents).sort();
}
