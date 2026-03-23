import { describe, expect, it } from 'vitest';
import { ChatSession } from '../types';
import {
  findLocalSession,
  mergeResumedSession,
  mergeSessionSummaryList,
  renameRunningSessionCollections,
  resolveRunningSessionDetails,
  resolveSessionProvider,
  sessionHasRenderableResult
} from './chatSessionState';

describe('chatSessionState helpers', () => {
  const rootSession: ChatSession = {
    id: 'root-1',
    title: 'Root session',
    createdAt: 1,
    provider: 'claude',
    messages: []
  };

  const projectSession: ChatSession = {
    id: 'project-1',
    title: 'Project session',
    createdAt: 2,
    provider: 'codex',
    messages: [{
      id: 'm1',
      role: 'model',
      content: 'Done',
      timestamp: 2,
      status: 'sent'
    }]
  };

  it('finds sessions across root and project collections', () => {
    const sessions = [rootSession];
    const projectSessions = { p1: [projectSession] };

    expect(findLocalSession(sessions, projectSessions, 'root-1', null)?.title).toBe('Root session');
    expect(findLocalSession(sessions, projectSessions, 'project-1', 'p1')?.provider).toBe('codex');
  });

  it('prefers the more complete copy when the same session exists in multiple collections', () => {
    const duplicatedRootSession: ChatSession = {
      id: 'dup-1',
      title: 'Duplicated root',
      createdAt: 10,
      provider: 'codex',
      messages: [{
        id: 'u1',
        role: 'user',
        content: 'continue',
        timestamp: 10,
        status: 'sent'
      }]
    };
    const duplicatedProjectSession: ChatSession = {
      id: 'dup-1',
      title: 'Duplicated project',
      createdAt: 10,
      provider: 'codex',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'continue',
          timestamp: 10,
          status: 'sent'
        },
        {
          id: 'm1',
          role: 'model',
          content: 'full answer',
          timestamp: 11,
          status: 'sent'
        }
      ]
    };

    const resolved = findLocalSession(
      [duplicatedRootSession],
      { p1: [duplicatedProjectSession] },
      'dup-1',
      'p1'
    );

    expect(resolved?.messages).toHaveLength(2);
    expect(resolved?.messages[1]?.role).toBe('model');
  });

  it('resolves running session details from project data when map data is incomplete', () => {
    const details = resolveRunningSessionDetails(
      'project-1',
      [],
      { p1: [projectSession] },
      new Map()
    );

    expect(details).toEqual({
      title: 'Project session',
      projectId: 'p1',
      provider: 'codex'
    });
  });

  it('prefers session provider over project fallback', () => {
    const provider = resolveSessionProvider(
      [rootSession],
      { p1: [projectSession] },
      [{ id: 'p1', provider: 'claude' }],
      'project-1',
      'p1',
      'claude'
    );

    expect(provider).toBe('codex');
  });

  it('detects renderable model output and ignores user-only sessions', () => {
    const emptySession: ChatSession = {
      id: 'empty',
      title: 'Empty',
      createdAt: 3,
      provider: 'claude',
      messages: [{
        id: 'u1',
        role: 'user',
        content: 'hello',
        timestamp: 3,
        status: 'sent'
      }]
    };

    expect(sessionHasRenderableResult([projectSession], {}, 'project-1')).toBe(true);
    expect(sessionHasRenderableResult([emptySession], {}, 'empty')).toBe(false);
  });

  it('renames running session collections without losing metadata', () => {
    const renamed = renameRunningSessionCollections(
      new Set(['old-id']),
      new Map([['old-id', { title: 'Old title', provider: 'codex', projectId: 'p1' }]]),
      'old-id',
      'new-id',
      { title: 'New title', provider: 'codex' }
    );

    expect(Array.from(renamed.runningSessions)).toEqual(['new-id']);
    expect(renamed.runningSessionsInfo.get('new-id')).toEqual({
      title: 'New title',
      provider: 'codex',
      projectId: 'p1'
    });
  });

  it('preserves existing messages when a summary-only session list arrives later', () => {
    const existing: ChatSession[] = [{
      id: 'keep-1',
      title: 'Existing',
      createdAt: 12,
      provider: 'codex',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'continue',
          timestamp: 12,
          status: 'sent'
        },
        {
          id: 'm1',
          role: 'model',
          content: 'complete answer',
          timestamp: 13,
          status: 'sent'
        }
      ]
    }];
    const incoming: ChatSession[] = [{
      id: 'keep-1',
      title: 'Summary title',
      createdAt: 12,
      provider: 'codex',
      messages: []
    }];

    const merged = mergeSessionSummaryList(existing, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Summary title');
    expect(merged[0].messages).toHaveLength(2);
    expect(merged[0].messages[1]?.content).toBe('complete answer');
  });

  it('prefers resumed messages over a reconnect placeholder while running', () => {
    const existing: ChatSession = {
      id: 'running-1',
      title: 'Running session',
      createdAt: 20,
      provider: 'codex',
      messages: [{
        id: 'reconnect_running-1',
        role: 'model',
        content: 'Codex is still running. Restoring live progress after refresh...',
        timestamp: 21,
        status: 'sent',
        process: {
          provider: 'codex',
          state: 'running',
          events: [{
            type: 'status',
            label: 'Reconnecting after refresh',
            timestamp: 21
          }]
        }
      }]
    };
    const resumed: ChatSession = {
      id: 'running-1',
      title: 'Running session',
      createdAt: 20,
      provider: 'codex',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'hello',
          timestamp: 20,
          status: 'sent'
        },
        {
          id: 'm1',
          role: 'model',
          content: 'partial answer',
          timestamp: 22,
          status: 'sending'
        }
      ]
    };

    const merged = mergeResumedSession(existing, resumed, true);

    expect(merged.messages).toBe(resumed.messages);
    expect(merged.messages).toHaveLength(2);
    expect(sessionHasRenderableResult([merged], {}, 'running-1')).toBe(true);
  });

  it('keeps richer local running messages when the resumed copy is older', () => {
    const existing: ChatSession = {
      id: 'running-2',
      title: 'Running session',
      createdAt: 30,
      provider: 'codex',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'hello',
          timestamp: 30,
          status: 'sent'
        },
        {
          id: 'm1',
          role: 'model',
          content: 'partial answer from live stream',
          timestamp: 32,
          status: 'sending'
        }
      ]
    };
    const resumed: ChatSession = {
      id: 'running-2',
      title: 'Running session',
      createdAt: 30,
      provider: 'codex',
      messages: [{
        id: 'u1',
        role: 'user',
        content: 'hello',
        timestamp: 30,
        status: 'sent'
      }]
    };

    const merged = mergeResumedSession(existing, resumed, true);

    expect(merged.messages).toBe(existing.messages);
    expect(merged.messages[1]?.content).toBe('partial answer from live stream');
  });

  it('does not treat reconnect placeholders as completed results', () => {
    const placeholderOnly: ChatSession = {
      id: 'running-3',
      title: 'Running session',
      createdAt: 40,
      provider: 'codex',
      messages: [{
        id: 'reconnect_running-3',
        role: 'model',
        content: 'Codex is still running. Restoring live progress after refresh...',
        timestamp: 41,
        status: 'sent',
        process: {
          provider: 'codex',
          state: 'running',
          events: [{
            type: 'status',
            label: 'Reconnecting after refresh',
            timestamp: 41
          }]
        }
      }]
    };

    expect(sessionHasRenderableResult([placeholderOnly], {}, 'running-3')).toBe(false);
  });
});
