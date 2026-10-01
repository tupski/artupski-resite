/**
 * Migration 005 - Per-page authentication classification - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md section 3.2 and
 * docs/specs/SCANNER-SPEC.md section 3 (`ScannedPageModel.authStatus`).
 *
 * Adds a single nullable `auth_status` column to the existing `scan_pages`
 * table. `001`-`004` are never edited (their recorded checksums must stay
 * stable).
 *
 * The column is nullable and NOT constrained by a CHECK so that:
 *   - historical rows (written before this phase) stay valid with a NULL value;
 *   - a future taxonomy extension does not require rewriting the table.
 * The values written are validated in TypeScript against `PAGE_AUTH_STATUSES`.
 *
 * Only the classification string is stored. No cookie value, token, or header
 * credential is ever written to `scan_pages`.
 */
import type { Migration } from './types';

const UP = `
ALTER TABLE scan_pages ADD COLUMN auth_status TEXT;

CREATE INDEX IF NOT EXISTS idx_scan_pages_auth_status ON scan_pages(auth_status);
`;

export const MIGRATION_005_SCAN_PAGE_AUTH: Migration = {
  version: 5,
  name: 'scan_page_auth',
  sql: UP
};
