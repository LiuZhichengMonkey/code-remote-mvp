import fs from 'fs';
import path from 'path';
import os from 'os';
import { ImageHandler } from './imageHandler';

describe('ImageHandler', () => {
  let imageHandler: ImageHandler;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-test-'));
    imageHandler = new ImageHandler({
      savePath: testDir,
      maxSize: 1024 * 1024,
      allowedTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      createDirectory: true
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('saves a PNG image', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const testData = Buffer.concat([pngHeader, Buffer.alloc(100)]);

    const meta = {
      fileName: 'test.png',
      mimeType: 'image/png',
      size: testData.length
    };

    const savedPath = await imageHandler.handleImage('client1', testData, meta);

    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toMatch(/\.png$/);
  });

  test('rejects files that exceed the size limit', async () => {
    const largeBuffer = Buffer.alloc(2 * 1024 * 1024);
    const meta = {
      fileName: 'large.png',
      mimeType: 'image/png',
      size: largeBuffer.length
    };

    await expect(
      imageHandler.handleImage('client1', largeBuffer, meta)
    ).rejects.toThrow('File too large');
  });

  test('rejects unsupported file types', async () => {
    const buffer = Buffer.from('test data');
    const meta = {
      fileName: 'test.bmp',
      mimeType: 'image/bmp',
      size: buffer.length
    };

    await expect(
      imageHandler.handleImage('client1', buffer, meta)
    ).rejects.toThrow('Unsupported file type');
  });

  test('generates unique file names', async () => {
    const name1 = imageHandler.generateFileName('test.png');
    await new Promise((resolve) => setTimeout(resolve, 2));
    const name2 = imageHandler.generateFileName('test.png');

    expect(name1).not.toBe(name2);
    expect(name1).toMatch(/^test_\d{8}_\d{9}\.png$/);
  });

  test('creates the save directory automatically', async () => {
    const newDir = path.join(testDir, 'subfolder', 'nested');
    const handler = new ImageHandler({
      savePath: newDir,
      maxSize: 1024 * 1024,
      allowedTypes: ['image/png'],
      createDirectory: true
    });

    const testData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const meta = { fileName: 'test.png', mimeType: 'image/png', size: testData.length };

    const savedPath = await handler.handleImage('client1', testData, meta);

    expect(fs.existsSync(savedPath)).toBe(true);
  });
});
