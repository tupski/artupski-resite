import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { StatusIndicator } from '../ui/StatusIndicator';
import type { ResponsiveCapture } from '../../types/models';

/**
 * Responsive viewport gallery - Artupski ReSite
 * Source of truth: docs/design/RESPONSIVE-SPEC.md sections 1-2.
 *
 * Renders the persisted viewport captures for a scan (source of truth: the DB).
 * Honest states only: a loading indicator, an empty state ("nothing captured"),
 * or an error. No screenshot or breakpoint is ever fabricated. Screenshots are
 * on-disk files referenced by path; this component shows the metadata and the
 * visible-element map, and links to the file path when one exists.
 */
export interface ViewportPreviewProps {
  captures: ResponsiveCapture[];
  loading: boolean;
  error: { code: string; message: string; suggestedAction: string } | null;
}

/** Group captures by page URL so each page shows its breakpoints together. */
function groupByUrl(captures: ResponsiveCapture[]): Array<[string, ResponsiveCapture[]]> {
  const map = new Map<string, ResponsiveCapture[]>();
  for (const capture of captures) {
    const list = map.get(capture.url) ?? [];
    list.push(capture);
    map.set(capture.url, list);
  }
  return Array.from(map.entries());
}

/** Human label for a breakpoint width. */
function widthCategory(width: number): 'mobile' | 'tablet' | 'desktop' {
  if (width < 600) return 'mobile';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

export function ViewportPreview({ captures, loading, error }: ViewportPreviewProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-caption text-text-muted">
        <StatusIndicator tone="active" label="Loading viewport captures" pulse />
        <span>Loading viewport captures…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
        <p className="text-body text-text-primary">{error.message}</p>
        <p className="text-caption text-text-muted">{error.suggestedAction}</p>
      </div>
    );
  }

  if (captures.length === 0) {
    return (
      <p className="py-2 text-caption text-text-muted">
        No viewport captures for this scan. Select one or more viewports and run a scan to capture
        screenshots and visible-element maps per breakpoint.
      </p>
    );
  }

  const groups = groupByUrl(captures);

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([url, group]) => {
        const breakpoints = Array.from(
          new Set(group.flatMap((capture) => capture.detectedBreakpoints))
        ).sort((a, b) => a - b);
        return (
          <div key={url} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className="min-w-0 truncate font-mono text-code text-text-secondary"
                title={url}
              >
                {url}
              </span>
              {breakpoints.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-caption text-text-muted">Breakpoints</span>
                  {breakpoints.map((value) => (
                    <Badge key={value} tone="neutral">
                      {value}px
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-caption text-text-muted">
                  No media-query breakpoints detected
                </span>
              )}
            </div>

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {group
                .slice()
                .sort((a, b) => a.width - b.width)
                .map((capture) => {
                  const visibleCount = capture.elementMap.filter((node) => node.visible).length;
                  const category = widthCategory(capture.width);
                  return (
                    <li
                      key={capture.id}
                      className="flex flex-col gap-2 rounded border border-border-subtle bg-base p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption font-medium text-text-primary">
                          {capture.profile}
                        </span>
                        <Badge tone={category === 'mobile' ? 'brand' : 'neutral'}>
                          {capture.width}×{capture.height}
                        </Badge>
                      </div>
                      {capture.screenshotPath ? (
                        <span
                          className="truncate font-mono text-caption text-text-muted"
                          title={capture.screenshotPath}
                        >
                          {capture.screenshotPath}
                        </span>
                      ) : (
                        <span className="text-caption text-text-muted">
                          Screenshot not stored on disk; element map retained.
                        </span>
                      )}
                      <div className="flex items-center justify-between gap-2 text-caption text-text-muted">
                        <span>{visibleCount} visible element(s)</span>
                        {capture.truncated ? (
                          <span className="text-warning" title="List/image truncated by a size cap">
                            truncated
                          </span>
                        ) : null}
                      </div>
                      <div
                        aria-hidden="true"
                        className={cn(
                          'h-1 rounded-full',
                          category === 'mobile' ? 'bg-brand/50' : 'bg-border-subtle'
                        )}
                      />
                    </li>
                  );
                })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
