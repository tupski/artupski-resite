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
import type {
  AppSetting,
  Project,
  ProjectStatus,
  Scan,
  ScanPage,
  ScanPageHeading,
  ScanPageImage,
  ScanPageStatus,
  ScanStatus,
  ScanTechnology,
  ScanTechnologyEvidence
} from '../../types/models';

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

/** Raw `scan_pages` row shape as returned by sql.js (migration 002). */
export interface ScanPageRow {
  id: string;
  scan_id: string;
  url: string;
  final_url: string;
  path: string;
  depth: number;
  http_status: number | null;
  title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  robots_meta: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  load_time_ms: number | null;
  dom_content_loaded_time_ms: number | null;
  dom_node_count: number | null;
  headings: string | null;
  internal_links: string | null;
  external_links: string | null;
  images: string | null;
  warnings: string | null;
  captured_at: string;
  created_at: string;
}

/** Raw `scan_technologies` row shape as returned by sql.js (migration 003 adds columns). */
export interface ScanTechnologyRow {
  id: string;
  scan_id: string;
  technology_id: string | null;
  category: string;
  name: string;
  version: string | null;
  confidence_status: string | null;
  confidence: number;
  version_status: string | null;
  detection_source: string;
  evidence: string | null;
  pages: string | null;
  limitation: string | null;
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

/** Parse a JSON text column into a bounded array, tolerating a null/corrupt value. */
function parseJsonArray<T>(value: string | null): T[] {
  if (value === null || value.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // A corrupt JSON column must never break a read; surface an empty list.
    return [];
  }
}

export function toScanPage(row: ScanPageRow): ScanPage {
  return {
    id: row.id,
    scanId: row.scan_id,
    url: row.url,
    finalUrl: row.final_url,
    path: row.path,
    depth: row.depth,
    httpStatus: row.http_status,
    title: row.title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    robotsMeta: row.robots_meta,
    status: row.status as ScanPageStatus,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    loadTimeMs: row.load_time_ms,
    domContentLoadedTimeMs: row.dom_content_loaded_time_ms,
    domNodeCount: row.dom_node_count,
    headings: parseJsonArray<ScanPageHeading>(row.headings),
    internalLinks: parseJsonArray<string>(row.internal_links),
    externalLinks: parseJsonArray<string>(row.external_links),
    images: parseJsonArray<ScanPageImage>(row.images),
    warnings: parseJsonArray<string>(row.warnings),
    capturedAt: row.captured_at,
    createdAt: row.created_at
  };
}

export function toScanTechnology(row: ScanTechnologyRow): ScanTechnology {
  return {
    id: row.id,
    scanId: row.scan_id,
    technologyId: row.technology_id,
    category: row.category,
    name: row.name,
    version: row.version,
    confidenceStatus: row.confidence_status,
    confidence: row.confidence,
    versionStatus: row.version_status,
    detectionSource: row.detection_source,
    evidence: parseJsonArray<ScanTechnologyEvidence>(row.evidence),
    pages: parseJsonArray<string>(row.pages),
    limitation: row.limitation,
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
  /**
   * Optional caller-supplied id. The crawler service generates this so the scan
   * id is known (and can be subscribed to) before the row is written; the
   * repository falls back to `crypto.randomUUID()`.
   */
  id?: string;
}

/** A page result ready to persist. `url` is the canonical dedupe key per scan. */
export interface UpsertScanPageInput {
  scanId: string;
  url: string;
  finalUrl: string;
  path: string;
  depth: number;
  httpStatus: number | null;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  status: ScanPageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  loadTimeMs: number | null;
  domContentLoadedTimeMs: number | null;
  domNodeCount: number | null;
  headings: ScanPageHeading[];
  internalLinks: string[];
  externalLinks: string[];
  images: ScanPageImage[];
  warnings: string[];
  capturedAt: string;
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

/** A Phase 5 detection result ready to persist (upsert key: scanId+technologyId). */
export interface UpsertScanTechnologyInput {
  scanId: string;
  technologyId: string;
  category: string;
  name: string;
  version: string | null;
  confidence: number;
  confidenceStatus: string;
  versionStatus: string;
  detectionSource: string;
  evidence: ScanTechnologyEvidence[];
  pages: string[];
  limitation: string | null;
}
