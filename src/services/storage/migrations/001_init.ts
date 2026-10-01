/**
 * Migration 001 - Phase 2 initial schema - Artupski ReSite
 *
 * Creates exactly the tables in scope for Phase 2, quoted from
 * docs/architecture/DATABASE.md section 3:
 *
 * - `projects`, `scans`, `scan_technologies` (from DATABASE.md).
 * - `app_settings` - an addition introduced by PLAN.md Phase 2 ("settings");
 *   not present in the DATABASE.md table list, recorded as a documented addition.
 *
 * Deferred to later phases (intentionally NOT created here, not omitted by
 * accident): `scan_pages`, `scan_assets`, `blueprints`, `auth_sessions`.
 * `schema_migrations` is created by the migration runner itself, not here.
 *
 * Statements use `IF NOT EXISTS` defensively, but migration *tracking* (not
 * idempotent DDL) is what makes repeated runs safe - see `migrations/index.ts`.
 */
import type { Migration } from './types';

const UP = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'scanning', 'blueprint_ready', 'generating', 'completed', 'error')),
  storage_path TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  depth_limit INTEGER NOT NULL DEFAULT 3,
  page_limit INTEGER NOT NULL DEFAULT 50,
  pages_discovered INTEGER NOT NULL DEFAULT 0,
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  assets_downloaded INTEGER NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  error_details TEXT
);

CREATE TABLE IF NOT EXISTS scan_technologies (
  id TEXT PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  detection_source TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);
CREATE INDEX IF NOT EXISTS idx_scans_project_id ON scans(project_id);
CREATE INDEX IF NOT EXISTS idx_scan_tech_scan_id ON scan_technologies(scan_id);
`;

export const MIGRATION_001_INIT: Migration = {
  version: 1,
  name: 'init',
  sql: UP
};
