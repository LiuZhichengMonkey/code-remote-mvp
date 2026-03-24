import fs from 'fs';
import os from 'os';
import path from 'path';
import { ClaudeHandler } from '../handlers/claude';
import { createAdminAccessIdentity, createTesterAccessIdentity } from '../accessControl';
import { encodeProjectId } from '../session/provider';
import { resolveSessionWorkspace } from '../sessionWorkspace';

let mockSessionManager: any;
let mockSessionStorageStatics: any;
let mockCodexStorageStatics: any;

jest.mock('../claude', () => ({
  ClaudeCodeEngine: jest.fn(() => ({
    stop: jest.fn(() => true),
    isRunning: jest.fn(() => false),
    sendMessage: jest.fn()
  })),
  SessionManager: jest.fn(() => mockSessionManager),
  createMessage: jest.fn((role: 'user' | 'assistant', content: string) => ({
    id: `msg-${role}-${Date.now()}`,
    role,
    content,
    timestamp: Date.now()
  })),
  getProviderSessionId: jest.fn((session: any) => session?.providerSessionId || session?.claudeSessionId)
}));

jest.mock('../claude/storage', () => {
  const SessionStorage = jest.fn();
  return {
    SessionStorage,
    __esModule: true
  };
});

jest.mock('../codex', () => ({
  CodexCodeEngine: jest.fn(() => ({
    stop: jest.fn(() => true),
    isRunning: jest.fn(() => false),
    sendMessage: jest.fn()
  }))
}));

jest.mock('../codexStorage', () => {
  const CodexSessionStorage = jest.fn();
  return {
    CodexSessionStorage,
    __esModule: true
  };
});

jest.mock('../agent', () => ({
  hasAgentMention: jest.fn(() => false),
  parseAgentMentions: jest.fn(() => ({ cleanMessage: '', hostAgent: null })),
  listAvailableAgents: jest.fn(() => []),
  loadAgentContext: jest.fn(() => null)
}));

function createSession(
  id: string,
  provider: 'claude' | 'codex' = 'claude',
  projectId = 'E--code-remote-mvp'
) {
  return {
    id,
    title: `${provider} session`,
    createdAt: 1000,
    updatedAt: 1000,
    messages: [],
    provider,
    projectId,
    cwd: 'E:/code-remote-mvp'
  };
}

function createSessionManagerMock() {
  let currentSession: any = null;
  const sessions = new Map<string, any>();
  let tempCounter = 0;
  const applyContext = (session: any, context?: { cwd?: string; projectId?: string }) => {
    if (!context) {
      return session;
    }

    if (context.cwd) {
      session.cwd = context.cwd;
    }
    if (context.projectId) {
      session.projectId = context.projectId;
    }
    return session;
  };

  const toSessionInfo = (session: any) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    messageCount: session.messages.length,
    provider: session.provider,
    projectId: session.projectId,
    lastActivity: session.updatedAt
  });

  return {
    createTemporary: jest.fn((title?: string, provider: 'claude' | 'codex' = 'claude', context?: { cwd?: string; projectId?: string }) => {
      tempCounter += 1;
      currentSession = applyContext({
        ...createSession(`temp-${provider}-${tempCounter}`, provider),
        title: title || 'New Chat'
      }, context);
      sessions.set(currentSession.id, currentSession);
      return currentSession;
    }),
    getProjectId: jest.fn(() => 'E--code-remote-mvp'),
    getCurrent: jest.fn(() => currentSession),
    getMessagesForAPI: jest.fn(() => currentSession ? [...currentSession.messages] : []),
    getMessagesForSession: jest.fn((sessionId: string) => {
      const session = sessions.get(sessionId) || null;
      return session ? [...session.messages] : [];
    }),
    addMessage: jest.fn((message: any) => {
      if (!currentSession) {
        currentSession = createSession('temp-claude-auto');
        sessions.set(currentSession.id, currentSession);
      }
      currentSession.messages.push(message);
      currentSession.updatedAt = Date.now();
    }),
    addMessageToSession: jest.fn((sessionId: string, message: any) => {
      const session = sessions.get(sessionId) || null;
      if (!session) {
        return null;
      }
      session.messages.push(message);
      session.updatedAt = Date.now();
      return session;
    }),
    updateSessionId: jest.fn(),
    updateSessionIdForSession: jest.fn((sessionId: string, newSessionId: string) => {
      const session = sessions.get(sessionId) || null;
      if (!session) {
        return null;
      }
      sessions.delete(sessionId);
      session.id = newSessionId;
      session.providerSessionId = newSessionId;
      if (session.provider === 'claude') {
        session.claudeSessionId = newSessionId;
      }
      sessions.set(newSessionId, session);
      if (currentSession?.id === sessionId) {
        currentSession = session;
      }
      return session;
    }),
    setProviderSessionId: jest.fn(),
    setProviderSessionIdForSession: jest.fn((sessionId: string, providerSessionId: string) => {
      const session = sessions.get(sessionId) || null;
      if (!session) {
        return null;
      }
      session.providerSessionId = providerSessionId;
      if (session.provider === 'claude') {
        session.claudeSessionId = providerSessionId;
      }
      return session;
    }),
    get: jest.fn((sessionId: string) => sessions.get(sessionId) || null),
    resume: jest.fn((sessionId: string) => sessions.get(sessionId) || null),
    resumePaginated: jest.fn((sessionId: string) => {
      const session = sessions.get(sessionId) || null;
      return {
        session,
        hasMore: false,
        totalMessages: session?.messages?.length || 0
      };
    }),
    list: jest.fn(() => Array.from(sessions.values()).map(toSessionInfo)),
    delete: jest.fn((sessionId: string) => sessions.delete(sessionId)),
    rename: jest.fn((sessionId: string, title: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return false;
      }
      session.title = title;
      return true;
    }),
    setSessionFromCrossProject: jest.fn((session: any) => {
      currentSession = session;
      sessions.set(session.id, session);
    }),
    getStorage: jest.fn(() => ({ load: jest.fn(() => null) })),
    getStorageByProvider: jest.fn(() => ({
      load: (sessionId: string) => sessions.get(sessionId) || null
    })),
    seedSession: (session: any) => {
      sessions.set(session.id, session);
    }
  };
}

