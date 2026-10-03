import { useEffect } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { AiProviderPanel } from '../components/settings/AiProviderPanel';
import { CrawlerSettingsPanel } from '../components/settings/CrawlerSettingsPanel';
import { SecuritySettingsPanel } from '../components/settings/SecuritySettingsPanel';
import { useSettingsStore } from '../stores/settingsStore';
import { useAiStore } from '../stores/aiStore';
import { getPreset } from '../services/ai';
import { notifyStructuredError } from '../components/common/errorBridge';
import type { ErrorCode } from '../services/infra/errors';
import { storageService } from '../services/storage';
import { THEME_MODE_LABEL, type ThemeMode } from '../types/theme';
import { IconMonitor, IconMoon, IconSun } from '../components/ui/icons';
import { cn } from '../lib/cn';

const THEME_OPTIONS: { value: ThemeMode; icon: typeof IconSun; hint: string }[] = [
  { value: 'dark', icon: IconMoon, hint: 'Default. Low-glare for long sessions.' },
  { value: 'light', icon: IconSun, hint: 'Bright backgrounds.' },
  { value: 'system', icon: IconMonitor, hint: 'Follow the operating system.' }
];

export function SettingsRoute() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const compactDensity = useSettingsStore((state) => state.compactDensity);
  const setCompactDensity = useSettingsStore((state) => state.setCompactDensity);

  const aiStatus = useAiStore((state) => state.status);
  const aiConfig = useAiStore((state) => state.config);
  const apiKeyInput = useAiStore((state) => state.apiKeyInput);
  const hasStoredKey = useAiStore((state) => state.hasStoredKey);
  const models = useAiStore((state) => state.models);
  const aiError = useAiStore((state) => state.error);
  const aiLoading = useAiStore((state) => state.loading);
  const lastVerifiedAt = useAiStore((state) => state.lastVerifiedAt);

  useEffect(() => {
    void useAiStore.getState().loadConfig();
  }, []);

  const handleSelectPreset = (presetId: string) => {
    const store = useAiStore.getState();
    const preset = presetId === 'custom' ? null : getPreset(presetId);
    store.setConfigField('providerId', presetId);
    if (preset && preset.baseUrl) {
      store.setConfigField('baseUrl', preset.baseUrl);
    }
    if (preset && preset.defaultModel) {
      store.setConfigField('model', preset.defaultModel);
    }
  };

  // Save failures already render inline; also surface them as an actionable
  // toast so a rejected configuration (e.g. an invalid base URL) is never a
  // silent failure. The inline error remains the primary affordance.
  const handleSaveAi = async () => {
    const ok = await useAiStore.getState().saveConfig();
    if (!ok) {
      const error = useAiStore.getState().error;
      if (error) {
        notifyStructuredError({
          code: error.code as ErrorCode,
          category: 'ai',
          message: error.message,
          severity: 'error',
          recoverable: true,
          retryable: false,
          suggestedAction: error.suggestedAction,
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  const workspaceLocation = storageService.getDatabaseLocation();

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

        <Panel title="AI provider">
          <p className="mb-3 max-w-lg text-caption text-text-muted">
            Connect any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, LM Studio, or a
            custom gateway). The connection badge reflects only a verified health check.
          </p>
          <AiProviderPanel
            status={aiStatus}
            config={aiConfig}
            apiKeyInput={apiKeyInput}
            hasStoredKey={hasStoredKey}
            models={models}
            error={aiError}
            loading={aiLoading}
            lastVerifiedAt={lastVerifiedAt}
            onChangeField={(key, value) => useAiStore.getState().setConfigField(key, value)}
            onChangeApiKey={(value) => useAiStore.getState().setApiKeyInput(value)}
            onSelectPreset={handleSelectPreset}
            onSave={() => void handleSaveAi()}
            onTest={() => void useAiStore.getState().testConnection()}
          />
          <p className="mt-3 text-caption text-text-muted">
            The API key is stored in the OS keychain, never in the application database. Where no
            OS credential store is available the key is not persisted (fail closed) and the state
            above says so honestly.
          </p>
        </Panel>

        <Panel title="Crawler defaults">
          <p className="mb-3 max-w-lg text-caption text-text-muted">
            Defaults for every new crawl. The Scan screen seeds its configuration from these values
            and still lets you adjust them per run.
          </p>
          <CrawlerSettingsPanel />
        </Panel>

        <Panel title="Security & privacy">
          <SecuritySettingsPanel />
        </Panel>

        <Panel title="Workspace">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-text-secondary">App data location</dt>
              <dd className="break-all font-mono text-code text-text-primary">
                {workspaceLocation ?? 'Unavailable until local storage is ready.'}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-text-secondary">Project storage</dt>
              <dd className="break-all font-mono text-code text-text-primary">
                {'AppData/Local/ArtupskiReSite/projects/<project-id>'}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-caption text-text-muted">
            Everything is stored in the application's sandboxed app-data directory. Nothing is
            uploaded; the only outbound traffic is the AI endpoint you configure.
          </p>
        </Panel>
      </div>
    </PageShell>
  );
}
