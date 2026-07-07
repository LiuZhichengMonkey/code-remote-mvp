const IMAGE_PREVIEWABLE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const LOCAL_RESOURCE_EXTENSIONS = new Set([
  ...IMAGE_PREVIEWABLE_EXTENSIONS,
  'pdf',
  'txt',
  'md',
  'json',
  'csv',
  'zip',
  'log'
]);

const WINDOWS_DRIVE_LINK_PATTERN = /^\/?[A-Za-z]:[\\/]/;
const FILE_URI_LINK_PATTERN = /^file:\/\/\/?/i;
const LOCAL_FILE_PREFIX_PATTERN = /^(?:\.{1,2}[\\/]|~[\\/]|\/(?!\/))/;
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export const normalizeLocalResourcePath = (value: string): string => {
  if (!value) {
    return '';
  }

  let normalized = value.trim();
  if (!normalized) {
    return '';
  }

  if (FILE_URI_LINK_PATTERN.test(normalized)) {
    try {
      normalized = decodeURIComponent(new URL(normalized).pathname);
    } catch {
      normalized = normalized.replace(/^file:\/+/i, '/');
    }
  } else {
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep the original string when the link is not URI-encoded.
    }
  }

  normalized = normalized.replace(/\\/g, '/');
  return normalized.replace(/^\/(?=[A-Za-z]:\/)/, '');
};

export const isPreviewableImagePath = (value: string): boolean => {
  const normalized = normalizeLocalResourcePath(value);
  const sanitized = normalized.split(/[?#]/, 1)[0] || normalized;
  const extensionIndex = sanitized.lastIndexOf('.');

  if (extensionIndex === -1) {
    return false;
  }

  return IMAGE_PREVIEWABLE_EXTENSIONS.has(sanitized.slice(extensionIndex + 1).toLowerCase());
};

export const isBrowserExternalLink = (href: string): boolean => {
  const trimmed = href.trim();
  return /^(?:https?:)?\/\//i.test(trimmed) || /^(?:mailto|tel):/i.test(trimmed);
};

export const hasRecognizedLocalResourceExtension = (value: string): boolean => {
  const normalized = normalizeLocalResourcePath(value);
  const sanitized = normalized.split(/[?#]/, 1)[0] || normalized;
  const extensionIndex = sanitized.lastIndexOf('.');

  if (extensionIndex === -1) {
    return false;
  }

  return LOCAL_RESOURCE_EXTENSIONS.has(sanitized.slice(extensionIndex + 1).toLowerCase());
};

export const isBareFileName = (value: string): boolean => {
  const normalized = normalizeLocalResourcePath(value);
  if (!normalized) {
    return false;
  }

  if (/[\\/]/.test(normalized) || /^[A-Za-z]:/.test(normalized) || FILE_URI_LINK_PATTERN.test(normalized)) {
    return false;
  }

  if (URI_SCHEME_PATTERN.test(normalized)) {
    return false;
  }

  return hasRecognizedLocalResourceExtension(normalized);
};

export const isLikelyLocalResourceLink = (href: string): boolean => {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return false;
  }

  if (FILE_URI_LINK_PATTERN.test(trimmed) || WINDOWS_DRIVE_LINK_PATTERN.test(trimmed)) {
    return true;
  }

  if (trimmed.startsWith('//')) {
    return false;
  }

  if (URI_SCHEME_PATTERN.test(trimmed)) {
    return false;
  }

  if (LOCAL_FILE_PREFIX_PATTERN.test(trimmed)) {
    return true;
  }

  return true;
};

export const isPlainTextLocalResourceCandidate = (value: string): boolean => {
  const normalized = normalizeLocalResourcePath(value);
  if (!normalized || normalized.startsWith('#')) {
    return false;
  }

  if (isBrowserExternalLink(normalized)) {
    return false;
  }

  if (isBareFileName(normalized)) {
    return true;
  }

  return hasRecognizedLocalResourceExtension(normalized) && (
    FILE_URI_LINK_PATTERN.test(normalized)
    || WINDOWS_DRIVE_LINK_PATTERN.test(normalized)
    || LOCAL_FILE_PREFIX_PATTERN.test(normalized)
  );
};

export const getPathDisplayName = (value: string, fallback = 'file'): string => {
  if (!value) {
    return fallback;
  }

  const normalized = normalizeLocalResourcePath(value)
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || fallback;
};
