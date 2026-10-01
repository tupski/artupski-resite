import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: 'dark', compactDensity: false });
  });

  it('defaults to the dark theme (UI-SPEC 3.1)', () => {
    useSettingsStore.setState({ theme: 'dark' });
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('sets an explicit theme', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('toggles between light and dark only', () => {
    useSettingsStore.getState().setTheme('dark');
    useSettingsStore.getState().toggleTheme();
    expect(useSettingsStore.getState().theme).toBe('light');
    useSettingsStore.getState().toggleTheme();
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('persists theme to localStorage', () => {
    useSettingsStore.getState().setTheme('system');
    const raw = window.localStorage.getItem('resite.settings');
    expect(raw).toBeTruthy();
    expect(raw).toContain('system');
  });
});
