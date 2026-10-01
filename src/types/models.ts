/**
 * Persisted domain entity types - Artupski ReSite
 *
 * These are the camelCase application-facing shapes stored in the local SQLite
 * database. They map 1:1 onto the snake_case rows defined in
 * docs/architecture/DATABASE.md section 3 via the explicit mappers in
 * `src/services/storage/types.ts` (no `any`, no implicit casts).
 *
 * Phase 2 defines only the entities whose tables exist (projects, scans,
 * scan technologies, app settings). Pages, assets, blueprints, and auth
 * sessions are deferred to later phases and are intentionally absent.
 */

export type ProjectStatus =
  | 'idle'
  | 'scanning'
  | 'blueprint_ready'
  | 'generating'
  | 'completed'
  | 'error';

export type ScanStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface Project {
  id: string;
  name: string;
  targetUrl: string;
  status: ProjectStatus;
  storagePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Scan {
  id: string;
  projectId: string;
  status: ScanStatus;
  depthLimit: number;
  pageLimit: number;
  pagesDiscovered: number;
  pagesScanned: number;
  assetsDownloaded: number;
  startedAt: string;
  /** Null until the scan reaches a terminal state. */
  completedAt: string | null;
  errorDetails: string | null;
}

/**
 * Per-page crawl outcome. Matches the `status` CHECK on `scan_pages` (migration
 * 002) and the scanner extraction `PageStatus` union (a page that could not be
 * fetched is persisted as `failed`/`timeout`/`skipped`, never as `completed`).
 */
export type ScanPageStatus = 'completed' | 'failed' | 'timeout' | 'skipped';

export interface ScanPageHeading {
  level: number;
  text: string;
}

export interface ScanPageImage {
  src: string;
  alt: string;
  internal: boolean;
}

/**
 * A single crawled page persisted by Phase 4. Mirrors the bounded, normalized
 * extraction result (`NormalizedPage`); the raw evidence never reaches storage.
 * Collection fields are small and bounded by the extraction limits, so they are
 * stored as JSON text and rehydrated by the repository.
 */
export interface ScanPage {
  id: string;
  scanId: string;
  url: string;
  finalUrl: string;
  /** Derived URL pathname, kept for cheap path-based lookups. */
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
  /** Extraction timestamp (ISO-8601), distinct from the row `createdAt`. */
  capturedAt: string;
  createdAt: string;
}

export interface ScanTechnology {
  id: string;
  scanId: string;
  category: string;
  name: string;
  version: string | null;
  confidence: number;
  detectionSource: string;
  metadata: string | null;
  createdAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'idle',
  'scanning',
  'blueprint_ready',
  'generating',
  'completed',
  'error'
];

export const SCAN_STATUSES: readonly ScanStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled'
];
