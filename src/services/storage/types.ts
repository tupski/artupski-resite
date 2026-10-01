/**
 * Storage row types and repository contracts - Artupski ReSite
 *
 * This module is the ONLY place where snake_case database rows are translated
 * into the camelCase domain types from `src/types/models.ts`. Repositories and
 * the rest of the application work exclusively with the domain types, so raw
 * column names never leak past the storage boundary.
 *
 * Timestamps: every persisted timestamp is stored with SQLite
 * `CURRENT_TIMESTAMP` (UTC, `YYYY-MM-DD HH:MM:SS`). Domain types expose those
 * strings verbatim - the application treats them as opaque UTC strings and
 * never mixes in ISO-8601 `T`/`Z` values on write.
 */
import type { AppSetting, Project, ProjectStatus, Scan, ScanStatus, ScanTechnology } from '../../types/models';

export type SqlPrimitive = string | number | Uint8Array | null;
export type SqlParams = SqlPrimitive[];

/** Raw `projects` row shape as returned by sql.js. */
export interface ProjectRow {
  id: string;
  name: string;
  target_url: string;
  status: string;
  storage_path: string;
  created_at: string;
  updated_at: string;
}

/** Raw `scans` row shape as returned by sql.js. */
export interface ScanRow {
  id: string;
  project_id: string;
  status: string;
  depth_limit: number;
  page_limit: number;
  pages_discovered: number;
  pages_scanned: number;
  assets_downloaded: number;
  started_at: string;
  completed_at: string | null;
  error_details: string | null;
}

/** Raw `scan_technologies` row shape as returned by sql.js. */
export interface ScanTechnologyRow {
  id: string;
  scan_id: string;
  category: string;
  name: string;
  version: string | null;
  confidence: number;
  detection_source: string;
  metadata: string | null;
  created_at: string;
}

/** Raw `app_settings` row shape as returned by sql.js. */
export interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

/** Raw `schema_migrations` row shape as returned by sql.js. */
export interface SchemaMigrationRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    targetUrl: row.target_url,
    status: row.status as ProjectStatus,
    storagePath: row.storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toScan(row: ScanRow): Scan {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as ScanStatus,
    depthLimit: row.depth_limit,
    pageLimit: row.page_limit,
    pagesDiscovered: row.pages_discovered,
    pagesScanned: row.pages_scanned,
    assetsDownloaded: row.assets_downloaded,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorDetails: row.error_details
  };
}

export function toScanTechnology(row: ScanTechnologyRow): ScanTechnology {
  return {
    id: row.id,
    scanId: row.scan_id,
    category: row.category,
    name: row.name,
    version: row.version,
    confidence: row.confidence,
    detectionSource: row.detection_source,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

export function toAppSetting(row: AppSettingRow): AppSetting {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at
  };
}

/* -------------------------------------------------------------------------- */
/* Repository input types                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateProjectInput {
  name: string;
  targetUrl: string;
  storagePath: string;
  status?: ProjectStatus;
  /**
   * Optional caller-supplied id. The application service generates this so the
   * id embedded in the project storage path and the row's primary key are the
   * same value; the repository falls back to `crypto.randomUUID()`.
   */
  id?: string;
}

export interface UpdateProjectInput {
  name?: string;
  targetUrl?: string;
  status?: ProjectStatus;
  storagePath?: string;
}

export interface CreateScanInput {
  projectId: string;
  status?: ScanStatus;
  depthLimit?: number;
  pageLimit?: number;
}

export interface CreateScanTechnologyInput {
  scanId: string;
  category: string;
  name: string;
  confidence: number;
  detectionSource: string;
  version?: string | null;
  metadata?: string | null;
}
