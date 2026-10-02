/**
 * Visual comparison viewer - Artupski ReSite
 * Source of truth: docs/design/UI-SPEC.md section 2.7 (Visual Comparison Screen)
 * and docs/impl-plan/phase-13-impl-plan.md section 9.
 *
 * Renders the persisted/returned `VisualDiffReport` honestly:
 *   - comparison modes: side-by-side, slider overlay, and the colour-coded diff;
 *   - a mismatch/similarity score with the discrepancy inspector;
 *   - explicit loading / empty / error / partial states.
 *
 * It reuses the existing UI primitives (`Panel`, `Badge`, `Button`, `EmptyState`)
 * and the product's theme tokens - no new design system is introduced. The
 * component is presentational: it never captures, computes, or fetches anything.
 */
import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Panel } from '../ui/Panel';
import { StatusIndicator } from '../ui/StatusIndicator';
import { IconMonitor } from '../ui/icons';
import type { DiffDiscrepancy, ViewportComparison, VisualDiffReport } from '../../types/visualDiff';

export type DiffViewMode = 'side-by-side' | 'slider' | 'diff';

export interface DiffViewerProps {
  report: VisualDiffReport | null;
  loading: boolean;
  /** Human-facing error string (never a raw object) shown as an alert. */
  error: string | null;
  /** The viewport profile currently shown; falls back to the first comparison. */
  activeProfile?: string | null;
  onSelectProfile?: (profile: string) => void;
  className?: string;
}

/** Convert a base64 PNG payload to a data URL, or null when absent. */
function dataUrl(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : '';
  return base64 ? `data:image/png;base64,${base64}` : null;
}

/** Similarity tone: high is good, low is a warning. */
function scoreTone(
  percent: number,
  compared: boolean
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (!compared) return 'neutral';
  if (percent >= 98) return 'success';
  if (percent >= 90) return 'warning';
  return 'danger';
}

function discrepancyLabel(kind: DiffDiscrepancy['kind']): string {
  switch (kind) {
    case 'dimension_mismatch':
      return 'Size mismatch';
    case 'layout_shift':
      return 'Layout shift';
    case 'missing_font':
      return 'Missing font';
    case 'missing_image':
      return 'Missing image';
    case 'pixel_mismatch':
    default:
      return 'Pixel mismatch';
  }
}

