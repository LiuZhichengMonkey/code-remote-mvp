/**
 * Claude Code 日志转换器
 * 将 Claude Code 的日志转换为 Evolver 可识别的格式
 */

import * as fs from 'fs';
import * as path from 'path';

// Claude Code 日志路径
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude');

// Evolver 期望的信号格式
export interface EvolverSignal {
  type: 'error' | 'pattern' | 'inefficiency' | 'success';
  timestamp: string;
  source: string;
  message: string;
  context?: Record<string, any>;
  sessionId?: string;
}

// Evolver 事件格式
export interface EvolverEvent {
  id: string;
  timestamp: string;
  type: string;
  signals: EvolverSignal[];
  metadata?: Record<string, any>;
}

/**
 * 解析 Claude Code 的 history.jsonl
 */
export function parseHistoryLog(): EvolverSignal[] {
  const historyPath = path.join(CLAUDE_DIR, 'history.jsonl');
  const signals: EvolverSignal[] = [];

  if (!fs.existsSync(historyPath)) {
    console.warn(`History file not found: ${historyPath}`);
    return signals;
  }

  const content = fs.readFileSync(historyPath, 'utf-8');
  const lines = content.trim().split('\n');

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      // 提取用户输入模式
      signals.push({
        type: 'pattern',
        timestamp: new Date(entry.timestamp).toISOString(),
        source: 'history.jsonl',
        message: `User input: ${entry.display?.substring(0, 100)}`,
        context: {
          project: entry.project,
          fullInput: entry.display
        },
        sessionId: entry.sessionId
      });
    } catch (e) {
      // 跳过解析失败的行
    }
  }

  return signals;
}

/**
 * 解析 Claude Code 的 debug 日志
 */
export function parseDebugLogs(sessionId?: string): EvolverSignal[] {
  const debugDir = path.join(CLAUDE_DIR, 'debug');
  const signals: EvolverSignal[] = [];

  if (!fs.existsSync(debugDir)) {
    console.warn(`Debug directory not found: ${debugDir}`);
    return signals;
  }

  const files = fs.readdirSync(debugDir).filter(f => f.endsWith('.txt'));

  for (const file of files) {
    // 如果指定了 sessionId，只处理该会话的日志
    if (sessionId && !file.includes(sessionId)) {
      continue;
    }

    const filePath = path.join(debugDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const signal = parseDebugLine(line, file.replace('.txt', ''));
      if (signal) {
        signals.push(signal);
      }
    }
  }

  return signals;
}

/**
 * 解析单行 debug 日志
 */
function parseDebugLine(line: string, sessionId: string): EvolverSignal | null {
  // 匹配日志格式: 2026-03-05T16:56:25.010Z [ERROR] message
  const logMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+\[(\w+)\]\s+(.+)$/);

  if (!logMatch) {
    return null;
  }

  const [, timestamp, level, message] = logMatch;

  // 根据日志级别确定信号类型
  let type: EvolverSignal['type'];
  if (level === 'ERROR') {
    type = 'error';
  } else if (message.includes('inefficient') || message.includes('slow')) {
    type = 'inefficiency';
  } else if (message.includes('success') || message.includes('completed')) {
    type = 'success';
  } else {
    type = 'pattern';
  }

  return {
    type,
    timestamp,
    source: 'debug',
    message,
    sessionId,
    context: {
      level,
      rawLine: line
    }
  };
}

/**
 * 解析 transcripts 转录文件
 */
export function parseTranscripts(): EvolverSignal[] {
  const transcriptsDir = path.join(CLAUDE_DIR, 'transcripts');
  const signals: EvolverSignal[] = [];

  if (!fs.existsSync(transcriptsDir)) {
    console.warn(`Transcripts directory not found: ${transcriptsDir}`);
    return signals;
  }

  const files = fs.readdirSync(transcriptsDir).filter(f => f.endsWith('.jsonl'));

  for (const file of files) {
    const filePath = path.join(transcriptsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // 提取对话模式
        if (entry.role === 'assistant' && entry.content) {
          signals.push({
            type: 'pattern',
            timestamp: new Date().toISOString(),
            source: 'transcripts',
            message: `Assistant response pattern`,
            context: {
              contentPreview: entry.content?.substring?.(0, 200),
              role: entry.role
            }
          });
        }
      } catch (e) {
        // 跳过解析失败的行
      }
    }
  }

  return signals;
}

/**
 * 转换所有日志为 Evolver 格式
 */
export function convertAllLogs(sessionId?: string): EvolverEvent[] {
  const events: EvolverEvent[] = [];

  // 收集所有信号
  const historySignals = parseHistoryLog();
  const debugSignals = parseDebugLogs(sessionId);
  const transcriptSignals = parseTranscripts();

  const allSignals = [...historySignals, ...debugSignals, ...transcriptSignals];

  // 按会话分组
  const sessionGroups = new Map<string, EvolverSignal[]>();

  for (const signal of allSignals) {
    const sid = signal.sessionId || 'unknown';
    if (!sessionGroups.has(sid)) {
      sessionGroups.set(sid, []);
    }
    sessionGroups.get(sid)!.push(signal);
  }

  // 转换为 Evolver 事件
  for (const [sid, sigs] of sessionGroups) {
    events.push({
      id: `event-${sid}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'claude-code-session',
      signals: sigs,
      metadata: {
        sessionId: sid,
        signalCount: sigs.length,
        source: 'claude-code-log-converter'
      }
    });
  }

  return events;
}

/**
 * 生成 Evolver 可识别的日志文件
 */
export function generateEvolverLog(outputPath: string, sessionId?: string): void {
  const events = convertAllLogs(sessionId);

  // Evolver 期望的 JSONL 格式
  const output = events.map(e => JSON.stringify(e)).join('\n');

  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log(`Generated Evolver log: ${outputPath}`);
  console.log(`Total events: ${events.length}`);
  console.log(`Total signals: ${events.reduce((sum, e) => sum + e.signals.length, 0)}`);
}

/**
 * 提取错误信号（供 Evolver 分析）
 */
export function extractErrorSignals(): EvolverSignal[] {
  const debugSignals = parseDebugLogs();
  return debugSignals.filter(s => s.type === 'error');
}

/**
 * CLI 入口
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const sessionId = args.find(a => a.startsWith('--session='))?.split('=')[1];
  const output = args.find(a => a.startsWith('--output='))?.split('=')[1] || './evolver-log.jsonl';

  console.log('Converting Claude Code logs to Evolver format...');
  console.log(`Claude directory: ${CLAUDE_DIR}`);
  console.log(`Session filter: ${sessionId || 'all'}`);

  generateEvolverLog(output, sessionId);

  // 打印错误摘要
  const errors = extractErrorSignals();
  if (errors.length > 0) {
    console.log('\n=== Error Summary ===');
    errors.slice(0, 10).forEach(e => {
      console.log(`[${e.timestamp}] ${e.message.substring(0, 100)}`);
    });
    if (errors.length > 10) {
      console.log(`... and ${errors.length - 10} more errors`);
    }
  }
}

export default {
  parseHistoryLog,
  parseDebugLogs,
  parseTranscripts,
  convertAllLogs,
  generateEvolverLog,
  extractErrorSignals
};
