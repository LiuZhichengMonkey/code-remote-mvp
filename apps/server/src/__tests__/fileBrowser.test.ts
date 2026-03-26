import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSessionRecentFiles, resolveSessionReferencedFile } from '../fileBrowser';

describe('fileBrowser session references', () => {
  let tempRoot: string;
  let workspaceRoot: string;
  let externalRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-file-browser-'));
    workspaceRoot = path.join(tempRoot, 'workspace');
    externalRoot = path.join(tempRoot, 'external');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(externalRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('lists internal, external, and missing session-referenced files', () => {
    const workspaceFile = path.join(workspaceRoot, 'notes.md');
    const externalFile = path.join(externalRoot, 'photo.jpg');
    const missingExternalFile = path.join(externalRoot, 'missing.png');

    fs.writeFileSync(workspaceFile, '# notes\n', 'utf-8');
    fs.writeFileSync(externalFile, 'image', 'utf-8');

    const session = {
      messages: [
        {
          id: 'user-1',
          role: 'user' as const,
          content: `please review ./${path.relative(workspaceRoot, workspaceFile).replace(/\\/g, '/')}`,
          timestamp: 1000,
          images: [externalFile, missingExternalFile]
        },
        {
          id: 'assistant-1',
          role: 'assistant' as const,
          content: '',
          timestamp: 2000,
          process: {
            provider: 'codex' as const,
            state: 'completed' as const,
            events: [
              {
                type: 'tool_result' as const,
                toolUseId: 'tool-1',
                result: externalFile,
                timestamp: 3000
              }
            ]
          }
        }
      ]
    };

    const entries = listSessionRecentFiles(workspaceRoot, session);
    const byPath = new Map(entries.map(entry => [entry.relativePath, entry]));
    const externalPortablePath = externalFile.replace(/\\/g, '/');
    const missingPortablePath = missingExternalFile.replace(/\\/g, '/');

    expect(byPath.get('notes.md')).toEqual(expect.objectContaining({
      name: 'notes.md'
    }));
    expect(byPath.get('notes.md')?.available).toBeUndefined();
    expect(byPath.get(externalPortablePath)).toEqual(expect.objectContaining({
      name: 'photo.jpg',
      source: 'attachment',
    }));
    expect(byPath.get(externalPortablePath)?.available).toBeUndefined();
    expect(byPath.get(missingPortablePath)).toEqual(expect.objectContaining({
      name: 'missing.png',
      source: 'attachment',
      available: false
    }));

    expect(resolveSessionReferencedFile(workspaceRoot, session, externalPortablePath)).toEqual(
      expect.objectContaining({
        absolutePath: externalFile,
        entry: expect.objectContaining({
          relativePath: externalPortablePath
        })
      })
    );
    expect(resolveSessionReferencedFile(workspaceRoot, session, missingPortablePath)).toEqual(
      expect.objectContaining({
        absolutePath: missingExternalFile,
        entry: expect.objectContaining({
          relativePath: missingPortablePath,
          available: false
        })
      })
    );
  });

  test('parses markdown-style windows absolute paths with a leading slash', () => {
    const externalFile = path.join(externalRoot, 'chinese_model_seed45.png');
    fs.writeFileSync(externalFile, 'image', 'utf-8');

    const markdownPath = `/${externalFile.replace(/\\/g, '/')}`;
    const portablePath = externalFile.replace(/\\/g, '/');
    const session = {
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant' as const,
          content: `图片路径：\n[chinese_model_seed45.png](${markdownPath})`,
          timestamp: 4000
        }
      ]
    };

    const entries = listSessionRecentFiles(workspaceRoot, session);
    const entry = entries.find(candidate => candidate.relativePath === portablePath);

    expect(entry).toEqual(expect.objectContaining({
      name: 'chinese_model_seed45.png',
      relativePath: portablePath
    }));
    expect(entry?.available).toBeUndefined();

    expect(resolveSessionReferencedFile(workspaceRoot, session, portablePath)).toEqual(
      expect.objectContaining({
        absolutePath: externalFile,
        entry: expect.objectContaining({
          relativePath: portablePath
        })
      })
    );
    expect(resolveSessionReferencedFile(workspaceRoot, session, portablePath)?.entry.available).toBeUndefined();
  });
});
