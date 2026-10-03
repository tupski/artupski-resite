/**
 * Settings store - Artupski ReSite
 *
 * Persisted application preferences. Kept separate from UI and scan state so
 * that later phases can add provider/paths settings without touching those.
 *
 * Phase 15 adds persisted crawler defaults (`CrawlerSettings`). The Scan screen
 * seeds its initial configuration from these values, but the values are
 * defensively re-clamped on every write so a corrupt persisted blob or an
 * out-of-range caller can never raise a crawler limit beyond what the worker is
 * designed to sustain. Concurrency is deliberately absent: the browser worker
 * fixes it at 1 (see `crawlLimits.ts`), so there is no dead dial here.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME_MODE, type ThemeMode } from '../types/theme';

export const SETTINGS_STORAGE_KEY = 'resite.settings';

/** Inclusive bounds for the persisted crawler defaults (UI-SPEC/SCANNER-SPEC). */
export const CRAWLER_DEPTH_MIN = 1;
export const CRAWLER_DEPTH_MAX = 5;
export const CRAWLER_PAGES_MIN = 1;
export const CRAWLER_PAGES_MAX = 200;

/** Persisted crawler defaults seeded into the Scan screen. */
export interface CrawlerSettings {
  /** Maximum link distance from the seed (clamped 1..5). */
  maxDepth: number;
  /** Hard upper bound on crawled pages (clamped 1..200). */
  maxPages: number;
  /** Run the browser session without a visible window. */
  headless: boolean;
  /** Capture responsive viewport screenshots after a completed crawl. */
  captureViewports: boolean;
  /** Capture bounded Blueprint evidence + synthesize the document after a crawl. */
  generateBlueprint: boolean;
}

/** Conservative defaults; identical to the historic Scan-screen defaults. */
export const DEFAULT_CRAWLER_SETTINGS: CrawlerSettings = {
  maxDepth: 2,
  maxPages: 25,
  headless: true,
  captureViewports: true,
  generateBlueprint: false
};

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Coerce an untrusted (possibly persisted) crawler blob into valid, in-range
 * values. Non-numeric/NaN numbers fall back to the default; out-of-range
 * numbers are clamped to the nearest bound; non-boolean flags fall back to the
 * default. Never throws.
 */
export function normalizeCrawlerSettings(
  input: Partial<CrawlerSettings> | null | undefined
): CrawlerSettings {
  const base = DEFAULT_CRAWLER_SETTINGS;
  const source = input ?? {};
  return {
    maxDepth: clampInt(
      typeof source.maxDepth === 'number' ? source.maxDepth : Number.NaN,
      CRAWLER_DEPTH_MIN,
      CRAWLER_DEPTH_MAX,
      base.maxDepth
    ),
    maxPages: clampInt(
      typeof source.maxPages === 'number' ? source.maxPages : Number.NaN,
      CRAWLER_PAGES_MIN,
      CRAWLER_PAGES_MAX,
      base.maxPages
    ),
    headless: typeof source.headless === 'boolean' ? source.headless : base.headless,
    captureViewports:
      typeof source.captureViewports === 'boolean'
        ? source.captureViewports
        : base.captureViewports,
    generateBlueprint:
      typeof source.generateBlueprint === 'boolean'
        ? source.generateBlueprint
        : base.generateBlueprint
  };
}

export interface SettingsState {
  theme: ThemeMode;
  /** Reduced output density for readability. */
  compactDensity: boolean;
  /** Persisted crawler defaults that seed the Scan screen. */
  crawler: CrawlerSettings;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setCompactDensity: (compact: boolean) => void;
  /** Merge a partial crawler patch, clamping/validating every numeric field. */
  setCrawlerSettings: (partial: Partial<CrawlerSettings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME_MODE,
      compactDensity: false,
      crawler: DEFAULT_CRAWLER_SETTINGS,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setCompactDensity: (compactDensity) => set({ compactDensity }),
      setCrawlerSettings: (partial) =>
        set((state) => ({
          crawler: normalizeCrawlerSettings({ ...state.crawler, ...partial })
        }))
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      partialize: (state) => ({
        theme: state.theme,
        compactDensity: state.compactDensity,
        crawler: state.crawler
      }),
      /**
       * Sanitize a persisted blob before it reaches the store so a corrupt
       * `crawler` value (or an old payload without it) cannot seed an invalid
       * Scan configuration. Functions always come from the live state.
       */
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...(saved.theme ? { theme: saved.theme } : {}),
          ...(typeof saved.compactDensity === 'boolean'
            ? { compactDensity: saved.compactDensity }
            : {}),
          crawler: normalizeCrawlerSettings(saved.crawler)
        };
      }
    }
  )
);
