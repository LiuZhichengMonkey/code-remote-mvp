import fs from 'fs';
import os from 'os';
import path from 'path';
import { ClaudeHandler } from '../handlers/claude';
import { encodeProjectId } from '../session/provider';
import { resolveSessionWorkspace } from '../sessionWorkspace';

let mockClaudeEngine: any;
let mockCodexEngine: any;
let mockSessionManager: any;
let mockCodexStorageStatics: any;
let mockMessageCounter = 0;

jest.mock('../claude', () => ({
  ClaudeCodeEngine: jest.fn(() => mockClaudeEngine),
  SessionManager: jest.fn(() => mockSessionManager),
  createMessage: jest.fn((role: 'user' | 'assistant', content: string) => ({
    id: `msg-${++mockMessageCounter}`,
    role,
    content,
    timestamp: Date.now()
  })),
  getProviderSessionId: jest.fn((session: any) => session?.providerSessionId || session?.claudeSessionId)
}));

jest.mock('../codex', () => ({
  CodexCodeEngine: jest.fn(() => mockCodexEngine)
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

function createSession(id: string, provider: 'claude' | 'codex') {
  return {
    id,
    title: `${provider} session`,
    createdAt: 1000,
    updatedAt: 1000,
    messages: [],
    provider,
    projectId: 'E--code-remote-mvp',
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
    addMessage: jest.fn((message: any) => {
      if (!currentSession) {
        currentSession = {
          ...createSession('temp-claude-auto', 'claude'),
          title: 'New Chat'
        };
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
    getMessagesForAPI: jest.fn(() => currentSession ? [...currentSession.messages] : []),
    getMessagesForSession: jest.fn((sessionId: string) => {
      const session = sessions.get(sessionId) || null;
      return session ? [...session.messages] : [];
    }),
    getCurrent: jest.fn(() => currentSession),
    updateSessionId: jest.fn((newSessionId: string) => {
      if (!currentSession) return;
      sessions.delete(currentSession.id);
      currentSession.id = newSessionId;
      currentSession.providerSessionId = newSessionId;
      if (currentSession.provider === 'claude') {
        currentSession.claudeSessionId = newSessionId;
      }
      sessions.set(newSessionId, currentSession);
    }),
    setProviderSessionId: jest.fn((providerSessionId: string) => {
      if (!currentSession) return;
      currentSession.providerSessionId = providerSessionId;
      if (currentSession.provider === 'claude') {
        currentSession.claudeSessionId = providerSessionId;
      }
    }),
    setProviderSessionIdForSession: jest.fn((sessionId: string, providerSessionId: string) => {
      const session = sessions.get(sessionId) || null;
      if (!session) return null;
      session.providerSessionId = providerSessionId;
      if (session.provider === 'claude') {
        session.claudeSessionId = providerSessionId;
      }
      return session;
    }),
    updateSessionIdForSession: jest.fn((sessionId: string, newSessionId: string) => {
      const session = sessions.get(sessionId) || null;
      if (!session) return null;
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
    getProjectId: jest.fn(() => 'E--code-remote-mvp'),
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
    list: jest.fn(() => []),
    delete: jest.fn(() => true),
    rename: jest.fn(() => true),
    setSessionFromCrossProject: jest.fn((session: any) => {
      currentSession = session;
      sessions.set(session.id, session);
    }),
    getStorage: jest.fn(() => ({}))
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

describe('ClaudeHandler provider behavior', () => {
  let tempWorkspaceRoot: string;

  beforeEach(() => {
    mockMessageCounter = 0;
    tempWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-provider-test-'));
    mockSessionManager = createSessionManagerMock();
    mockClaudeEngine = {
      stop: jest.fn(() => true),
      isRunning: jest.fn(() => false),
      sendMessage: jest.fn(async () => ({
        response: 'claude response',
        claudeSessionId: 'claude-real-session'
      }))
    };
    mockCodexEngine = {
      stop: jest.fn(() => true),
      isRunning: jest.fn(() => false),
      sendMessage: jest.fn(async (
        _message: string,
        _messages: any[],
        onChunk: (content: string, done: boolean) => void
      ) => {
        onChunk('codex partial', false);
        return {
          response: 'codex response',
          providerSessionId: 'codex-real-session'
        };
      })
    };

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
    CodexSessionStorage.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tempWorkspaceRoot, { recursive: true, force: true });
  });

  test('session:new keeps requested provider on the created session', () => {
    const handler = new ClaudeHandler('E:/code-remote-mvp');
    const ws = createWebSocketMock();

    handler.handleSessionAction(ws, 'new', undefined, undefined, 'Codex Chat', undefined, undefined, 'codex');

    const [message] = parseSentMessages(ws);
    expect(message.type).toBe('session_created');
    expect(message.provider).toBe('codex');
    expect(message.session.provider).toBe('codex');
    expect(message.projectId).toBe(encodeProjectId('codex', 'E--code-remote-mvp'));
  });

  test('tester new session is created inside an isolated workspace', () => {
    const handler = new ClaudeHandler(tempWorkspaceRoot);
    const ws = createWebSocketMock();
    const testerIdentity = {
      accessMode: 'tester' as const,
      ownerId: 'shenghua.yang',
      permissions: {
        canViewAllSessions: false,
        canManageSettings: false
      }
    };

    handler.handleSessionAction(ws, 'new', undefined, undefined, 'Tester Chat', undefined, undefined, 'codex', testerIdentity);

    const [message] = parseSentMessages(ws);
    const testerWorkspace = resolveSessionWorkspace(tempWorkspaceRoot, testerIdentity);
    expect(message.type).toBe('session_created');
    expect(message.projectId).toBe(encodeProjectId('codex', testerWorkspace.projectId));
    expect(mockSessionManager.createTemporary).toHaveBeenCalledWith(
      'Tester Chat',
      'codex',
      expect.objectContaining({
        cwd: testerWorkspace.workspacePath,
        projectId: testerWorkspace.projectId
      })
    );
  });

  test('chat flow keeps codex provider and emits session_id_updated', async () => {
    const handler = new ClaudeHandler('E:/code-remote-mvp');
    const ws = createWebSocketMock();
    const sendError = jest.fn();

    await handler.handleClaudeMessage(ws, 'hello codex', sendError, undefined, undefined, undefined, 'codex');

    expect(sendError).not.toHaveBeenCalled();
    expect(mockCodexEngine.sendMessage).toHaveBeenCalledTimes(1);

    const sent = parseSentMessages(ws);
    const start = sent.find(message => message.type === 'claude_start');
    const stream = sent.find(message => message.type === 'claude_stream');
    const sessionUpdated = sent.find(message => message.type === 'session_id_updated');
    const done = sent.find(message => message.type === 'claude_done');

    expect(start).toMatchObject({
      type: 'claude_start',
      provider: 'codex'
    });
    expect(stream).toMatchObject({
      type: 'claude_stream',
      provider: 'codex',
      content: 'codex partial'
    });
    expect(sessionUpdated).toMatchObject({
      type: 'session_id_updated',
      provider: 'codex',
      oldSessionId: 'temp-codex-1',
      newSessionId: 'codex-real-session',
      projectId: encodeProjectId('codex', 'E--code-remote-mvp')
    });
    expect(done).toMatchObject({
      type: 'claude_done',
      provider: 'codex',
      sessionId: 'codex-real-session',
      providerSessionId: 'codex-real-session',
      projectId: encodeProjectId('codex', 'E--code-remote-mvp')
    });
  });

  test('tester codex session keeps tester ownership even if currentSession changes mid-run', async () => {
    const handler = new ClaudeHandler(tempWorkspaceRoot);
    const ws = createWebSocketMock();
    const sendError = jest.fn();
    const testerIdentity = {
      accessMode: 'tester' as const,
      ownerId: 'shenghua.yang',
      permissions: {
        canViewAllSessions: false,
        canManageSettings: false
      }
    };
    let resolveRun: ((value: { response: string; providerSessionId: string }) => void) | undefined;

    mockCodexEngine.sendMessage.mockImplementationOnce(async () => {
      return await new Promise(resolve => {
        resolveRun = resolve as (value: { response: string; providerSessionId: string }) => void;
      });
    });

    const runPromise = handler.handleClaudeMessage(
      ws,
      'hello tester codex',
      sendError,
      undefined,
      undefined,
      undefined,
      'codex',
      testerIdentity
    );

    await Promise.resolve();

    mockSessionManager.createTemporary('admin-race', 'claude');
    resolveRun?.({ response: 'tester codex response', providerSessionId: 'codex-tester-session' });
    await runPromise;

    const testerWorkspace = resolveSessionWorkspace(tempWorkspaceRoot, testerIdentity);
    const accessFile = path.join(tempWorkspaceRoot, '.coderemote', 'session-access.json');
    const accessStore = JSON.parse(fs.readFileSync(accessFile, 'utf-8'));
    const record = accessStore[`codex:${testerWorkspace.projectId}:codex-tester-session`];

    expect(sendError).not.toHaveBeenCalled();
    expect(record).toMatchObject({
      provider: 'codex',
      projectId: testerWorkspace.projectId,
      sessionId: 'codex-tester-session',
      ownerType: 'tester',
      ownerId: 'shenghua.yang'
    });
  });

  test('cross-project codex resume keeps provider on session_resumed payload', () => {
    const handler = new ClaudeHandler('E:/code-remote-mvp');
    const ws = createWebSocketMock();
    const codexSession = {
      ...createSession('codex-session-1', 'codex'),
      messages: [
        { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'hi', timestamp: 2 }
      ],
      providerSessionId: 'codex-session-1'
    };

    mockCodexStorageStatics.loadSessionFromProjectPaginated.mockReturnValue({
      session: codexSession,
      hasMore: false,
      totalMessages: 2
    });

    handler.handleSessionAction(
      ws,
      'resume',
      'codex-session-1',
      encodeProjectId('codex', 'E--code-remote-mvp'),
      undefined,
      20
    );

    const [message] = parseSentMessages(ws);
    expect(message.type).toBe('session_resumed');
    expect(message.provider).toBe('codex');
    expect(message.projectId).toBe(encodeProjectId('codex', 'E--code-remote-mvp'));
    expect(message.session.provider).toBe('codex');
    expect(message.session.messages).toEqual([
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
      { id: 'a1', role: 'model', content: 'hi', timestamp: 2 }
    ]);
    expect(mockSessionManager.setSessionFromCrossProject).toHaveBeenCalledWith(codexSession);
  });

  test('buffers running logs for an unfocused codex session and flushes them after focus returns', async () => {
    const handler = new ClaudeHandler('E:/code-remote-mvp');
    const ws = createWebSocketMock();
    const sendError = jest.fn();
    let resolveRun: any = null;
    handler.setActiveSession('another-session');

    mockCodexEngine.sendMessage.mockImplementation(async (
      _message: string,
      _messages: any[],
      onChunk: (content: string, done: boolean) => void,
      onLog: (log: { level: 'info' | 'debug' | 'warn' | 'error'; message: string; timestamp: number }) => void
    ) => {
      onLog({ level: 'info', message: 'Running build...', timestamp: 1234 });
      onChunk('partial', false);
      return await new Promise(resolve => {
        resolveRun = resolve;
      });
    });

    const runPromise = handler.handleClaudeMessage(ws, 'hello codex', sendError, undefined, undefined, undefined, 'codex');

    await Promise.resolve();

    let sent = parseSentMessages(ws);
    expect(sent.some(message => message.type === 'claude_log' && message.message === 'Running build...')).toBe(false);

    handler.setActiveSession('temp-codex-1');

    sent = parseSentMessages(ws);
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'claude_log',
        sessionId: 'temp-codex-1',
        provider: 'codex',
        message: 'Running build...'
      }),
      expect.objectContaining({
        type: 'claude_stream',
        sessionId: 'temp-codex-1',
        provider: 'codex',
        content: 'partial',
        replace: true,
        done: false
      })
    ]));

    if (resolveRun) {
      resolveRun({ response: 'codex response', providerSessionId: 'codex-real-session' });
    }
    await runPromise;

    expect(sendError).not.toHaveBeenCalled();
  });

  test('normalizes codex upstream transport errors as stream errors instead of CLI_NOT_FOUND', async () => {
    const handler = new ClaudeHandler('E:/code-remote-mvp');
    const ws = createWebSocketMock();
    const sendError = jest.fn();

    mockCodexEngine.sendMessage.mockRejectedValueOnce(new Error(
      'Reconnecting... 1/5 (stream disconnected before completion: Transport error: network error: error decoding response body)'
    ));

    await handler.handleClaudeMessage(ws, 'hello codex', sendError, undefined, undefined, undefined, 'codex');

    expect(sendError).toHaveBeenCalledWith(
      'STREAM_ERROR',
      expect.stringContaining('Codex upstream stream disconnected.')
    );
    expect(sendError).toHaveBeenCalledWith(
      'STREAM_ERROR',
      expect.stringContaining('error decoding response body')
    );
  });

  test('keeps CLI not found errors classified correctly for codex', async () => {
    const handler = new ClaudeHandler('E:/code-remote-mvp');
    const ws = createWebSocketMock();
    const sendError = jest.fn();

    mockCodexEngine.sendMessage.mockRejectedValueOnce(new Error('Codex CLI not found'));

    await handler.handleClaudeMessage(ws, 'hello codex', sendError, undefined, undefined, undefined, 'codex');

    expect(sendError).toHaveBeenCalledWith('CLI_NOT_FOUND', 'Codex CLI not found');
  });

  test('reconnect emits a running state snapshot for a silent codex task', async () => {
    const handler = new ClaudeHandler('E:/code-remote-mvp');
    const ws = createWebSocketMock();
    const reconnectWs = createWebSocketMock();
    const sendError = jest.fn();
    let resolveRun: ((value: { response: string; providerSessionId: string }) => void) | undefined;

    mockCodexEngine.sendMessage.mockImplementation(async () => {
      return await new Promise(resolve => {
        resolveRun = resolve as (value: { response: string; providerSessionId: string }) => void;
      });
    });

    const runPromise = handler.handleClaudeMessage(ws, 'hello codex', sendError, undefined, undefined, undefined, 'codex');

    await Promise.resolve();

    expect(handler.updateRunningWebSocket(reconnectWs)).toBe(true);

    const sent = parseSentMessages(reconnectWs);
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'session_running_state',
        sessionId: 'temp-codex-1',
        provider: 'codex',
        reason: 'reconnect'
      })
    ]));

    resolveRun?.({ response: 'codex response', providerSessionId: 'codex-real-session' });
    await runPromise;

    expect(sendError).not.toHaveBeenCalled();
  });
});
