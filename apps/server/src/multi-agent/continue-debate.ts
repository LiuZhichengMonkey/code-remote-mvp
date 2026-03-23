import fs from 'fs';
import path from 'path';
import {
  ClaudeCLIAdapter,
  DebateOrchestrator
} from './index';
import { DEFAULT_MULTI_AGENT_REPORTS_DIR, DEFAULT_MULTI_AGENT_SESSIONS_DIR } from './runtimePaths';

interface SavedDebateState {
  debateSessionId: string;
  round: number;
  debateState: string;
  savedAt: string;
}

const sessionsDir = DEFAULT_MULTI_AGENT_SESSIONS_DIR;
const reportsDir = DEFAULT_MULTI_AGENT_REPORTS_DIR;
const maxRounds = 10;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function findLatestStateFile(): string | null {
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const stateFiles = fs.readdirSync(sessionsDir)
    .filter((file) => file.endsWith('_state.json'))
    .sort()
    .reverse();

  return stateFiles.length > 0 ? path.join(sessionsDir, stateFiles[0]) : null;
}

function saveDebateState(debateSessionId: string, debate: DebateOrchestrator): string {
  const stateFile = path.join(sessionsDir, `${debateSessionId}_state.json`);
  const payload: SavedDebateState = {
    debateSessionId,
    round: debate.getBlackboard().round,
    debateState: debate.exportState(),
    savedAt: new Date().toISOString()
  };

  fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2), 'utf-8');
  return stateFile;
}

function writeReport(debateSessionId: string, debate: DebateOrchestrator): string {
  ensureDir(reportsDir);
  const reportFile = path.join(reportsDir, `${debateSessionId}.md`);
  fs.writeFileSync(reportFile, debate.exportMarkdownReport(), 'utf-8');
  return reportFile;
}

async function main(): Promise<void> {
  ensureDir(sessionsDir);

  const stateFile = findLatestStateFile();
  if (!stateFile) {
    console.log(`No saved debate state found in ${sessionsDir}`);
    return;
  }

  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SavedDebateState;
  const debate = DebateOrchestrator.restore(saved.debateState);
  const adapter = new ClaudeCLIAdapter({
    maxTokens: 2048,
    sessionsDir,
    debateSessionId: saved.debateSessionId
  });

  debate.setLLMAdapter(adapter);
  if (debate.getState().status === 'paused') {
    debate.resume();
  }

  console.log(`Restored debate ${saved.debateSessionId}`);
  console.log(`Current round: ${debate.getBlackboard().round}`);
  console.log(`State file: ${stateFile}`);

  while (debate.getState().status === 'running' && debate.getBlackboard().round < maxRounds) {
    await debate.runRound();
    const latestStateFile = saveDebateState(saved.debateSessionId, debate);
    console.log(`Saved state: ${latestStateFile}`);
  }

  const reportFile = writeReport(saved.debateSessionId, debate);
  const usage = debate.getTokenUsage();

  console.log(`Final status: ${debate.getState().status}`);
  console.log(`Rounds: ${debate.getBlackboard().round}`);
  console.log(`Tokens: in=${usage.inputTokens}, out=${usage.outputTokens}, total=${usage.totalTokens}`);
  console.log(`Report: ${reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