function createWebSocketMock() {
  return {
    readyState: 1,
    send: jest.fn()
  } as any;
}

function parseSentMessages(ws: { send: jest.Mock }) {
  return ws.send.mock.calls.map(([payload]) => JSON.parse(payload));
}

describe('ClaudeHandler access control', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-handler-access-'));
    mockSessionManager = createSessionManagerMock();

    const { SessionStorage } = jest.requireMock('../claude/storage');
    mockSessionStorageStatics = {
      listAllProjects: jest.fn(() => []),
      listSessionsByProject: jest.fn(() => []),
      loadSessionFromProject: jest.fn(() => null),
      loadSessionFromProjectPaginated: jest.fn(() => ({ session: null, hasMore: false, totalMessages: 0 })),
      deleteSessionFromProject: jest.fn(() => true),
      renameSessionFromProject: jest.fn(() => true)
    };
    Object.assign(SessionStorage, mockSessionStorageStatics);

    const { CodexSessionStorage } = jest.requireMock('../codexStorage');
    mockCodexStorageStatics = {
      listAllProjects: jest.fn(() => []),
      listSessionsByProject: jest.fn(() => []),
      loadSessionFromProject: jest.fn(() => null),
      loadSessionFromProjectPaginated: jest.fn(() => ({ session: null, hasMore: false, totalMessages: 0 })),
      deleteSessionFromProject: jest.fn(() => true),
      renameSessionFromProject: jest.fn(() => true)
    };
    Object.assign(CodexSessionStorage, mockCodexStorageStatics);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('tester list only includes the tester-owned sessions while admin sees everything', () => {
    const handler = new ClaudeHandler(workspaceRoot);
    const testerA = createTesterAccessIdentity('shenghua.yang');
    const testerB = createTesterAccessIdentity('wenlong.fu');
    const admin = createAdminAccessIdentity();

    const createAws = createWebSocketMock();
    handler.handleSessionAction(createAws, 'new', undefined, undefined, 'A chat', undefined, undefined, 'claude', testerA);
    const testerASessionId = parseSentMessages(createAws)[0].session.id;

    const createBws = createWebSocketMock();
    handler.handleSessionAction(createBws, 'new', undefined, undefined, 'B chat', undefined, undefined, 'claude', testerB);
    const testerBSessionId = parseSentMessages(createBws)[0].session.id;

    mockSessionManager.seedSession(createSession('legacy-admin', 'claude'));

    const testerListWs = createWebSocketMock();
    handler.handleSessionAction(testerListWs, 'list', undefined, undefined, undefined, undefined, undefined, undefined, testerA);
    const testerSessions = parseSentMessages(testerListWs)[0].sessions.map((session: any) => session.id);

    const adminListWs = createWebSocketMock();
    handler.handleSessionAction(adminListWs, 'list', undefined, undefined, undefined, undefined, undefined, undefined, admin);
    const adminSessions = parseSentMessages(adminListWs)[0].sessions.map((session: any) => session.id);

    expect(testerSessions).toEqual([testerASessionId]);
    expect(adminSessions).toEqual(expect.arrayContaining([testerASessionId, testerBSessionId, 'legacy-admin']));
  });

  test('tester project list only counts accessible sessions', () => {
    const handler = new ClaudeHandler(workspaceRoot);
    const testerA = createTesterAccessIdentity('shenghua.yang');
    const testerB = createTesterAccessIdentity('wenlong.fu');
    const admin = createAdminAccessIdentity();
    const testerAProjectId = resolveSessionWorkspace(workspaceRoot, testerA).projectId;
    const testerBProjectId = resolveSessionWorkspace(workspaceRoot, testerB).projectId;
    const adminProjectId = resolveSessionWorkspace(workspaceRoot, admin).projectId;

    const createAws = createWebSocketMock();
    handler.handleSessionAction(createAws, 'new', undefined, undefined, 'A chat', undefined, undefined, 'claude', testerA);
    const testerASessionId = parseSentMessages(createAws)[0].session.id;

    const createBws = createWebSocketMock();
    handler.handleSessionAction(createBws, 'new', undefined, undefined, 'B chat', undefined, undefined, 'claude', testerB);
    const testerBSessionId = parseSentMessages(createBws)[0].session.id;

    mockSessionStorageStatics.listAllProjects.mockReturnValue([
      {
        id: testerAProjectId,
        displayName: 'tester-a',
        sessionCount: 1,
        lastActivity: 2000
      },
      {
        id: testerBProjectId,
        displayName: 'tester-b',
        sessionCount: 1,
        lastActivity: 2500
      },
      {
        id: adminProjectId,
        displayName: 'admin',
        sessionCount: 1,
        lastActivity: 3000
      }
    ]);
    mockSessionStorageStatics.listSessionsByProject.mockImplementation((projectId: string) => {
      if (projectId === testerAProjectId) {
        return [{
          id: testerASessionId,
          title: 'A chat',
          createdAt: 1000,
          messageCount: 1,
          provider: 'claude',
          projectId: testerAProjectId,
          lastActivity: 2000
        }];
      }

      if (projectId === testerBProjectId) {
        return [{
          id: testerBSessionId,
          title: 'B chat',
          createdAt: 1000,
          messageCount: 1,
          provider: 'claude',
          projectId: testerBProjectId,
          lastActivity: 2500
        }];
      }

      if (projectId === adminProjectId) {
        return [{
          id: 'legacy-admin',
          title: 'Legacy admin',
          createdAt: 1000,
          messageCount: 1,
          provider: 'claude',
          projectId: adminProjectId,
          lastActivity: 3000
        }];
      }

      return [];
    });

    const testerProjectsWs = createWebSocketMock();
    handler.handleSessionAction(testerProjectsWs, 'list_projects', undefined, undefined, undefined, undefined, undefined, undefined, testerA);
    const testerProjects = parseSentMessages(testerProjectsWs)[0].projects;

    const adminProjectsWs = createWebSocketMock();
    handler.handleSessionAction(adminProjectsWs, 'list_projects', undefined, undefined, undefined, undefined, undefined, undefined, admin);
    const adminProjects = parseSentMessages(adminProjectsWs)[0].projects;

    expect(testerProjects).toEqual([
      expect.objectContaining({
        id: encodeProjectId('claude', testerAProjectId),
        sessionCount: 1,
        lastActivity: 2000
      })
    ]);
    expect(adminProjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: encodeProjectId('claude', testerAProjectId),
        sessionCount: 1
      }),
      expect.objectContaining({
        id: encodeProjectId('claude', testerBProjectId),
        sessionCount: 1
      }),
      expect.objectContaining({
        id: encodeProjectId('claude', adminProjectId),
        sessionCount: 1
      })
    ]));
  });

  test('tester cannot resume another tester session', () => {
    const handler = new ClaudeHandler(workspaceRoot);
    const testerA = createTesterAccessIdentity('shenghua.yang');
    const testerB = createTesterAccessIdentity('wenlong.fu');

    const createAws = createWebSocketMock();
    handler.handleSessionAction(createAws, 'new', undefined, undefined, 'A chat', undefined, undefined, 'claude', testerA);
    const testerASessionId = parseSentMessages(createAws)[0].session.id;

    const resumeWs = createWebSocketMock();
    handler.handleSessionAction(resumeWs, 'resume', testerASessionId, undefined, undefined, 20, undefined, 'claude', testerB);

    expect(parseSentMessages(resumeWs)[0]).toMatchObject({
      type: 'error',
      content: 'Session not found'
    });
  });
});
