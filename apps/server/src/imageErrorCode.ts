export type ImageErrorCode = 'TOO_LARGE' | 'INVALID_TYPE' | 'TIMEOUT' | 'DISK_FULL' | 'PROTOCOL_ERROR';

export function getImageErrorCode(message: string): ImageErrorCode {
  const normalized = message.toLowerCase();

  if (
    normalized.includes('too large') ||
    normalized.includes('\u6587\u4ef6\u8fc7\u5927') ||
    normalized.includes('\u56fe\u7247\u8fc7\u5927')
  ) {
    return 'TOO_LARGE';
  }

  if (
    normalized.includes('unsupported file type') ||
    normalized.includes('declared mime type') ||
    normalized.includes('\u4e0d\u652f\u6301\u7684\u6587\u4ef6\u7c7b\u578b')
  ) {
    return 'INVALID_TYPE';
  }

  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return 'TIMEOUT';
  }

  if (
    normalized.includes('disk is full') ||
    normalized.includes('disk space') ||
    normalized.includes('no space left') ||
    normalized.includes('\u78c1\u76d8\u7a7a\u95f4')
  ) {
    return 'DISK_FULL';
  }

  return 'PROTOCOL_ERROR';
}
