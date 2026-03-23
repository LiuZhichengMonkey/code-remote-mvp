export const debugLog = (...args: unknown[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (window.localStorage.getItem('coderemote_debug') === '1') {
      console.log(...args);
    }
  } catch {
    // Ignore storage access errors.
  }
};
