import { EventEmitter } from 'events';
import { ClaudeCodeEngine } from '../claude/engine';
import { CodexCodeEngine } from '../codexEngine';

const spawnMock = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  exec: jest.fn()
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    write: jest.fn(),
    end: jest.fn()
  };
  pid = 1234;
  kill = jest.fn();

  constructor(
    private readonly stdoutLines: string[] = [],
    private readonly options: { autoClose?: boolean } = {}
  ) {
    super();
    setImmediate(() => {
      for (const line of this.stdoutLines) {
        this.stdout.emit('data', `${line}\n`);
      }
      if (this.options.autoClose !== false) {
        this.emit('close', 0);
      }
    });
  }
}

describe('CLI engine invocation args', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    delete process.env.CODEX_CLI_COMPLETION_GRACE_MS;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('ClaudeCodeEngine enables bypass permissions by default', async () => {
    const child = new FakeChildProcess([
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'ok',
        session_id: 'claude-session-1'
      })
    ]);
    spawnMock.mockReturnValue(child);

    const engine = new ClaudeCodeEngine();
    const result = await (engine as any).callClaudeCLI(
      'test prompt',
      jest.fn(),
      jest.fn(),
      'existing-session',
      'E:/code-remote-mvp',
      null
    );

    expect(result.claudeSessionId).toBe('claude-session-1');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];

    expect(command).toBe('claude');
    expect(args).toEqual(expect.arrayContaining([
      '--print',
      '--verbose',
      '--dangerously-skip-permissions',
      '--permission-mode',
      'bypassPermissions',
      '--resume',
      'existing-session'
    ]));
    expect(options).toMatchObject({
      cwd: 'E:/code-remote-mvp',
      shell: true
    });
  });

  test('CodexCodeEngine uses bypass approvals and keeps resume arg order', async () => {
    const child = new FakeChildProcess([
      JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-1' }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'ok' }
      })
    ]);
    spawnMock.mockReturnValue(child);

    const engine = new CodexCodeEngine();
    const result = await (engine as any).callCodexCLI(
      'test prompt',
      jest.fn(),
      jest.fn(),
      'resume-session-1',
      'E:/code-remote-mvp',
      ['C:/tmp/image1.png']
    );

    expect(result).toEqual({
      response: 'ok',
      providerSessionId: 'codex-thread-1'
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];

    expect(command).toBe('codex');
    expect(args).toEqual([
      '-C',
      'E:/code-remote-mvp',
      'exec',
      'resume',
      'resume-session-1',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
      '--image',
      'C:/tmp/image1.png',
      '-'
    ]);
    expect(options).toMatchObject({
      cwd: 'E:/code-remote-mvp',
      shell: true
    });
  });

  test('CodexCodeEngine returns collected response after turn completion even if the process lingers', async () => {
    jest.useFakeTimers();
    process.env.CODEX_CLI_COMPLETION_GRACE_MS = '10';

    const onChunk = jest.fn();
    const child = new FakeChildProcess([
      JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-2' }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'done' }
      }),
      JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 4 } })
    ], { autoClose: false });
    spawnMock.mockReturnValue(child);

    const engine = new CodexCodeEngine();
    const resultPromise = (engine as any).callCodexCLI(
      'test prompt',
      onChunk,
      jest.fn(),
      undefined,
      'E:/code-remote-mvp',
      []
    );

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toEqual({
      response: 'done',
      providerSessionId: 'codex-thread-2'
    });
    expect(child.kill).toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledWith('', true);
  });
});
