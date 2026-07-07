import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION = 20;
const MAX_ZIP_FILES = 10_000;
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const ZIP_UINT32_MAX = 0xffffffff;

export interface PreparedZipEntry {
  absolutePath: string;
  archivePath: string;
  size: number;
  mtimeMs: number;
  crc32: number;
  isDirectory?: boolean;
}

export interface PreparedZipArchive {
  rootPath: string;
  entries: PreparedZipEntry[];
  totalBytes: number;
}

interface CentralDirectoryRecord {
  archivePath: string;
  size: number;
  mtimeMs: number;
  crc32: number;
  localHeaderOffset: number;
  isDirectory?: boolean;
}

const crc32Table = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function updateCrc32(current: number, chunk: Buffer): number {
  let crc = current;

  for (const byte of chunk) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return crc >>> 0;
}

async function calculateFileCrc32(filePath: string): Promise<number> {
  let crc = 0xffffffff;

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      crc = updateCrc32(crc, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(mtimeMs: number): { date: number; time: number } {
  const date = new Date(mtimeMs || Date.now());
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds
  };
}

function writeLocalFileHeader(entry: PreparedZipEntry): Buffer {
  const name = Buffer.from(entry.archivePath, 'utf-8');
  const { date, time } = getDosDateTime(entry.mtimeMs);
  const header = Buffer.alloc(30 + name.length);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(ZIP_STORE_METHOD, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);

  return header;
}

function writeCentralDirectoryHeader(record: CentralDirectoryRecord): Buffer {
  const name = Buffer.from(record.archivePath, 'utf-8');
  const { date, time } = getDosDateTime(record.mtimeMs);
  const header = Buffer.alloc(46 + name.length);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  header.writeUInt16LE(ZIP_STORE_METHOD, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(record.crc32, 16);
  header.writeUInt32LE(record.size, 20);
  header.writeUInt32LE(record.size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(record.isDirectory ? 0x10 : 0, 38);
  header.writeUInt32LE(record.localHeaderOffset, 42);
  name.copy(header, 46);

  return header;
}

function writeEndOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const footer = Buffer.alloc(22);

  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralSize, 12);
  footer.writeUInt32LE(centralOffset, 16);
  footer.writeUInt16LE(0, 20);

  return footer;
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (
    !relativePath.startsWith('..')
    && !path.isAbsolute(relativePath)
  );
}

function toArchivePath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replace(/\\/g, '/');
}

async function writeChunk(output: Writable, chunk: Buffer): Promise<void> {
  if (output.write(chunk)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      output.off('drain', onDrain);
      output.off('error', onError);
    };

    output.once('drain', onDrain);
    output.once('error', onError);
  });
}

async function writeFileContent(output: Writable, filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.on('data', chunk => {
      if (!output.write(chunk)) {
        stream.pause();
        output.once('drain', () => stream.resume());
      }
    });
  });
}

export async function prepareDirectoryZipArchive(directoryPath: string): Promise<PreparedZipArchive> {
  const rootPath = fs.realpathSync(directoryPath);
  const rootStats = fs.statSync(rootPath);
  if (!rootStats.isDirectory()) {
    throw new Error('NOT_A_DIRECTORY');
  }

  const pendingDirectories = [rootPath];
  const pendingEntries: Array<{ absolutePath: string; isDirectory?: boolean }> = [];
  let totalBytes = 0;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(currentDirectory, entry.name);
      const realPath = fs.realpathSync(absolutePath);
      if (!isInsideRoot(rootPath, realPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        pendingEntries.push({ absolutePath: realPath, isDirectory: true });
        pendingDirectories.push(realPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = fs.statSync(realPath);
      if (stats.size > ZIP_UINT32_MAX) {
        throw new Error('ZIP_FILE_TOO_LARGE');
      }

      pendingEntries.push({ absolutePath: realPath });
      totalBytes += stats.size;

      if (pendingEntries.length > MAX_ZIP_FILES) {
        throw new Error('ZIP_TOO_MANY_FILES');
      }

      if (totalBytes > MAX_ZIP_BYTES) {
        throw new Error('ZIP_TOO_LARGE');
      }
    }
  }

  const entries = await Promise.all(
    pendingEntries
      .sort((a, b) => toArchivePath(rootPath, a.absolutePath).localeCompare(toArchivePath(rootPath, b.absolutePath), undefined, {
        numeric: true,
        sensitivity: 'base'
      }))
      .map(async ({ absolutePath, isDirectory }) => {
        const stats = fs.statSync(absolutePath);
        const archivePath = toArchivePath(rootPath, absolutePath);
        return {
          absolutePath,
          archivePath: isDirectory ? `${archivePath.replace(/\/+$/, '')}/` : archivePath,
          size: isDirectory ? 0 : stats.size,
          mtimeMs: stats.mtimeMs,
          crc32: isDirectory ? 0 : await calculateFileCrc32(absolutePath),
          ...(isDirectory ? { isDirectory: true } : {})
        };
      })
  );

  return {
    rootPath,
    entries,
    totalBytes
  };
}

export async function streamZipArchive(archive: PreparedZipArchive, output: Writable): Promise<void> {
  const centralDirectory: CentralDirectoryRecord[] = [];
  let offset = 0;

  for (const entry of archive.entries) {
    if (offset > ZIP_UINT32_MAX) {
      throw new Error('ZIP_TOO_LARGE');
    }

    const header = writeLocalFileHeader(entry);
    await writeChunk(output, header);
    const localHeaderOffset = offset;
    offset += header.length;

    if (!entry.isDirectory) {
      await writeFileContent(output, entry.absolutePath);
      offset += entry.size;
    }

    centralDirectory.push({
      archivePath: entry.archivePath,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      crc32: entry.crc32,
      localHeaderOffset,
      ...(entry.isDirectory ? { isDirectory: true } : {})
    });
  }

  const centralOffset = offset;
  let centralSize = 0;

  for (const record of centralDirectory) {
    const header = writeCentralDirectoryHeader(record);
    await writeChunk(output, header);
    offset += header.length;
    centralSize += header.length;
  }

  await writeChunk(output, writeEndOfCentralDirectory(centralDirectory.length, centralSize, centralOffset));
  output.end();
}

export function getZipDownloadFileName(directoryPath: string, fallback = 'download'): string {
  const baseName = path.basename(directoryPath) || fallback;
  return baseName.toLowerCase().endsWith('.zip') ? baseName : `${baseName}.zip`;
}
