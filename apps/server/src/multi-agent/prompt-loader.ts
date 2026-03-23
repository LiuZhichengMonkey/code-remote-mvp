/**
 * 提示词加载器
 *
 * 从 prompts 目录加载 Markdown 格式的提示词文件
 */

import * as fs from 'fs';
import * as path from 'path';

const PROMPTS_DIR = path.join(__dirname, 'prompts');

/**
 * 提示词模板缓存
 */
const promptCache: Map<string, string> = new Map();

/**
 * 加载提示词模板
 */
export function loadPrompt(name: string): string {
  // 检查缓存
  if (promptCache.has(name)) {
    return promptCache.get(name)!;
  }

  const filePath = path.join(PROMPTS_DIR, `${name}.md`);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    promptCache.set(name, content);
    return content;
  } catch (error) {
    throw new Error(`Failed to load prompt: ${name} (${filePath})`);
  }
}

/**
 * 清除缓存（用于开发时热更新）
 */
export function clearCache(): void {
  promptCache.clear();
}

/**
 * 获取所有可用提示词名称
 */
export function listPrompts(): string[] {
  try {
    const files = fs.readdirSync(PROMPTS_DIR);
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
  } catch {
    return [];
  }
}
