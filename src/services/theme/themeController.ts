/**
 * Theme controller - Artupski ReSite
 *
 * Applies the documented theme tokens (UI-SPEC section 3.1) to the document
 * root. Dark is the default. `system` resolves against `prefers-color-scheme`.
 */
import { eventBus, createEvent } from '../infra/eventBus';
import type { ResolvedTheme, ThemeMode } from '../../types/theme';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
    }
    return 'dark';
  }
  return mode;
}

/** Apply a resolved theme by toggling the `.light` / `.dark` class on <html>. */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

/** Apply a theme mode and emit the documented `app.theme_changed` event. */
export function applyThemeMode(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  applyResolvedTheme(resolved);
  eventBus.emit(
    createEvent('app.theme_changed', {
      theme: mode,
      resolved,
    })
  );
  return resolved;
}

/**
 * Subscribe to OS theme changes. Only invokes the callback when `mode` is
 * `system`, so an explicit theme choice is never overridden.
 */
export function subscribeToSystemTheme(
  getMode: () => ThemeMode,
  onChange: (resolved: ResolvedTheme) => void
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia(LIGHT_QUERY);
  const handler = (event: MediaQueryListEvent) => {
    if (getMode() === 'system') {
      const resolved: ResolvedTheme = event.matches ? 'light' : 'dark';
      applyResolvedTheme(resolved);
      onChange(resolved);
    }
  };
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}
