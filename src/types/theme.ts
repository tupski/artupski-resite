/**
 * Theme types - Artupski ReSite
 * UI-SPEC section 3.1 defines dark as the default theme.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};
