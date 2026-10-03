import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CRAWLER_SETTINGS,
  SETTINGS_STORAGE_KEY,
  normalizeCrawlerSettings,
  useSettingsStore
} from './settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      theme: 'dark',
      compactDensity: false,
      crawler: { ...DEFAULT_CRAWLER_SETTINGS }
    });
    window.localStorage.clear();
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
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain('system');
  });
});

describe('settingsStore crawler defaults', () => {
  beforeEach(() => {
    useSettingsStore.setState({ crawler: { ...DEFAULT_CRAWLER_SETTINGS } });
    window.localStorage.clear();
  });

  it('exposes conservative, honest defaults', () => {
    expect(DEFAULT_CRAWLER_SETTINGS).toEqual({
      maxDepth: 2,
      maxPages: 25,
      headless: true,
      captureViewports: true,
      generateBlueprint: false
    });
  });

  it('merges a partial patch without disturbing untouched fields', () => {
    useSettingsStore.getState().setCrawlerSettings({ maxDepth: 4, generateBlueprint: true });
    const crawler = useSettingsStore.getState().crawler;
    expect(crawler.maxDepth).toBe(4);
    expect(crawler.generateBlueprint).toBe(true);
    expect(crawler.maxPages).toBe(DEFAULT_CRAWLER_SETTINGS.maxPages);
  });

  it('clamps out-of-range numeric values to the documented bounds', () => {
    useSettingsStore.getState().setCrawlerSettings({ maxDepth: 99 });
    expect(useSettingsStore.getState().crawler.maxDepth).toBe(5);

    useSettingsStore.getState().setCrawlerSettings({ maxDepth: 0 });
    expect(useSettingsStore.getState().crawler.maxDepth).toBe(1);

    useSettingsStore.getState().setCrawlerSettings({ maxPages: 9999 });
    expect(useSettingsStore.getState().crawler.maxPages).toBe(200);

    useSettingsStore.getState().setCrawlerSettings({ maxPages: -3 });
    expect(useSettingsStore.getState().crawler.maxPages).toBe(1);
  });

  it('floors fractional input rather than persisting a non-integer', () => {
    useSettingsStore.getState().setCrawlerSettings({ maxDepth: 3.9 });
    expect(useSettingsStore.getState().crawler.maxDepth).toBe(3);
  });

  it('normalizes a corrupt persisted blob back to safe values', () => {
    const normalized = normalizeCrawlerSettings({
      maxDepth: Number.NaN,
      maxPages: 100000,
      headless: 'yes' as unknown as boolean,
      captureViewports: true,
      generateBlueprint: false
    });
    expect(normalized.maxDepth).toBe(DEFAULT_CRAWLER_SETTINGS.maxDepth);
    expect(normalized.maxPages).toBe(200);
    expect(normalized.headless).toBe(DEFAULT_CRAWLER_SETTINGS.headless);
  });

  it('returns defaults for a missing/undefined persisted blob', () => {
    expect(normalizeCrawlerSettings(undefined)).toEqual(DEFAULT_CRAWLER_SETTINGS);
    expect(normalizeCrawlerSettings(null)).toEqual(DEFAULT_CRAWLER_SETTINGS);
  });

  it('persists crawler settings under the existing resite.settings key', () => {
    useSettingsStore.getState().setCrawlerSettings({ maxPages: 77, generateBlueprint: true });
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as {
      state: { crawler: { maxPages: number; generateBlueprint: boolean } };
    };
    expect(parsed.state.crawler.maxPages).toBe(77);
    expect(parsed.state.crawler.generateBlueprint).toBe(true);
  });
});
