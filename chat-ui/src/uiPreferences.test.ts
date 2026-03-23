import { describe, expect, it } from 'vitest';
import { MessageProcess } from './types';
import {
  filterProcessForDisplay,
  normalizeUiPreferences
} from './uiPreferences';

describe('uiPreferences helpers', () => {
  it('fills missing process panel fields with defaults', () => {
    const normalized = normalizeUiPreferences({
      processPanel: {
        showLog: false
      },
      updatedAt: 123
    } as any);

    expect(normalized).toEqual({
      processPanel: {
        showStatus: true,
        showLog: false,
        showTool: true
      },
      updatedAt: 123
    });
  });

  it('filters tool events when the tool channel is disabled', () => {
    const process: MessageProcess = {
      provider: 'codex',
      state: 'running',
      events: [
        {
          type: 'status',
          label: 'Started',
          timestamp: 1
        },
        {
          type: 'tool_use',
          toolName: 'apply_patch',
          timestamp: 2
        },
        {
          type: 'tool_result',
          result: 'ok',
          timestamp: 3
        }
      ]
    };

    const filtered = filterProcessForDisplay(process, {
      showStatus: true,
      showLog: true,
      showTool: false
    });

    expect(filtered?.events).toEqual([
      {
        type: 'status',
        label: 'Started',
        timestamp: 1
      }
    ]);
  });

  it('hides the process panel when every event is filtered out', () => {
    const process: MessageProcess = {
      provider: 'claude',
      state: 'completed',
      events: [
        {
          type: 'tool_use',
          toolName: 'Read',
          timestamp: 1
        }
      ]
    };

    expect(filterProcessForDisplay(process, {
      showStatus: false,
      showLog: false,
      showTool: false
    })).toBeUndefined();
  });
});
