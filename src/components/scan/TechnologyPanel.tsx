import { Badge, type BadgeTone } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { IconGlobe } from '../ui/icons';
import type { ScanTechnology } from '../../types/models';

/**
 * Detected-technology results list (Phase 5).
 *
 * Renders PERSISTED detections only - there is no placeholder data. Every state
 * the product can reach is covered: loading, empty, error, partial capture, and
 * the list itself. Confidence is shown honestly (Detected vs Probable) and a
 * version is only shown when one was reliably extracted; a missing version is
 * labelled rather than guessed. Limitation notes from the engine are surfaced
 * so a weak signal is never presented as certain.
 */

export type ConfidenceStatus = 'detected' | 'probable' | 'unknown';

const STATUS_TONE: Record<string, BadgeTone> = {
  detected: 'success',
  probable: 'warning',
  unknown: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  detected: 'Detected',
  probable: 'Probable',
  unknown: 'Unconfirmed',
};

const VERSION_LABEL: Record<string, string> = {
  exact: 'exact',
  major_only: 'major',
  unavailable: 'version n/a',
};

function confidenceStatusOf(technology: ScanTechnology): ConfidenceStatus {
  const status = technology.confidenceStatus;
  if (status === 'detected' || status === 'probable' || status === 'unknown') {
    return status;
  }
  // Rows written before Phase 5 have no status; fall back to the score band.
  return technology.confidence >= 0.75 ? 'detected' : 'probable';
}

function versionLabelOf(technology: ScanTechnology): string {
  const status = technology.versionStatus;
  const label = status ? VERSION_LABEL[status] : undefined;
  return label ?? 'version n/a';
}

export interface TechnologyPanelProps {
  detections: ScanTechnology[];
  loading: boolean;
  error: string | null;
  partial: boolean;
}

export function TechnologyPanel({ detections, loading, error, partial }: TechnologyPanelProps) {
  if (loading && detections.length === 0) {
    return <p className="text-body text-text-secondary">Detecting technologies…</p>;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2"
      >
        <div className="flex flex-col gap-0.5">
          <p className="text-body text-text-primary">{error}</p>
          <p className="text-caption text-text-secondary">
            The crawl itself may still have completed; reopen the scan to retry loading detections.
          </p>
        </div>
      </div>
    );
  }

  if (detections.length === 0) {
    return (
      <EmptyState
        icon={<IconGlobe size={18} />}
        title="No technologies detected"
        description="None of the implemented signatures matched the captured evidence. Detection coverage is limited to documented rules and signal vectors."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {partial ? (
        <p role="status" className="text-caption text-warning">
          Some page markup was truncated during capture, so this list may be incomplete.
        </p>
      ) : null}
      <ul aria-label="Detected technologies" className="flex flex-col divide-y divide-border-subtle">
        {detections.map((technology) => {
          const status = confidenceStatusOf(technology);
          const versionLabel = versionLabelOf(technology);
          return (
            <li key={technology.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium text-text-primary">{technology.name}</span>
                <Badge tone="neutral">{technology.category}</Badge>
                {technology.version ? (
                  <span className="font-mono text-code text-text-secondary">
                    v{technology.version}
                    <span className="ml-1 text-text-muted">{versionLabel}</span>
                  </span>
                ) : (
                  <span className="font-mono text-code text-text-muted">{versionLabel}</span>
                )}
                <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
                  {STATUS_LABEL[status] ?? 'Unconfirmed'}
                </Badge>
                <span className="text-caption text-text-muted">
                  {Math.round(technology.confidence * 100)}% confidence
                </span>
              </div>
              {technology.limitation ? (
                <p className="text-caption text-text-secondary">{technology.limitation}</p>
              ) : null}
              {technology.evidence.length > 0 ? (
                <details className="text-caption text-text-secondary">
                  <summary className="cursor-pointer text-text-muted">
                    Evidence ({technology.evidence.length})
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5 pl-3 font-mono text-code text-text-muted">
                    {technology.evidence.slice(0, 10).map((signal, index) => (
                      <li
                        key={`${signal.vector}-${index}`}
                        className="truncate"
                        title={signal.evidence}
                      >
                        <span className="text-text-secondary">{signal.vector}</span>: {signal.evidence}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
