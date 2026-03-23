/**
 * Claude Code Evolver 适配器
 * 让 Claude Code 的日志可以被 Evolver 分析
 */

import * as fs from 'fs';
import * as path from 'path';
import { convertAllLogs, extractErrorSignals, EvolverSignal } from './logConverter';

// Evolver GEP 协议资产目录
const EVOLVER_ASSETS_DIR = process.env.EVOLVER_ASSETS_DIR || './assets/gep';

interface Gene {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  actions: string[];
  validation?: string[];
}

interface Capsule {
  id: string;
  name: string;
  genes: string[];
  context: Record<string, any>;
}

/**
 * 为 Claude Code 生成专用的 Genes
 */
export function generateClaudeCodeGenes(): Gene[] {
  return [
    {
      id: 'gene-claude-code-error-fix',
      name: 'Claude Code Error Fix',
      description: '自动修复 Claude Code 运行时错误',
      triggers: [
        'signal.type == "error"',
        'signal.source == "debug"',
        'signal.message contains "Tool" && signal.message contains "not found"'
      ],
      actions: [
        '检查 MCP 服务器配置',
        '验证工具是否正确注册',
        '更新或重新安装相关插件'
      ],
      validation: [
        'node -e "console.log(process.version)"'
      ]
    },
    {
      id: 'gene-claude-code-permission',
      name: 'Claude Code Permission Handler',
      description: '处理权限拒绝相关的模式',
      triggers: [
        'signal.type == "pattern"',
        'signal.message contains "permission denied"'
      ],
      actions: [
        '分析权限配置',
        '生成权限调整建议',
        '记录权限决策模式'
      ]
    },
    {
      id: 'gene-claude-code-inefficiency',
      name: 'Claude Code Performance Optimizer',
      description: '优化 Claude Code 的性能问题',
      triggers: [
        'signal.type == "inefficiency"',
        'signal.context.duration > 5000'
      ],
      actions: [
        '分析耗时操作',
        '识别可并行化的任务',
        '生成优化建议'
      ]
    },
    {
      id: 'gene-claude-code-pattern-learn',
      name: 'Claude Code Pattern Learner',
      description: '从用户输入历史中学习模式',
      triggers: [
        'signal.type == "pattern"',
        'signal.source == "history.jsonl"'
      ],
      actions: [
        '提取常用命令模式',
        '识别用户偏好',
        '优化提示词建议'
      ]
    }
  ];
}

/**
 * 为 Claude Code 生成 Capsules
 */
export function generateClaudeCodeCapsules(): Capsule[] {
  return [
    {
      id: 'capsule-claude-code-self-repair',
      name: 'Claude Code Self Repair',
      genes: ['gene-claude-code-error-fix', 'gene-claude-code-permission'],
      context: {
        priority: 'high',
        autoApply: true,
        requiresConfirmation: false
      }
    },
    {
      id: 'capsule-claude-code-optimization',
      name: 'Claude Code Optimization',
      genes: ['gene-claude-code-inefficiency', 'gene-claude-code-pattern-learn'],
      context: {
        priority: 'medium',
        autoApply: false,
        requiresConfirmation: true
      }
    }
  ];
}

/**
 * 初始化 Evolver 资产目录
 */
export function initEvolverAssets(targetDir?: string): void {
  const assetsDir = targetDir || EVOLVER_ASSETS_DIR;

  // 创建目录结构
  fs.mkdirSync(path.join(assetsDir), { recursive: true });

  // 生成 genes.json
  const genes = generateClaudeCodeGenes();
  fs.writeFileSync(
    path.join(assetsDir, 'genes.json'),
    JSON.stringify(genes, null, 2),
    'utf-8'
  );
  console.log(`Generated genes.json with ${genes.length} genes`);

  // 生成 capsules.json
  const capsules = generateClaudeCodeCapsules();
  fs.writeFileSync(
    path.join(assetsDir, 'capsules.json'),
    JSON.stringify(capsules, null, 2),
    'utf-8'
  );
  console.log(`Generated capsules.json with ${capsules.length} capsules`);

  // 创建空的 events.jsonl
  const eventsPath = path.join(assetsDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '', 'utf-8');
    console.log('Created empty events.jsonl');
  }
}

/**
 * 生成 Evolver 可读取的进化提示
 */