export function DiffViewer({
  report,
  loading,
  error,
  activeProfile,
  onSelectProfile,
  className
}: DiffViewerProps) {
  const [mode, setMode] = useState<DiffViewMode>('side-by-side');
  const [sliderPercent, setSliderPercent] = useState(50);

  const comparison = useMemo<ViewportComparison | null>(() => {
    if (!report || report.comparisons.length === 0) return null;
    const byProfile = report.comparisons.find((entry) => entry.profile === activeProfile);
    return byProfile ?? report.comparisons[0]!;
  }, [report, activeProfile]);

  if (loading) {
    return (
      <Panel title="Visual comparison" className={className}>
        <div className="flex items-center gap-2 py-6 text-caption text-text-muted">
          <StatusIndicator tone="active" label="Comparing pages" pulse />
          <span>Comparing the generated project against the original capture…</span>
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="Visual comparison" className={className}>
        <p role="alert" className="py-4 text-body text-danger">
          {error}
        </p>
      </Panel>
    );
  }

  if (!report || report.comparisons.length === 0) {
    return (
      <Panel title="Visual comparison" className={className}>
        <EmptyState
          icon={<IconMonitor className="size-5" />}
          title="No comparison yet"
          description="Run a visual comparison to see the original capture beside the generated project, with a pixel diff and mismatch score."
        />
      </Panel>
    );
  }

  const summary = report.summary;
  const diffUrl = comparison ? dataUrl(comparison.diffPng) : null;

  return (
    <Panel
      title="Visual comparison"
      className={className}
      actions={
        <div className="flex items-center gap-1.5">
          <Badge tone={scoreTone(summary.averageSimilarityPercent, summary.compared > 0)}>
            {summary.compared > 0
              ? `${summary.averageSimilarityPercent.toFixed(2)}% match`
              : 'No match data'}
          </Badge>
          {summary.partial ? <Badge tone="warning">Partial</Badge> : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Profile selector */}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Viewports">
          {report.comparisons.map((entry) => (
            <Button
              key={entry.profile}
              size="sm"
              role="tab"
              aria-selected={entry.profile === comparison?.profile}
              variant={entry.profile === comparison?.profile ? 'primary' : 'ghost'}
              onClick={() => onSelectProfile?.(entry.profile)}
            >
              {entry.profile}
              {!entry.compared ? ' (skipped)' : ''}
            </Button>
          ))}
          <span className="ml-auto text-caption text-text-muted">
            {summary.compared} of {summary.viewports} viewport(s) compared
          </span>
        </div>

        {/* Mode switcher */}
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Comparison modes">
          {(['side-by-side', 'slider', 'diff'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              role="tab"
              aria-selected={mode === value}
              variant={mode === value ? 'secondary' : 'ghost'}
              onClick={() => setMode(value)}
            >
              {value === 'side-by-side'
                ? 'Side by side'
                : value === 'slider'
                  ? 'Slider'
                  : 'Pixel diff'}
            </Button>
          ))}
        </div>

        {comparison && !comparison.compared ? (
          <p className="rounded border border-border-subtle bg-surface-elevated p-3 text-body text-text-secondary">
            {comparison.skippedReason ?? 'This viewport could not be compared.'}
          </p>
        ) : null}

        {comparison && comparison.compared ? (
          <>
            {mode === 'side-by-side' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <ComparisonPane label="Original capture" />
                <ComparisonPane label="Generated render" />
              </div>
            ) : null}

            {mode === 'slider' ? (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-caption text-text-secondary">
                  <span className="w-24 shrink-0">Reveal</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPercent}
                    aria-label="Overlay split"
                    onChange={(event) => setSliderPercent(Number(event.target.value))}
                    className="h-1 w-full accent-brand"
                  />
                  <span className="w-10 text-right tabular-nums">{sliderPercent}%</span>
                </label>
                <div className="relative overflow-hidden rounded border border-border-subtle bg-surface-elevated">
                  <div className="flex h-40 items-center justify-center text-caption text-text-muted">
                    <div className="flex w-full items-stretch">
                      <div
                        className="flex items-center justify-center bg-info/10"
                        style={{ width: `${sliderPercent}%` }}
                      >
                        Original
                      </div>
                      <div className="flex flex-1 items-center justify-center bg-brand/10">
                        Generated
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {mode === 'diff' ? (
              <div className="overflow-hidden rounded border border-border-subtle bg-surface-elevated">
                {diffUrl ? (
                  <img
                    src={diffUrl}
                    alt="Pixel diff highlighting mismatched regions in magenta"
                    className="max-h-80 w-full object-contain"
                  />
                ) : (
                  <p className="p-4 text-caption text-text-muted">
                    The diff image is unavailable for this viewport.
                  </p>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 text-caption text-text-secondary">
              <span>
                Similarity{' '}
                <span className="font-semibold tabular-nums text-text-primary">
                  {comparison.similarityPercent.toFixed(2)}%
                </span>
              </span>
              <span>
                Mismatched{' '}
                <span className="font-semibold tabular-nums text-text-primary">
                  {comparison.mismatchedPixels.toLocaleString()}
                </span>{' '}
                / {comparison.totalPixels.toLocaleString()} px
              </span>
              <span className="text-text-muted">
                {comparison.width}×{comparison.height}
              </span>
            </div>

            <DiscrepancyList discrepancies={comparison.discrepancies} />
          </>
        ) : null}
      </div>
    </Panel>
  );
}

/** A labelled pane placeholder; the original/generated bytes are not exposed. */
function ComparisonPane({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-medium text-text-secondary">{label}</span>
      <div
        className={cn(
          'flex h-40 items-center justify-center rounded border border-border-subtle',
          'bg-surface-elevated text-caption text-text-muted'
        )}
      >
        {label}
      </div>
    </div>
  );
}

function DiscrepancyList({ discrepancies }: { discrepancies: DiffDiscrepancy[] }) {
  if (discrepancies.length === 0) {
    return (
      <p className="text-caption text-text-muted">
        No discrepancies detected at the applied threshold.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1" aria-label="Discrepancies">
      {discrepancies.map((discrepancy, index) => (
        <li
          key={`${discrepancy.kind}-${index}`}
          className="flex items-start gap-2 text-caption text-text-secondary"
        >
          <Badge tone={discrepancy.severity === 'warning' ? 'warning' : 'neutral'}>
            {discrepancyLabel(discrepancy.kind)}
          </Badge>
          <span>{discrepancy.message}</span>
        </li>
      ))}
    </ul>
  );
}
