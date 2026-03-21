import { ClaudeHandler } from '../handlers/claude';
import { encodeProjectId } from '../session/provider';

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

  return {
    createTemporary: jest.fn((title?: string, provider: 'claude' | 'codex' = 'claude') => {
      tempCounter += 1;
      currentSession = {
        ...createSession(`temp-${provider}-${tempCounter}`, provider),
        title: title || 'New Chat'
      };
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
    getMessagesForAPI: jest.fn(() => currentSession ? [...currentSession.messages] : []),
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
  beforeEach(() => {
    mockMessageCounter = 0;
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
});
