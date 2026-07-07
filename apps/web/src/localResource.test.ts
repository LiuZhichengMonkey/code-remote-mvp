import { describe, expect, it } from 'vitest';
import {
  getPathDisplayName,
  isBareFileName,
  isBrowserExternalLink,
  isLikelyLocalResourceLink,
  isPlainTextLocalResourceCandidate,
  isPreviewableImagePath,
  normalizeLocalResourcePath
} from './localResource';

describe('localResource helpers', () => {
  it('normalizes windows paths from markdown links and file URIs', () => {
    expect(normalizeLocalResourcePath('/E:/flux2_test/output_local/chinese_model_seed45.png'))
      .toBe('E:/flux2_test/output_local/chinese_model_seed45.png');
    expect(normalizeLocalResourcePath('E:\\flux2_test\\output_local\\chinese_model_seed45.png'))
      .toBe('E:/flux2_test/output_local/chinese_model_seed45.png');
    expect(normalizeLocalResourcePath('file:///E:/flux2_test/output_local/chinese_model_seed45.png'))
      .toBe('E:/flux2_test/output_local/chinese_model_seed45.png');
  });

  it('detects previewable image paths with query strings', () => {
    expect(isPreviewableImagePath('/E:/images/sample.PNG?version=1')).toBe(true);
    expect(isPreviewableImagePath('./reports/output.pdf')).toBe(false);
  });

  it('classifies browser-external links separately from local resources', () => {
    expect(isBrowserExternalLink('https://example.com/image.png')).toBe(true);
    expect(isLikelyLocalResourceLink('https://example.com/image.png')).toBe(false);
    expect(isLikelyLocalResourceLink('/E:/flux2_test/output_local/chinese_model_seed45.png')).toBe(true);
    expect(isLikelyLocalResourceLink('./output_local/chinese_model_seed45.png')).toBe(true);
  });

  it('detects plain text local resource candidates including bare filenames', () => {
    expect(isBareFileName('chinese_model_seed45.png')).toBe(true);
    expect(isPlainTextLocalResourceCandidate('chinese_model_seed45.png')).toBe(true);
    expect(isPlainTextLocalResourceCandidate('E:/flux2_test/output_local/chinese_model_seed45.png')).toBe(true);
    expect(isPlainTextLocalResourceCandidate('continue')).toBe(false);
  });

  it('derives a display name from normalized paths', () => {
    expect(getPathDisplayName('file:///E:/flux2_test/output_local/chinese_model_seed45.png', 'fallback'))
      .toBe('chinese_model_seed45.png');
  });
});
