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

function saveDebateState(debateSessionId: string, debate: DebateOrchestrator): string {
  const stateFile = path.join(sessionsDir, `${debateSessionId}_state.json`);
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        debateSessionId,
        round: debate.getBlackboard().round,
        debateState: debate.exportState(),
        savedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  );
  return stateFile;
}

async function runClaudeCliSmoke(): Promise<void> {
  ensureDir(sessionsDir);
  ensureDir(reportsDir);

  const adapter = new ClaudeCLIAdapter({
    maxTokens: 2048,
    sessionsDir
  });

  const debate = DebateOrchestrator.create(
    '如何设计一个多 Agent 协作的工程化系统？请给出可落地的实现建议。',
    {
      name: '系统架构师',
      background: '关注工程边界、扩展性、状态恢复和运行稳定性。'
    },
    {
      maxRounds: 5,
      terminationScore: 85,
      compressHistory: true,
      compressionInterval: 2
    }
  );

  debate.setLLMAdapter(adapter);

  console.log(`Sessions dir: ${sessionsDir}`);
  console.log(`Debate id: ${adapter.getDebateSessionId()}`);

  while (debate.getState().status === 'running') {
    await debate.runRound();
    const stateFile = saveDebateState(adapter.getDebateSessionId(), debate);
    console.log(`Saved state: ${stateFile}`);
  }

  const reportFile = path.join(reportsDir, `${adapter.getDebateSessionId()}.md`);
  fs.writeFileSync(reportFile, debate.exportMarkdownReport(), 'utf-8');

  const usage = debate.getTokenUsage();
  console.log(`Final status: ${debate.getState().status}`);
  console.log(`Rounds: ${debate.getBlackboard().round}`);
  console.log(`Tokens: in=${usage.inputTokens}, out=${usage.outputTokens}, total=${usage.totalTokens}`);
  console.log(`Report: ${reportFile}`);
}

runClaudeCliSmoke().catch((error) => {
  console.error(error);
  process.exit(1);
});
