import path from 'path';

function resolveRuntimePath(...segments: string[]): string {
  return path.resolve(__dirname, '../../../../runtime', ...segments);
}

export const DEFAULT_MULTI_AGENT_SESSIONS_DIR = resolveRuntimePath('discussions', 'sessions');
export const DEFAULT_MULTI_AGENT_REPORTS_DIR = resolveRuntimePath('reports');
