import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import {
  getZipDownloadFileName,
  prepareDirectoryZipArchive,
  streamZipArchive
} from '../zipArchive';

async function collectStream(stream: PassThrough): Promise<Buffer> {
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    stream.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  return Buffer.concat(chunks);
}

describe('zipArchive', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-zip-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('streams a valid zip archive for nested folder contents', async () => {
    const folder = path.join(tempRoot, 'downloads');
    const nested = path.join(folder, 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(folder, 'hello.txt'), 'hello', 'utf-8');
    fs.writeFileSync(path.join(nested, '图片.txt'), 'image note', 'utf-8');

    const archive = await prepareDirectoryZipArchive(folder);
    expect(archive.entries.map(entry => entry.archivePath)).toEqual([
      'hello.txt',
      'nested/',
      'nested/图片.txt'
    ]);
    expect(archive.totalBytes).toBe(15);

    const output = new PassThrough();
    const collected = collectStream(output);
    await streamZipArchive(archive, output);
    const buffer = await collected;

    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);
    expect(buffer.includes(Buffer.from('hello.txt'))).toBe(true);
    expect(buffer.includes(Buffer.from('nested/'))).toBe(true);
    expect(buffer.includes(Buffer.from('nested/图片.txt'))).toBe(true);
    expect(buffer.readUInt32LE(buffer.length - 22)).toBe(0x06054b50);
  });

  test('creates a valid empty zip archive for empty folders', async () => {
    const folder = path.join(tempRoot, 'empty');
    fs.mkdirSync(folder, { recursive: true });

    const archive = await prepareDirectoryZipArchive(folder);
    expect(archive.entries).toEqual([]);

    const output = new PassThrough();
    const collected = collectStream(output);
    await streamZipArchive(archive, output);
    const buffer = await collected;

    expect(buffer.length).toBe(22);
    expect(buffer.readUInt32LE(0)).toBe(0x06054b50);
  });

  test('uses a zip extension for folder download names', () => {
    expect(getZipDownloadFileName(path.join(tempRoot, 'reports'))).toBe('reports.zip');
    expect(getZipDownloadFileName(path.join(tempRoot, 'archive.zip'))).toBe('archive.zip');
  });
});
