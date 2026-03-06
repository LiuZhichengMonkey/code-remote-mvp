export interface ImageMeta {
  fileName: string;
  mimeType: string;
  size: number;
  timestamp?: number;
}

export interface ImageConfig {
  savePath: string;
  maxSize: number;
  allowedTypes: string[];
  createDirectory: boolean;
}

export interface ImageTransferState {
  inProgress: boolean;
  meta: ImageMeta | null;
  startTime: number;
}

export interface ImageSuccessResponse {
  type: 'image_saved';
  path: string;
  timestamp: number;
}

export interface ImageErrorResponse {
  type: 'image_error';
  error: string;
  code: 'TOO_LARGE' | 'INVALID_TYPE' | 'TIMEOUT' | 'DISK_FULL' | 'PROTOCOL_ERROR';
  timestamp: number;
}
