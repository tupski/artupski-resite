/**
 * Crawled pages table - Artupski ReSite
 *
 * Read-only rendering of the persisted `scan_pages` rows for a scan (source of
 * truth: the database). Honest states only: loading, error, empty, and the
 * table itself. Counts and statuses come straight from the rows - a page that
 * failed is never shown as completed.
 */
import { useMemo, useState } from 'react';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { IconGlobe } from '../ui/icons';
import type { ScanPage } from '../../types/models';
import { SCAN_PAGE_STATUS_LABEL, SCAN_PAGE_STATUS_TONE } from './format';

export interface PagesTableProps {
  pages: ScanPage[];
  loading: boolean;
  error: string | null;
}

/** Bound the rendered rows so a large crawl never freezes the DOM. */
export const MAX_RENDERED_PAGES = 500;

/** Human label for a page's auth classification; null on legacy rows. */
const AUTH_LABEL: Record<string, string> = {
  public: 'Public',
  authenticated: 'Authed',
  auth_required: 'Auth required',
  unknown: 'Unknown'
};

export function PagesTable({ pages, loading, error }: PagesTableProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return pages;
    }
    return pages.filter(
      (page) =>
        page.url.toLowerCase().includes(needle) ||
        (page.title ?? '').toLowerCase().includes(needle)
    );
  }, [pages, query]);

  if (loading) {
    return <p className="text-body text-text-secondary">Loading crawled pages…</p>;
  }

  if (error) {
    return (
      <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
        <p className="text-body text-text-primary">{error}</p>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <EmptyState
        icon={<IconGlobe size={22} />}
        title="No pages recorded"
        description="This scan has no persisted pages. A cancelled or failed crawl can complete without storing any page rows."
      />
    );
  }

  const shown = filtered.slice(0, MAX_RENDERED_PAGES);
  const hidden = filtered.length - shown.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-caption text-text-secondary">
          <span className="sr-only">Filter pages</span>
          <input
            type="search"
            value={query}
            placeholder="Filter by URL or title…"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-64 rounded border border-border-subtle bg-base px-2 text-body text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          />
        </label>
        <span className="text-caption text-text-muted">
          {filtered.length} {filtered.length === 1 ? 'page' : 'pages'}
          {query.trim() ? ` of ${pages.length}` : ''}
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-border-subtle">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-elevated text-caption text-text-secondary">
              <th scope="col" className="px-3 py-2 font-medium">
                URL
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Depth
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                HTTP
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Auth
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Title
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((page) => (
              <tr
                key={page.id}
                className="border-b border-border-subtle last:border-b-0 align-top text-body"
              >
                <td className="max-w-[22rem] px-3 py-2">
                  <span
                    className="block truncate font-mono text-code text-text-primary"
                    title={page.url}
                  >
                    {page.path || page.url}
                  </span>
                  {page.finalUrl && page.finalUrl !== page.url ? (
                    <span className="block truncate text-caption text-text-muted" title={page.finalUrl}>
                      → {page.finalUrl}
                    </span>
                  ) : null}
                  {page.errorCode ? (
                    <span className="block text-caption text-danger">
                      {page.errorCode}
                      {page.errorMessage ? `: ${page.errorMessage}` : ''}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-mono text-code text-text-secondary">{page.depth}</td>
                <td className="px-3 py-2">
                  <Badge tone={SCAN_PAGE_STATUS_TONE[page.status]}>
                    {SCAN_PAGE_STATUS_LABEL[page.status]}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-code text-text-secondary">
                  {page.httpStatus ?? '—'}
                </td>
                <td className="px-3 py-2 text-caption text-text-secondary">
                  {page.authStatus ? (AUTH_LABEL[page.authStatus] ?? page.authStatus) : '—'}
                </td>
                <td className="max-w-[16rem] px-3 py-2">
                  <span className="block truncate text-text-secondary" title={page.title ?? ''}>
                    {page.title ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 ? (
        <p className="text-caption text-text-muted">No pages match “{query.trim()}”.</p>
      ) : null}

      {hidden > 0 ? (
        <p className="text-caption text-text-muted">
          {hidden} more page(s) not shown (limit {MAX_RENDERED_PAGES}).
        </p>
      ) : null}
    </div>
  );
}
