import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { useSettingsStore } from '../stores/settingsStore';
import { THEME_MODE_LABEL, type ThemeMode } from '../types/theme';
import { IconMonitor, IconMoon, IconSun } from '../components/ui/icons';
import { cn } from '../lib/cn';

const THEME_OPTIONS: { value: ThemeMode; icon: typeof IconSun; hint: string }[] = [
  { value: 'dark', icon: IconMoon, hint: 'Default. Low-glare for long sessions.' },
  { value: 'light', icon: IconSun, hint: 'Bright backgrounds.' },
  { value: 'system', icon: IconMonitor, hint: 'Follow the operating system.' },
];

export function SettingsRoute() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const compactDensity = useSettingsStore((state) => state.compactDensity);
  const setCompactDensity = useSettingsStore((state) => state.setCompactDensity);

  return (
    <PageShell title="Settings" description="Application preferences, stored locally.">
      <div className="flex flex-col gap-4">
        <Panel title="Appearance">
          <fieldset>
            <legend className="mb-2 text-caption font-medium text-text-secondary">Theme</legend>
            <div
              role="radiogroup"
              aria-label="Theme"
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = theme === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded border p-2.5',
                      'transition-colors duration-100',
                      selected
                        ? 'border-border-focus bg-surface-elevated'
                        : 'border-border-subtle hover:border-border-focus/60'
                    )}
                  >
                    <input
                      type="radio"
                      name="theme"
                      className="sr-only"
                      checked={selected}
                      onChange={() => setTheme(option.value)}
                    />
                    <Icon
                      size={15}
                      className={cn('mt-0.5', selected ? 'text-brand' : 'text-text-muted')}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-body font-medium text-text-primary">
                        {THEME_MODE_LABEL[option.value]}
                      </span>
                      <span className="text-caption text-text-muted">{option.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="mt-4 flex items-center gap-2 text-body text-text-secondary">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand"
              checked={compactDensity}
              onChange={(event) => setCompactDensity(event.target.checked)}
            />
            Compact information density
          </label>
          <p className="mt-1 text-caption text-text-muted">
            Reserved for later phases; stored with your preferences.
          </p>
        </Panel>

        <Panel title="Workspace">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-text-secondary">Local storage</dt>
              <dd className="text-body text-text-primary">Not configured (later phase)</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-text-secondary">AI provider</dt>
              <dd className="text-body text-text-primary">Not configured (later phase)</dd>
            </div>
          </dl>
          <p className="mt-3 text-caption text-text-muted">
            API keys will be stored in the OS keychain, never in files or the database.
          </p>
        </Panel>
      </div>
    </PageShell>
  );
}
