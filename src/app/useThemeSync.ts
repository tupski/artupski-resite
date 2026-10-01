/**
 * React binding for the theme controller.
 *
 * Keeps the DOM `<html>` class in sync with the persisted settings store and
 * reacts to OS preference changes when the mode is `system`.
 */
import { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import {
  applyThemeMode,
  resolveTheme,
  subscribeToSystemTheme,
} from '../services/theme/themeController';
import type { ResolvedTheme } from '../types/theme';

export function useThemeSync(): ResolvedTheme {
  const theme = useSettingsStore((state) => state.theme);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme));

  useEffect(() => {
    setResolved(applyThemeMode(theme));
  }, [theme]);

  useEffect(
    () => subscribeToSystemTheme(() => useSettingsStore.getState().theme, setResolved),
    []
  );

  return resolved;
}