export function generateEvolverPrompt(sessionId?: string): string {
  const signals = convertAllLogs(sessionId);
  const errors = extractErrorSignals();

  const prompt = `# Claude Code Evolution Analysis

## Summary
- Total sessions analyzed: ${signals.length}
- Error signals detected: ${errors.length}

## Recent Errors
${errors.slice(0, 5).map(e => `- [${e.timestamp}] ${e.message}`).join('\n') || 'No errors detected'}

## Evolution Suggestions
Based on the analyzed signals, consider the following improvements:

${generateEvolutionSuggestions(errors)}

## GEP Protocol Directive
\`\`\`json
{
  "action": "evolve",
  "target": "claude-code-config",
  "signals": ${JSON.stringify(errors.slice(0, 3).map(e => ({
    type: e.type,
    message: e.message.substring(0, 100),
    sessionId: e.sessionId
  })))},
  "strategy": "repair-only"
}
\`\`\`
`;

  return prompt;
}

/**
 * 生成进化建议
 */
function generateEvolutionSuggestions(errors: EvolverSignal[]): string {
  const suggestions: string[] = [];

  // 分析错误类型
  const toolErrors = errors.filter(e => e.message.includes('Tool') && e.message.includes('not found'));
  if (toolErrors.length > 0) {
    suggestions.push('1. **Tool Registration**: Review MCP server configuration for missing tools');
  }

  const permissionErrors = errors.filter(e => e.message.includes('permission'));
  if (permissionErrors.length > 0) {
    suggestions.push('2. **Permission Model**: Consider adjusting permission settings for smoother workflow');
  }

  const timeoutErrors = errors.filter(e => e.message.includes('timeout') || e.message.includes('ETIMEDOUT'));
  if (timeoutErrors.length > 0) {
    suggestions.push('3. **Timeout Handling**: Increase timeout values or implement retry logic');
  }

  if (suggestions.length === 0) {
    suggestions.push('No critical issues detected. Continue monitoring for patterns.');
  }

  return suggestions.join('\n');
}

/**
 * 运行完整的 Evolver 分析流程
 */
export function runEvolverAnalysis(options: {
  sessionId?: string;
  outputDir?: string;
  generatePrompt?: boolean;
} = {}): void {
  const { sessionId, outputDir = './evolver-output', generatePrompt = true } = options;

  console.log('=== Claude Code Evolver Analysis ===\n');

  // 创建输出目录
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. 初始化资产
  console.log('1. Initializing Evolver assets...');
  initEvolverAssets(path.join(outputDir, 'assets/gep'));

  // 2. 转换日志
  console.log('\n2. Converting logs...');
  const events = convertAllLogs(sessionId);
  const eventsPath = path.join(outputDir, 'evolver-log.jsonl');
  fs.writeFileSync(eventsPath, events.map(e => JSON.stringify(e)).join('\n'), 'utf-8');
  console.log(`   Generated ${events.length} events`);

  // 3. 生成进化提示
  if (generatePrompt) {
    console.log('\n3. Generating evolution prompt...');
    const prompt = generateEvolverPrompt(sessionId);
    const promptPath = path.join(outputDir, 'evolution-prompt.md');
    fs.writeFileSync(promptPath, prompt, 'utf-8');
    console.log(`   Generated prompt: ${promptPath}`);
    console.log('\n--- Preview ---\n');
    console.log(prompt);
  }

  // 4. 错误摘要
  const errors = extractErrorSignals();
  console.log('\n=== Error Summary ===');
  console.log(`Total errors found: ${errors.length}`);
  if (errors.length > 0) {
    console.log('\nTop errors:');
    errors.slice(0, 5).forEach((e, i) => {
      console.log(`  ${i + 1}. [${e.sessionId?.substring(0, 8)}] ${e.message.substring(0, 80)}...`);
    });
  }

  console.log('\n=== Analysis Complete ===');
  console.log(`Output directory: ${outputDir}`);
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  const sessionId = args.find(a => a.startsWith('--session='))?.split('=')[1];
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] || './evolver-output';
  const noPrompt = args.includes('--no-prompt');

  runEvolverAnalysis({
    sessionId,
    outputDir,
    generatePrompt: !noPrompt
  });
}

export default {
  generateClaudeCodeGenes,
  generateClaudeCodeCapsules,
  initEvolverAssets,
  generateEvolverPrompt,
  runEvolverAnalysis
};
