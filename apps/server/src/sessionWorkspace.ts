import fs from 'fs';
import path from 'path';
import { AccessIdentity, isAdminAccess } from './accessControl';
import { pathToProjectKey } from './session/provider';

export interface SessionWorkspaceContext {
  workspacePath: string;
  projectId: string;
}

const TESTER_WORKSPACE_SEGMENTS = ['runtime', 'test-users'];

function sanitizeOwnerSegment(ownerId: string | undefined): string {
  const normalized = (ownerId || 'tester')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'tester';
}

export function resolveSessionWorkspace(
  baseWorkspaceRoot: string,
  accessIdentity?: AccessIdentity
): SessionWorkspaceContext {
  const resolvedBaseRoot = path.resolve(baseWorkspaceRoot);
  const workspacePath = accessIdentity && !isAdminAccess(accessIdentity)
    ? path.join(
        resolvedBaseRoot,
        ...TESTER_WORKSPACE_SEGMENTS,
        sanitizeOwnerSegment(accessIdentity.ownerId),
        'workspace'
      )
    : resolvedBaseRoot;

  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  return {
    workspacePath,
    projectId: pathToProjectKey(workspacePath)
  };
}
