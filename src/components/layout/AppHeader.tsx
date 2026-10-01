import { useEffect, useState } from 'react';
import { isTauriRuntime, runtimeInfo } from '../../services/ipc';
import { StatusIndicator } from '../ui/StatusIndicator';
import { useSettingsStore } from '../../stores/settingsStore';
import { THEME_MODE_LABEL, type ThemeMode } from '../../types/theme';
import { IconMoon, IconMonitor, IconSun } from '../ui/icons';
import { cn } from '../../lib/cn';

const THEME_ORDER: ThemeMode[] = ['dark', 'light', 'system'];

const THEME_ICON: Record<ThemeMode, typeof IconSun> = {
  dark: IconMoon,
  light: IconSun,
  system: IconMonitor,
};

/**
 * Window header: product identity, a compact environment status, and the
 * theme control. Kept thin to preserve vertical space for the workspace.
 */
export function AppHeader({ title, description }: { title: string; description?: string }) {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const [runtime, setRuntime] = useState<string>('browser');

  useEffect(() => {
    if (!isTauriRuntime()) {
      setRuntime('browser preview');
      return;
    }
    let cancelled = false;
    void runtimeInfo().then((result) => {
      if (cancelled) return;
      setRuntime(result.ok ? `${result.data.platform} · ${result.data.arch}` : 'native');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ThemeIcon = THEME_ICON[theme];
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'dark';

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-base px-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-heading text-text-primary">{title}</h1>
        {description ? (
          <p className="hidden truncate text-caption text-text-muted md:block">{description}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <StatusIndicator
          tone="idle"
          label={runtime}
          className={cn('hidden sm:inline-flex')}
        />
        <button
          type="button"
          onClick={() => setTheme(nextTheme)}
          title={`Theme: ${THEME_MODE_LABEL[theme]} — switch to ${THEME_MODE_LABEL[nextTheme]}`}
          aria-label={`Switch theme, currently ${THEME_MODE_LABEL[theme]}`}
          className="flex h-7 items-center gap-1.5 rounded border border-border-subtle px-2 text-caption text-text-secondary hover:border-border-focus hover:text-text-primary"
        >
          <ThemeIcon size={14} />
          <span>{THEME_MODE_LABEL[theme]}</span>
        </button>
      </div>
    </header>
  );
}
