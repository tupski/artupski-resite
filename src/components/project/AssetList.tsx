/**
 * Captured clone assets list - Artupski ReSite
 *
 * Read-only rendering of the persisted `scan_assets` rows for a scan (source of
 * truth: the database). The asset bytes live on disk; only the metadata is
 * shown here. Honest states only: loading, error, empty, and the list itself.
 */
import { useMemo, useState } from 'react';
import { Badge, type BadgeTone } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { IconProjects } from '../ui/icons';
import type { CloneAsset } from '../../types/models';
import { formatBytes } from './format';

export interface AssetListProps {
  assets: CloneAsset[];
  loading: boolean;
  error: { code: string; message: string; suggestedAction: string } | null;
}

/** Bound the rendered rows so a large asset set never freezes the DOM. */
export const MAX_RENDERED_ASSETS = 500;

function assetTone(assetType: string): BadgeTone {
  if (assetType === 'stylesheet' || assetType === 'script') {
    return 'brand';
  }
  if (assetType === 'image' || assetType === 'font') {
    return 'success';
  }
  return 'neutral';
}

export function AssetList({ assets, loading, error }: AssetListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return assets;
    }
    return assets.filter(
      (asset) =>
        asset.sourceUrl.toLowerCase().includes(needle) ||
        asset.localPath.toLowerCase().includes(needle) ||
        asset.assetType.toLowerCase().includes(needle)
    );
  }, [assets, query]);

  if (loading) {
    return <p className="text-body text-text-secondary">Loading captured assets…</p>;
  }

  if (error) {
    return (
      <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
        <p className="text-body text-text-primary">{error.message}</p>
        <p className="text-caption text-text-muted">{error.suggestedAction}</p>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <EmptyState
        icon={<IconProjects size={22} />}
        title="No assets captured"
        description="A static clone downloads pages, stylesheets, scripts, images and fonts. Nothing was captured for this scan."
      />
    );
  }

  const shown = filtered.slice(0, MAX_RENDERED_ASSETS);
  const hidden = filtered.length - shown.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-caption text-text-secondary">
          <span className="sr-only">Filter assets</span>
          <input
            type="search"
            value={query}
            placeholder="Filter by URL, path, or type…"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-64 rounded border border-border-subtle bg-base px-2 text-body text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          />
        </label>
        <span className="text-caption text-text-muted">
          {filtered.length} {filtered.length === 1 ? 'asset' : 'assets'}
          {query.trim() ? ` of ${assets.length}` : ''}
        </span>
      </div>

      <ul className="flex flex-col">
        {shown.map((asset) => (
          <li
            key={asset.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2 last:border-b-0"
          >
            <Badge tone={assetTone(asset.assetType)}>{asset.assetType}</Badge>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className="truncate font-mono text-code text-text-primary"
                title={asset.localPath}
              >
                {asset.localPath}
              </span>
              <span className="truncate text-caption text-text-muted" title={asset.sourceUrl}>
                {asset.sourceUrl}
              </span>
            </div>
            <span className="shrink-0 text-caption text-text-muted">
              {formatBytes(asset.sizeBytes)}
            </span>
          </li>
        ))}
      </ul>

      {shown.length === 0 ? (
        <p className="text-caption text-text-muted">No assets match “{query.trim()}”.</p>
      ) : null}

      {hidden > 0 ? (
        <p className="text-caption text-text-muted">
          {hidden} more asset(s) not shown (limit {MAX_RENDERED_ASSETS}).
        </p>
      ) : null}
    </div>
  );
}
