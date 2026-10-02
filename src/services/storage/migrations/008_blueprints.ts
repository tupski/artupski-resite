/**
 * Migration 008 - Website Blueprint documents - Artupski ReSite
 * Source of truth: docs/architecture/DATABASE.md section 3 (`blueprints`
 * sketch), docs/specs/BLUEPRINT-SPEC.md sections 1-5, and
 * docs/impl-plan/phase-9-impl-plan.md section 6.
 *
 * This migration is APPEND-ONLY: `001`-`007` are never edited (their recorded
 * checksums must stay stable). It:
 *   - creates `blueprints`, matching the DATABASE.md section 3 sketch, with the
 *     document revision (`version`), the schema revision (`schema_version`), the
 *     sandboxed on-disk `file_path`, and the validation outcome (`is_valid` +
 *     `validation_errors` JSON array);
 *   - adds a UNIQUE `(scan_id, version)` index so re-running synthesis updates
 *     the existing revision instead of duplicating it;
 *   - adds a nullable `scan_pages.blueprint_evidence_path` column holding the
 *     on-disk path to the captured bounded DOM/computed-style evidence, so it
 *     survives between runs without re-crawling. Nullable, so legacy rows and
 *     non-blueprint scans are unaffected (backward compatible).
 *
 * The Blueprint document itself is large, so only its path + validation
 * metadata live here (the DB is exported as one WASM buffer); the JSON lives in
 * the sandboxed blueprint tree.
 */
import type { Migration } from './types';

const UP = `
CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scan_id TEXT REFERENCES scans(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL DEFAULT 1,
  file_path TEXT NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT 0,
  validation_errors TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Re-running synthesis for a scan updates its revision rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_blueprints_scan_version ON blueprints(scan_id, version);
CREATE INDEX IF NOT EXISTS idx_blueprints_project_id ON blueprints(project_id);
CREATE INDEX IF NOT EXISTS idx_blueprints_scan_id ON blueprints(scan_id);

-- CRITICAL-GAP support: persist the captured blueprint-evidence path per page.
-- Nullable so existing rows and non-blueprint scans keep working unchanged.
ALTER TABLE scan_pages ADD COLUMN blueprint_evidence_path TEXT;
`;

export const MIGRATION_008_BLUEPRINTS: Migration = {
  version: 8,
  name: 'blueprints',
  sql: UP
};
