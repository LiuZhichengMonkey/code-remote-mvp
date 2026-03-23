import fs from 'fs';
import path from 'path';
import { ImageMeta, ImageConfig } from './types/image';

export class ImageHandler {
  private savePath: string;
  private maxSize: number;
  private allowedTypes: string[];

  constructor(config: ImageConfig) {
    this.savePath = config.savePath;
    this.maxSize = config.maxSize;
    this.allowedTypes = config.allowedTypes;

    if (config.createDirectory && !fs.existsSync(this.savePath)) {
      fs.mkdirSync(this.savePath, { recursive: true });
    }
  }

  async handleImage(_clientId: string, buffer: Buffer, meta: ImageMeta): Promise<string> {
    if (meta.size > this.maxSize) {
      throw new Error(`File too large (${meta.size} bytes). Max allowed is ${this.maxSize} bytes.`);
    }

    if (this.allowedTypes.length > 0 && !this.allowedTypes.includes('*')) {
      const isAllowed = this.allowedTypes.some((allowed) => {
        if (allowed === '*') {
          return true;
        }

        if (allowed.endsWith('/*')) {
          const category = allowed.slice(0, -2);
          return meta.mimeType.startsWith(`${category}/`);
        }

        return allowed === meta.mimeType;
      });

      if (!isAllowed) {
        throw new Error(`Unsupported file type: ${meta.mimeType}`);
      }
    }

    const fileName = this.generateFileName(meta.fileName);
    const filePath = path.join(this.savePath, fileName);

    try {
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (error: any) {
      if (error.code === 'ENOSPC') {
        throw new Error('Disk space is full. Free up space and try again.');
      }

      throw error;
    }
  }

  async loadImage(filePath: string): Promise<{ buffer: Buffer; meta: ImageMeta }> {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };

    return {
      buffer,
      meta: {
        fileName: path.basename(filePath),
        mimeType: mimeMap[ext] || 'image/png',
        size: buffer.length
      }
    };
  }

  generateFileName(originalName: string): string {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const timestamp = this.getTimestamp();
    return `${baseName}_${timestamp}${ext}`;
  }

  private validateImageHeader(buffer: Buffer, mimeType: string): void {
    const signatures: Record<string, number[]> = {
      'image/png': [0x89, 0x50, 0x4e, 0x47],
      'image/jpeg': [0xff, 0xd8, 0xff],
      'image/gif': [0x47, 0x49, 0x46, 0x38],
      'image/webp': [0x52, 0x49, 0x46, 0x46]
    };

    const expected = signatures[mimeType];
    if (!expected) {
      return;
    }

    for (let i = 0; i < expected.length; i += 1) {
      if (buffer[i] !== expected[i]) {
        throw new Error('File content does not match the declared MIME type.');
      }
    }
  }

  private getTimestamp(): string {
    const now = new Date();
    const date = now.getFullYear().toString()
      + (now.getMonth() + 1).toString().padStart(2, '0')
      + now.getDate().toString().padStart(2, '0');
    const time = now.getHours().toString().padStart(2, '0')
      + now.getMinutes().toString().padStart(2, '0')
      + now.getSeconds().toString().padStart(2, '0')
      + now.getMilliseconds().toString().padStart(3, '0');
    return `${date}_${time}`;
  }
}
