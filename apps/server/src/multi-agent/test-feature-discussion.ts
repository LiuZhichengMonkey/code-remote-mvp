import fs from 'fs';
import path from 'path';
import {
  ClaudeCLIAdapter,
  DebateOrchestrator
} from './index';
import { DEFAULT_MULTI_AGENT_REPORTS_DIR, DEFAULT_MULTI_AGENT_SESSIONS_DIR } from './runtimePaths';

const sessionsDir = DEFAULT_MULTI_AGENT_SESSIONS_DIR;
const reportsDir = DEFAULT_MULTI_AGENT_REPORTS_DIR;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function runFeatureDiscussion(): Promise<void> {
  ensureDir(sessionsDir);
  ensureDir(reportsDir);

  const topic = [
    '功能需求：为 CodeRemote 增加多智能体讨论能力。',
    '请围绕以下方面给出分析：',
    '1. 技术可行性和实现路径',
    '2. 用户交互设计',
    '3. 运行期状态和历史记录如何持久化',
    '4. 最小可交付版本应该包含哪些内容'
  ].join('\n');

  const adapter = new ClaudeCLIAdapter({
    maxTokens: 2048,
    sessionsDir
  });

  const debate = DebateOrchestrator.create(
    topic,
    {
      name: '产品经理',
      background: '关注用户价值、信息密度、渐进式交付和交互复杂度控制。'
    },
    {
      maxRounds: 4,
      terminationScore: 85,
      compressHistory: true,
      compressionInterval: 2,
      enableFactChecker: false
    }
  );

  debate.setLLMAdapter(adapter);

  while (debate.getState().status === 'running') {
    await debate.runRound();
  }

  const reportFile = path.join(reportsDir, `feature-discussion-${Date.now()}.md`);
  fs.writeFileSync(reportFile, debate.exportMarkdownReport(), 'utf-8');

  console.log(`Final status: ${debate.getState().status}`);
  console.log(`Rounds: ${debate.getBlackboard().round}`);
  console.log(`Report: ${reportFile}`);
}

runFeatureDiscussion().catch((error) => {
  console.error(error);
  process.exit(1);
});
