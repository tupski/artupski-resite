import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { StatusIndicator } from '../ui/StatusIndicator';
import type { CloneAsset } from '../../types/models';
import type { CloneReport } from '../../types/clone';

/**
 * Static clone panel - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md and docs/design/UI-SPEC.md.
 *
 * Renders the persisted clone assets for a scan (source of truth: the DB) and
 * the honest outcome of the most recent run. States are never fabricated: a
 * loading indicator, an empty state ("nothing cloned"), an error, or a partial
 * report listing skipped pages/assets. The preview URL is a real loopback URL
 * returned by the managed server; opening it targets the system browser.
 */
export interface ClonePanelProps {
  assets: CloneAsset[];
  loading: boolean;
  error: { code: string; message: string; suggestedAction: string } | null;
  report: CloneReport | null;
  previewUrl: string | null;
  previewBusy: boolean;
  /** True when the target scan already has completed pages to clone. */
  canGenerate: boolean;
  generating: boolean;
  /** Root of the sandboxed clone tree, when known (enables preview). */
  notReady: boolean;
  onGenerate: () => void;
  onOpenPreview: () => void;
  onClosePreview: () => void;
}

/** Human label + tone for an asset kind. */
function assetTone(assetType: string): 'neutral' | 'brand' | 'success' {
  if (assetType === 'stylesheet' || assetType === 'script') {
    return 'brand';
  }
  if (assetType === 'image' || assetType === 'font') {
    return 'success';
  }
  return 'neutral';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClonePanel({
  assets,
  loading,
  error,
  report,
  previewUrl,
  previewBusy,
  canGenerate,
  generating,
  notReady,
  onGenerate,
  onOpenPreview,
  onClosePreview
}: ClonePanelProps) {
  const partial = report ? report.skippedPages > 0 || report.assetsSkipped > 0 : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-caption text-text-muted">
          Rewrites the captured pages and assets into a self-contained offline folder and serves it
          from a local preview server.
        </p>
        <div className="flex items-center gap-2">
          {previewUrl ? (
            <>
              <Button type="button" onClick={() => void onOpenPreview()} disabled={previewBusy}>
                Open preview
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void onClosePreview()}
                disabled={previewBusy}
              >
                Stop server
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={!canGenerate || generating || notReady}
              onClick={() => void onGenerate()}
            >
              {generating ? 'Generating clone…' : 'Generate static clone'}
            </Button>
          )}
        </div>
      </div>

      {notReady ? (
        <p className="text-caption text-text-muted">
          The static clone engine is only available in the desktop shell.
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
          <p className="text-body text-text-primary">{error.message}</p>
          <p className="text-caption text-text-muted">{error.suggestedAction}</p>
        </div>
      ) : null}

      {previewUrl ? (
        <div className="flex items-center gap-2 rounded border border-border-subtle bg-base px-3 py-2">
          <StatusIndicator tone="success" label="Preview server running" />
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-mono text-code text-brand hover:underline"
          >
            {previewUrl}
          </a>
        </div>
      ) : null}

      {generating ? (
        <div className="flex items-center gap-2 py-2 text-caption text-text-muted">
          <StatusIndicator tone="active" label="Generating static clone" pulse />
          <span>Capturing pages and assets…</span>
        </div>
      ) : null}

      {report ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded border border-border-subtle bg-base px-3 py-2">
            <dt className="text-caption text-text-muted">Pages cloned</dt>
            <dd className="font-mono text-code text-text-primary">{report.generatedPages}</dd>
          </div>
          <div className="rounded border border-border-subtle bg-base px-3 py-2">
            <dt className="text-caption text-text-muted">Pages skipped</dt>
            <dd className="font-mono text-code text-text-primary">{report.skippedPages}</dd>
          </div>
          <div className="rounded border border-border-subtle bg-base px-3 py-2">
            <dt className="text-caption text-text-muted">Assets written</dt>
            <dd className="font-mono text-code text-text-primary">{report.assetsWritten}</dd>
          </div>
          <div className="rounded border border-border-subtle bg-base px-3 py-2">
            <dt className="text-caption text-text-muted">Assets skipped</dt>
            <dd className="font-mono text-code text-text-primary">{report.assetsSkipped}</dd>
          </div>
        </dl>
      ) : null}

      {partial ? (
        <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-body text-text-primary">Clone completed with gaps.</p>
          <p className="text-caption text-text-secondary">
            Some pages or assets could not be captured; those are not fabricated in the output.
          </p>
        </div>
      ) : null}

      {report && report.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded border border-border-subtle bg-base p-2">
          {report.warnings.slice(0, 8).map((warning, index) => (
            <li key={`${index}-${warning}`} className="text-caption text-warning">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-caption text-text-muted">
          <StatusIndicator tone="active" label="Loading clone assets" pulse />
          <span>Loading clone assets…</span>
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          title="No clone assets yet"
          description="Run a scan, then generate a static clone to download pages, stylesheets, scripts, images and fonts into one offline folder."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium text-text-secondary">
            Captured assets ({assets.length})
          </span>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="flex items-center justify-between gap-3 rounded border border-border-subtle bg-base px-2 py-1"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone={assetTone(asset.assetType)}>{asset.assetType}</Badge>
                  <span
                    className="truncate font-mono text-code text-text-secondary"
                    title={asset.sourceUrl}
                  >
                    {asset.localPath}
                  </span>
                </span>
                <span className="shrink-0 text-caption text-text-muted">
                  {formatBytes(asset.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
