import { PageShell } from '../components/layout/PageShell';
import { Panel } from '../components/ui/Panel';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { StatusIndicator } from '../components/ui/StatusIndicator';
import { SCAN_STATUS_LABEL } from '../types/scan';
import { useScanStore } from '../stores/scanStore';
import { validateTargetUrl } from '../lib/url';

/**
 * Scan configuration surface.
 *
 * Phase 1 renders the configuration controls so the data model and ergonomics
 * are real, but the scan itself is disabled: the engine does not exist yet and
 * no progress is simulated (task sections 7 and 20).
 */
export function ScanRoute() {
  const configuration = useScanStore((state) => state.configuration);
  const updateConfiguration = useScanStore((state) => state.updateConfiguration);
  const targetUrl = useScanStore((state) => state.targetUrl);
  const setTargetUrl = useScanStore((state) => state.setTargetUrl);
  const status = useScanStore((state) => state.status);

  const validation = validateTargetUrl(targetUrl);

  return (
    <PageShell title="Scan" description="Configure the reverse-engineering crawl.">
      <div className="flex flex-col gap-4">
        <Panel
          title="Target"
          actions={<StatusIndicator tone="idle" label={SCAN_STATUS_LABEL[status]} />}
        >
          <Input
            label="Target website URL"
            placeholder="https://example.com"
            value={targetUrl}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            inputClassName="font-mono text-code"
            onChange={(event) => setTargetUrl(event.target.value)}
            error={targetUrl.trim().length > 0 && !validation.valid ? validation.message : null}
          />
        </Panel>

        <Panel title="Crawl configuration">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Max crawl depth"
              type="number"
              min={1}
              max={5}
              value={configuration.maxDepth}
              onChange={(event) =>
                updateConfiguration({ maxDepth: clamp(Number(event.target.value), 1, 5) })
              }
              hint="1 to 5"
            />
            <Input
              label="Max pages"
              type="number"
              min={1}
              max={500}
              value={configuration.maxPages}
              onChange={(event) =>
                updateConfiguration({ maxPages: clamp(Number(event.target.value), 1, 500) })
              }
              hint="Upper bound on pages crawled"
            />
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 text-caption font-medium text-text-secondary">Viewports</legend>
            <div className="flex flex-wrap gap-3">
              {(
                [
                  ['desktop', 'Desktop 1440×900'],
                  ['tablet', 'Tablet 768×1024'],
                  ['mobile', 'Mobile 375×667']
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-body text-text-secondary">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-brand"
                    checked={configuration.viewports[key]}
                    onChange={(event) =>
                      updateConfiguration({
                        viewports: { ...configuration.viewports, [key]: event.target.checked }
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-4 flex items-center gap-2 text-body text-text-secondary">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand"
              checked={configuration.headless}
              onChange={(event) => updateConfiguration({ headless: event.target.checked })}
            />
            Run headless
          </label>
        </Panel>

        <Panel
          title="Execute"
          actions={<Badge tone="warning">Not available in this phase</Badge>}
        >
          <div className="flex items-center justify-between gap-4">
            <p className="max-w-md text-caption text-text-muted">
              The Playwright scanning engine is introduced in a later phase. This screen
              configures scan parameters only; no crawl is performed yet.
            </p>
            <Button type="button" variant="primary" disabled>
              Start scan
            </Button>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
