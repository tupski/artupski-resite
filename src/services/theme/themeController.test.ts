import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyResolvedTheme, applyThemeMode, resolveTheme } from './themeController';

describe('resolveTheme', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns explicit modes unchanged', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('resolves system to dark when the OS prefers dark', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('resolves system to light when the OS prefers light', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyResolvedTheme', () => {
  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark');
  });

  it('sets the dark class on the document root', () => {
    applyResolvedTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('replaces the previous theme class when switching', () => {
    applyResolvedTheme('dark');
    applyResolvedTheme('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('applyThemeMode', () => {
  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark');
  });

  it('applies the mode and returns the resolved theme', () => {
    const resolved = applyThemeMode('dark');
    expect(resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
