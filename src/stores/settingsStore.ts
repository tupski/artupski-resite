/**
 * Settings store - Artupski ReSite
 *
 * Persisted application preferences. Kept separate from UI and scan state so
 * that later phases can add provider/paths settings without touching those.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME_MODE, type ThemeMode } from '../types/theme';

export const SETTINGS_STORAGE_KEY = 'resite.settings';

export interface SettingsState {
  theme: ThemeMode;
  /** Reduced output density for readability. */
  compactDensity: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setCompactDensity: (compact: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME_MODE,
      compactDensity: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setCompactDensity: (compactDensity) => set({ compactDensity }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      partialize: (state) => ({
        theme: state.theme,
        compactDensity: state.compactDensity,
      }),
    }
  )
);
