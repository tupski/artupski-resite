/**
 * Migration 006 - Responsive viewport captures - Artupski ReSite
 * Source of truth: docs/design/RESPONSIVE-SPEC.md sections 1-2 and
 * docs/specs/SCANNER-SPEC.md section 4.2 (`viewportProfiles`).
 *
 * Adds a `responsive_captures` table holding ONE row per (scan, page, viewport
 * profile): the emulated profile's dimensions, the detected CSS media-query
 * breakpoints, a bounded visible-element map, and the path to the full-page
 * screenshot on disk. `001`-`005` are never edited (their recorded checksums
 * must stay stable).
 *
 * Screenshots are written to the project's storage path, not into SQLite, so the
 * database stays small; only the relative path + dimensions are stored here.
 * The element map is JSON text (bounded by the worker before it is written).
 */
import type { Migration } from './types';

const UP = `
CREATE TABLE IF NOT EXISTS responsive_captures (
  id TEXT PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES scan_pages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  profile TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  device_scale_factor REAL NOT NULL,
  is_mobile INTEGER NOT NULL DEFAULT 0,
  has_touch INTEGER NOT NULL DEFAULT 0,
  screenshot_path TEXT,
  detected_breakpoints TEXT NOT NULL DEFAULT '[]',
  element_map TEXT NOT NULL DEFAULT '[]',
  truncated INTEGER NOT NULL DEFAULT 0,
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_responsive_captures_page_profile
  ON responsive_captures(page_id, profile);
CREATE INDEX IF NOT EXISTS idx_responsive_captures_scan_id
  ON responsive_captures(scan_id);
`;

export const MIGRATION_006_RESPONSIVE_CAPTURES: Migration = {
  version: 6,
  name: 'responsive_captures',
  sql: UP
};
