/**
 * Migration 003 - Phase 5 technology detection - Artupski ReSite
 *
 * `scan_technologies` already existed from `001_init` (Phase 2) with the columns
 * `category`, `name`, `version`, `confidence`, `detection_source`, `metadata`.
 * Phase 5 needs a few additional, well-defined fields to preserve the detection
 * result faithfully (docs/specs/TECHNOLOGY-DETECTION.md section 4.3) without
 * changing the historical migration:
 *
 *   - `technology_id`     : the stable rule id (e.g. `nextjs`), for dedupe.
 *   - `confidence_status` : `detected` | `probable` | `unknown` (section 4.1).
 *   - `version_status`    : `exact` | `major_only` | `unavailable` (section 4.3).
 *   - `evidence`          : JSON array of matched signals (vector/pattern/weight).
 *   - `pages`             : JSON array of page URLs that contributed evidence.
 *   - `limitation`        : honest limitation note for the UI (nullable).
 *
 * The pre-existing `metadata` column is left in place (it is not dropped: this
 * is a forward-only additive migration and dropping a column would be a
 * destructive change for any data already written by earlier phases).
 *
 * Indexes: a `(scan_id, technology_id)` UNIQUE index enforces one row per
 * technology per scan (re-running detection updates rather than duplicates);
 * `idx_scan_technologies_scan_name` supports the results list ordering.
 * Existing rows have a NULL `technology_id`; SQLite treats NULLs as distinct in
 * a UNIQUE index, so historical rows are unaffected.
 */
import type { Migration } from './types';

const UP = `
ALTER TABLE scan_technologies ADD COLUMN technology_id TEXT;
ALTER TABLE scan_technologies ADD COLUMN confidence_status TEXT;
ALTER TABLE scan_technologies ADD COLUMN version_status TEXT;
ALTER TABLE scan_technologies ADD COLUMN evidence TEXT;
ALTER TABLE scan_technologies ADD COLUMN pages TEXT;
ALTER TABLE scan_technologies ADD COLUMN limitation TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_technologies_scan_tech
  ON scan_technologies(scan_id, technology_id);
CREATE INDEX IF NOT EXISTS idx_scan_technologies_scan_name
  ON scan_technologies(scan_id, name);
`;

export const MIGRATION_003_TECHNOLOGY_DETECTION: Migration = {
  version: 3,
  name: 'technology_detection',
  sql: UP
};
