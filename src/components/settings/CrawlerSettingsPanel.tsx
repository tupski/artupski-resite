/**
 * Crawler defaults panel - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md sections 8.3, 11, 12 and
 * docs/specs/SCANNER-SPEC.md section 4.2.
 *
 * High-density, honest form bound to `settingsStore.crawler`. Numeric fields are
 * clamped to the documented bounds on commit; an out-of-range or non-numeric
 * entry surfaces an actionable inline error and is never written to the store
 * while invalid. The concurrency caption is deliberately not a control: the
 * browser worker fixes parallelism at 1 (`crawlLimits.ts`), so exposing a dial
 * would be a dead, dishonest affordance (anti-ui-slop).
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  CRAWLER_DEPTH_MAX,
  CRAWLER_DEPTH_MIN,
  CRAWLER_PAGES_MAX,
  CRAWLER_PAGES_MIN,
  useSettingsStore
} from '../../stores/settingsStore';
import { Input } from '../ui/Input';
import { cn } from '../../lib/cn';

interface NumericFieldProps {
  label: string;
  hint: ReactNode;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

/**
 * A bounded numeric input. Keeps a local text buffer so the user can type
 * freely; only an in-range integer is committed live. On blur an invalid entry
 * is clamped to the nearest bound (or reverted when non-numeric) and the error
 * is cleared, so the store never holds an out-of-range value.
 */
function NumericField({ label, hint, value, min, max, disabled, onCommit }: NumericFieldProps) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  // Reflect an external change (e.g. a reset) when the field is not being edited.
  useEffect(() => {
    setText((current) => {
      const parsed = Number.parseInt(current, 10);
      return Number.isFinite(parsed) && parsed === value ? current : String(value);
    });
  }, [value]);

  const rangeMessage = `${label} must be a whole number between ${min} and ${max}.`;

  const handleChange = (raw: string) => {
    setText(raw);
    if (raw.trim().length === 0) {
      setError(rangeMessage);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setError(rangeMessage);
      return;
    }
    if (parsed < min || parsed > max) {
      setError(rangeMessage);
      return;
    }
    setError(null);
    onCommit(parsed);
  };

  const handleBlur = () => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      setError(null);
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.floor(parsed)));
    setText(String(clamped));
    setError(null);
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <Input
      label={label}
      type="number"
      min={min}
      max={max}
      step={1}
      value={text}
      disabled={disabled}
      error={error}
      hint={hint}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
    />
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-2.5 text-body',
        disabled ? 'opacity-60' : 'text-text-secondary'
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 accent-brand"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-text-primary">{label}</span>
        <span className="text-caption text-text-muted">{description}</span>
      </span>
    </label>
  );
}

export interface CrawlerSettingsPanelProps {
  /** Disable every control while a scan owns the configuration. */
  disabled?: boolean;
}

export function CrawlerSettingsPanel({ disabled = false }: CrawlerSettingsPanelProps) {
  const crawler = useSettingsStore((state) => state.crawler);
  const setCrawlerSettings = useSettingsStore((state) => state.setCrawlerSettings);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumericField
          label="Max crawl depth"
          hint={`${CRAWLER_DEPTH_MIN} to ${CRAWLER_DEPTH_MAX} link levels from the seed`}
          value={crawler.maxDepth}
          min={CRAWLER_DEPTH_MIN}
          max={CRAWLER_DEPTH_MAX}
          disabled={disabled}
          onCommit={(maxDepth) => setCrawlerSettings({ maxDepth })}
        />
        <NumericField
          label="Max pages"
          hint={`Hard upper bound of ${CRAWLER_PAGES_MIN} to ${CRAWLER_PAGES_MAX} pages`}
          value={crawler.maxPages}
          min={CRAWLER_PAGES_MIN}
          max={CRAWLER_PAGES_MAX}
          disabled={disabled}
          onCommit={(maxPages) => setCrawlerSettings({ maxPages })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <ToggleRow
          label="Run headless"
          description="Crawl without a visible browser window. Leave on unless debugging."
          checked={crawler.headless}
          disabled={disabled}
          onChange={(headless) => setCrawlerSettings({ headless })}
        />
        <ToggleRow
          label="Capture viewports"
          description="After a completed crawl, screenshot each enabled breakpoint."
          checked={crawler.captureViewports}
          disabled={disabled}
          onChange={(captureViewports) => setCrawlerSettings({ captureViewports })}
        />
        <ToggleRow
          label="Generate blueprint"
          description="Capture DOM/style evidence and synthesize a website blueprint after a crawl."
          checked={crawler.generateBlueprint}
          disabled={disabled}
          onChange={(generateBlueprint) => setCrawlerSettings({ generateBlueprint })}
        />
      </div>

      <p className="text-caption text-text-muted" data-testid="crawler-concurrency-note">
        Crawler concurrency is fixed at 1. The browser worker keeps a single session per crawl, so
        pages are fetched sequentially; this is not configurable.
      </p>
      <p className="text-caption text-text-muted">
        These defaults seed the Scan screen. You can still adjust them per scan without changing
        what is saved here.
      </p>
    </div>
  );
}
