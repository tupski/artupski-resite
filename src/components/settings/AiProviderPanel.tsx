import { Badge, type BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { StatusIndicator, type StatusTone } from '../ui/StatusIndicator';
import { PROVIDER_PRESETS } from '../../services/ai';
import type { AIConfig } from '../../types/ai';
import type { AiConnectionStatus, AiStoreError } from '../../stores/aiStore';

/**
 * AI provider settings panel - Artupski ReSite
 * Source of truth: docs/specs/AI-SPEC.md sections 1-2 and
 * docs/impl-plan/phase-10-impl-plan.md sections 3 and 6.
 *
 * Presentational and honest: the connection badge reflects only a real, verified
 * health check. There is no fabricated "connected" state, no invented model
 * list, and the API key is a transient input - it is never displayed back after
 * being saved. Every reachable state (unconfigured, testing, ready, error) is
 * covered explicitly.
 */

const STATUS_TONE: Record<AiConnectionStatus, StatusTone> = {
  unconfigured: 'idle',
  idle: 'idle',
  testing: 'active',
  ready: 'success',
  error: 'danger'
};

const STATUS_LABEL: Record<AiConnectionStatus, string> = {
  unconfigured: 'No endpoint configured',
  idle: 'Not verified',
  testing: 'Testing connection…',
  ready: 'Connected',
  error: 'Connection failed'
};

/** Bound the rendered model list so a huge `/models` response cannot bloat the DOM. */
export const MAX_RENDERED_MODELS = 50;

export interface AiProviderPanelProps {
  status: AiConnectionStatus;
  config: AIConfig;
  apiKeyInput: string;
  hasStoredKey: boolean;
  models: string[];
  error: AiStoreError | null;
  loading: boolean;
  lastVerifiedAt: string | null;
  onChangeField: <K extends keyof AIConfig>(key: K, value: AIConfig[K]) => void;
  onChangeApiKey: (value: string) => void;
  onSelectPreset: (presetId: string) => void;
  onSave: () => void;
  onTest: () => void;
}

export function AiProviderPanel(props: AiProviderPanelProps) {
  const {
    status,
    config,
    apiKeyInput,
    hasStoredKey,
    models,
    error,
    loading,
    lastVerifiedAt,
    onChangeField,
    onChangeApiKey,
    onSelectPreset,
    onSave,
    onTest
  } = props;

  const busy = loading || status === 'testing';
  const canTest = Boolean(config.baseUrl && config.model) && !busy;
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === config.providerId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusIndicator
          tone={STATUS_TONE[status]}
          label={STATUS_LABEL[status]}
          pulse={status === 'testing'}
        />
        {status === 'ready' && lastVerifiedAt ? (
          <Badge tone={'success' as BadgeTone}>
            verified {new Date(lastVerifiedAt).toLocaleTimeString()}
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-text-secondary">Provider preset</span>
          <select
            className="h-9 rounded border border-border-subtle bg-base px-2.5 text-body text-text-primary focus:border-border-focus focus:outline-none"
            value={config.providerId}
            onChange={(event) => onSelectPreset(event.target.value)}
          >
            {PROVIDER_PRESETS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {entry.local ? ' (local)' : ''}
              </option>
            ))}
            <option value="custom">Custom OpenAI-compatible</option>
          </select>
          {preset ? (
            <span className="text-caption text-text-muted">
              {preset.local ? 'Local endpoint' : 'Hosted endpoint'} · auth: {preset.authStyle}
            </span>
          ) : null}
        </label>

        <Input
          label="Model"
          value={config.model}
          placeholder={preset?.defaultModel ?? 'model-id'}
          onChange={(event) => onChangeField('model', event.target.value)}
        />

        <Input
          label="Base URL"
          value={config.baseUrl}
          placeholder={preset?.baseUrl ?? 'https://api.openai.com/v1'}
          hint="Absolute http(s) URL, no credentials in the URL."
          onChange={(event) => onChangeField('baseUrl', event.target.value)}
        />

        <Input
          label="API key"
          type="password"
          autoComplete="off"
          value={apiKeyInput}
          placeholder={hasStoredKey ? '•••••••• (stored)' : 'leave empty for local endpoints'}
          hint={
            hasStoredKey
              ? 'A key is stored locally. Type a new value to replace it, or clear it by saving empty.'
              : 'Stored locally; never sent anywhere except your configured endpoint.'
          }
          onChange={(event) => onChangeApiKey(event.target.value)}
        />
      </div>

      {error ? (
        <div role="alert" className="rounded border border-danger/40 bg-danger/5 p-2.5">
          <p className="text-caption font-medium text-danger">
            {error.code}: {error.message}
          </p>
          <p className="mt-0.5 text-caption text-text-muted">{error.suggestedAction}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" disabled={busy} onClick={onSave}>
          {loading ? 'Saving…' : 'Save configuration'}
        </Button>
        <Button type="button" variant="secondary" disabled={!canTest} onClick={onTest}>
          {status === 'testing' ? 'Testing…' : 'Test connection'}
        </Button>
      </div>

      {status === 'ready' ? (
        <div className="flex flex-col gap-1">
          <p className="text-caption text-text-secondary">
            {models.length > 0
              ? `${models.length} model${models.length === 1 ? '' : 's'} available`
              : 'Endpoint reachable (no model list returned)'}
          </p>
          {models.length > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {models.slice(0, MAX_RENDERED_MODELS).map((model) => (
                <li key={model}>
                  <Badge tone="neutral">{model}</Badge>
                </li>
              ))}
              {models.length > MAX_RENDERED_MODELS ? (
                <li>
                  <Badge tone="neutral">+{models.length - MAX_RENDERED_MODELS} more</Badge>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
