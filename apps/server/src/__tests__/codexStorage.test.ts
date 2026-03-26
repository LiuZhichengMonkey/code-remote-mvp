import fs from 'fs';
import os from 'os';
import path from 'path';
import { CodexSessionStorage } from '../codexStorage';

describe('CodexSessionStorage', () => {
  let workspaceRoot: string;
  let projectPath: string;
  let sessionFilePath: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-test-'));
    projectPath = path.join(workspaceRoot, 'project');
    sessionFilePath = path.join(workspaceRoot, 'session.jsonl');
    fs.mkdirSync(projectPath, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(workspaceRoot)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('preserves consecutive assistant messages, dedupes commentary, and captures custom tool calls', () => {
    const sessionId = 'codex-session-1';
    const baseTime = Date.parse('2026-03-21T10:00:00.000Z');
    const timestamp = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();
    const uploadedImagePath = path.join(projectPath, 'uploads', 'input.png');
    const localImagePath = path.join(projectPath, 'local', 'reference.jpg');

    const lines = [
      {
        type: 'session_meta',
        timestamp: timestamp(0),
        payload: {
          id: sessionId,
          cwd: projectPath,
          timestamp: timestamp(0)
        }
      },
      {
        type: 'event_msg',
        timestamp: timestamp(1000),
        payload: {
          type: 'user_message',
          message: 'show history',
          images: [uploadedImagePath],
          local_images: [{ path: localImagePath }]
        }
      },
      {
        type: 'event_msg',
        timestamp: timestamp(2000),
        payload: {
          type: 'task_started'
        }
      },
      {
        type: 'event_msg',
        timestamp: timestamp(3000),
        payload: {
          type: 'agent_message',
          phase: 'commentary',
          message: 'Working...'
        }
      },
      {
        type: 'response_item',
        timestamp: timestamp(3000),
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [
            {
              type: 'output_text',
              text: 'Working...'
            }
          ]
        }
      },
      {
        type: 'response_item',
        timestamp: timestamp(4000),
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          call_id: 'custom-tool-1',
          arguments: JSON.stringify({ path: 'apps/web/src/App.tsx' })
        }
      },
      {
        type: 'response_item',
        timestamp: timestamp(5000),
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'custom-tool-1',
          output: 'patched'
        }
      },
      {
        type: 'response_item',
        timestamp: timestamp(6000),
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            {
              type: 'output_text',
              text: 'First answer'
            }
          ]
        }
      },
      {
        type: 'response_item',
        timestamp: timestamp(7000),
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            {
              type: 'output_text',
              text: 'Second answer'
            }
          ]
        }
      },
      {
        type: 'event_msg',
        timestamp: timestamp(8000),
        payload: {
          type: 'task_complete'
        }
      }
    ];

    fs.writeFileSync(sessionFilePath, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, 'utf-8');

    const storage = new CodexSessionStorage(workspaceRoot, projectPath);
    const parsed = (storage as any).parseSessionFile(sessionFilePath);

    expect(parsed).not.toBeNull();
    expect(parsed.session.messages).toHaveLength(3);
    expect(parsed.session.messages.map((message: { role: string; content: string }) => ({
      role: message.role,
      content: message.content
    }))).toEqual([
      { role: 'user', content: 'show history' },
      { role: 'assistant', content: 'First answer' },
      { role: 'assistant', content: 'Second answer' }
    ]);
    expect(parsed.session.messages[0].images).toEqual([uploadedImagePath, localImagePath]);

    const firstAssistantProcess = parsed.session.messages[1].process;
    expect(firstAssistantProcess).toBeDefined();
    expect(
      firstAssistantProcess.events.filter(
        (event: { type: string; level?: string; message?: string }) =>
          event.type === 'log' && event.level === 'info' && event.message === 'Working...'
      )
    ).toHaveLength(1);
    expect(firstAssistantProcess.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_use',
        toolName: 'apply_patch',
        toolUseId: 'custom-tool-1',
        toolInput: { path: 'apps/web/src/App.tsx' }
      }),
      expect.objectContaining({
        type: 'tool_result',
        toolUseId: 'custom-tool-1',
        result: 'patched',
        isError: false
      })
    ]));

    const secondAssistantProcess = parsed.session.messages[2].process;
    expect(secondAssistantProcess).toBeDefined();
    expect(secondAssistantProcess?.state).toBe('completed');
    expect(secondAssistantProcess?.events).toEqual([
      expect.objectContaining({
        type: 'status',
        label: 'Codex completed the response'
      })
    ]);
  });
});
