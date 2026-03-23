import { describe, expect, it } from 'vitest';
import { resolveInitialLanguage, translate, translateKnownLocalText } from './i18n';

describe('i18n helpers', () => {
  it('prefers a stored language when it is valid', () => {
    expect(resolveInitialLanguage('en-US', 'zh-CN')).toBe('en-US');
    expect(resolveInitialLanguage('zh-CN', 'en-US')).toBe('zh-CN');
  });

  it('falls back to browser language when no stored language is available', () => {
    expect(resolveInitialLanguage(null, 'zh-CN')).toBe('zh-CN');
    expect(resolveInitialLanguage(null, 'en-US')).toBe('en-US');
    expect(resolveInitialLanguage(null, 'zh-TW')).toBe('zh-CN');
  });

  it('translates parameterized messages', () => {
    expect(
      translate('zh-CN', 'settings.runtime.loadingProfiles', { provider: 'Codex' })
    ).toBe('正在加载 Codex 配置...');
    expect(
      translate('en-US', 'messages.loadEarlier', { count: 12 })
    ).toBe('Load earlier messages (12 more)');
  });

  it('localizes known local placeholder text without touching arbitrary model output', () => {
    expect(
      translateKnownLocalText(
        'Codex is still running. Restoring live progress after refresh...',
        'zh-CN'
      )
    ).toBe('Codex 仍在运行中。刷新后正在恢复实时进度...');

    expect(translateKnownLocalText('A custom model answer', 'zh-CN')).toBe('A custom model answer');
  });
});
