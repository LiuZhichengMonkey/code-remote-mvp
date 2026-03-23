import { getImageErrorCode } from '../imageErrorCode';

describe('getImageErrorCode', () => {
  test('maps stable image-processing errors to protocol codes', () => {
    expect(getImageErrorCode('File too large (5 bytes). Max allowed is 4 bytes.')).toBe('TOO_LARGE');
    expect(getImageErrorCode('Unsupported file type: text/plain')).toBe('INVALID_TYPE');
    expect(getImageErrorCode('File content does not match the declared MIME type.')).toBe('INVALID_TYPE');
    expect(getImageErrorCode('Disk space is full. Free up space and try again.')).toBe('DISK_FULL');
    expect(getImageErrorCode('The request timed out.')).toBe('TIMEOUT');
    expect(getImageErrorCode('Unexpected binary payload')).toBe('PROTOCOL_ERROR');
  });
});
