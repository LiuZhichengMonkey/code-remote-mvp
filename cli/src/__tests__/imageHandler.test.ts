import fs from 'fs';
import os from 'os';
import path from 'path';
import { ImageHandler } from '../imageHandler';

describe('ImageHandler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-image-handler-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('rejects files that exceed the configured max size with a stable message', async () => {
    const handler = new ImageHandler({
      savePath: tempDir,
      maxSize: 4,
      allowedTypes: ['image/png'],
      createDirectory: true
    });

    await expect(handler.handleImage('client-1', Buffer.from('12345'), {
      fileName: 'large.png',
      mimeType: 'image/png',
      size: 5,
      timestamp: Date.now()
    })).rejects.toThrow('File too large (5 bytes). Max allowed is 4 bytes.');
  });

  test('rejects unsupported MIME types with a stable message', async () => {
    const handler = new ImageHandler({
      savePath: tempDir,
      maxSize: 1024,
      allowedTypes: ['image/png'],
      createDirectory: true
    });

    await expect(handler.handleImage('client-1', Buffer.from('abc'), {
      fileName: 'note.txt',
      mimeType: 'text/plain',
      size: 3,
      timestamp: Date.now()
    })).rejects.toThrow('Unsupported file type: text/plain');
  });

  test('translates ENOSPC write failures into a stable disk-full message', async () => {
    const handler = new ImageHandler({
      savePath: tempDir,
      maxSize: 1024,
      allowedTypes: ['*'],
      createDirectory: true
    });

    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      const error = new Error('disk full') as NodeJS.ErrnoException;
      error.code = 'ENOSPC';
      throw error;
    });

    await expect(handler.handleImage('client-1', Buffer.from('abc'), {
      fileName: 'image.png',
      mimeType: 'image/png',
      size: 3,
      timestamp: Date.now()
    })).rejects.toThrow('Disk space is full. Free up space and try again.');
  });
});
