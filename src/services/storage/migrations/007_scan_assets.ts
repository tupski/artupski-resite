/**
 * Migration 007 - Static clone assets - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md, docs/architecture/DATABASE.md
 * section 3 (`scan_assets` sketch) and section 6 (asset de-duplication),
 * docs/impl-plan/phase-8-impl-plan.md section 3.
 *
 * Phase 8's clone engine needs two things Phases 4/7 never persisted:
 *   1. the raw HTML body of each crawled page (the clone cannot be synthesized
 *      from metadata alone), and
 *   2. the bytes + metadata of every referenced asset.
 *
 * This migration is APPEND-ONLY: `001`-`006` are never edited (their recorded
 * checksums must stay stable). It:
 *   - creates `scan_assets`, matching the DATABASE.md section 3 sketch, with two
 *     documented additive fields: `page_url` (the page an asset was discovered
 *     on) and a UNIQUE `(scan_id, sha256)` index so identical payloads collapse
 *     to one physical file (DATABASE.md section 6 retention rule);
 *   - adds a nullable `scan_pages.raw_html_path` column holding the on-disk path
 *     to the captured raw HTML. It is nullable, so legacy rows and non-clone
 *     scans are unaffected (no data loss, backward compatible).
 *
 * Asset bytes and HTML bodies live on disk (sandboxed clone tree); only the
 * path + bounded metadata are stored here, so the database stays small.
 */
import type { Migration } from './types';

const UP = `
CREATE TABLE IF NOT EXISTS scan_assets (
  id TEXT PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES scan_pages(id) ON DELETE SET NULL,
  page_url TEXT,
  source_url TEXT NOT NULL,
  local_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image', 'stylesheet', 'script', 'font', 'video', 'audio', 'document', 'other')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Identical payloads de-duplicate to a single physical file per scan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_assets_scan_sha ON scan_assets(scan_id, sha256);
CREATE INDEX IF NOT EXISTS idx_scan_assets_scan_id ON scan_assets(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_assets_page_id ON scan_assets(page_id);
CREATE INDEX IF NOT EXISTS idx_scan_assets_sha256 ON scan_assets(sha256);
CREATE INDEX IF NOT EXISTS idx_scan_assets_asset_type ON scan_assets(asset_type);

-- CRITICAL-GAP fix: persist the captured raw HTML path per page. Nullable so
-- existing rows and non-clone scans keep working unchanged.
ALTER TABLE scan_pages ADD COLUMN raw_html_path TEXT;
`;

export const MIGRATION_007_SCAN_ASSETS: Migration = {
  version: 7,
  name: 'scan_assets',
  sql: UP
};
