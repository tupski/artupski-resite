/**
 * Migration 002 - Phase 4 scan page persistence - Artupski ReSite
 *
 * Creates the `scan_pages` table that Phase 4 needs to persist the page
 * extraction results produced by the crawler. `scans` already existed in
 * `001_init`; this migration only adds the missing child table and its indexes.
 *
 * Adaptation from docs/architecture/DATABASE.md section 3 (documented, not
 * silent): the Phase 4 extraction scope is page metadata/structure ONLY. The
 * original `scan_pages` sketch carried screenshot/dom/har paths and a
 * `content_type`; those artifacts arrive in later phases (responsive capture /
 * assets / HAR) and are deliberately NOT created here (no speculative columns).
 * The columns below mirror `NormalizedPage` (src/services/scanner/extraction/
 * types.ts): requested/final URL, HTTP status, title, meta description,
 * canonical, robots meta, headings, internal/external links, images, metrics,
 * per-page status/error, warnings, and the capture timestamp.
 *
 * JSON-valued collections are stored as TEXT (the bounded arrays are small and
 * the repository owns encoding/decoding). `path` is derived from the URL and
 * kept as a NOT NULL column so sitemap/path lookups stay cheap and indexable.
 */
import type { Migration } from './types';

const UP = `
CREATE TABLE IF NOT EXISTS scan_pages (
  id TEXT PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  path TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  robots_meta TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'timeout', 'skipped')),
  error_code TEXT,
  error_message TEXT,
  load_time_ms INTEGER,
  dom_content_loaded_time_ms INTEGER,
  dom_node_count INTEGER,
  headings TEXT,
  internal_links TEXT,
  external_links TEXT,
  images TEXT,
  warnings TEXT,
  captured_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (scan, url): re-visiting a page updates its record rather than
-- duplicating it, which keeps bounded retries and partial re-runs consistent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_pages_scan_url ON scan_pages(scan_id, url);
CREATE INDEX IF NOT EXISTS idx_scan_pages_scan_id ON scan_pages(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_pages_url ON scan_pages(url);
CREATE INDEX IF NOT EXISTS idx_scan_pages_path ON scan_pages(path);
CREATE INDEX IF NOT EXISTS idx_scan_pages_status ON scan_pages(status);
`;

export const MIGRATION_002_SCAN_PAGES: Migration = {
  version: 2,
  name: 'scan_pages',
  sql: UP
};
