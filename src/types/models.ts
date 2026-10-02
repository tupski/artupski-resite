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
import type { PageAuthStatus } from '../services/auth/types';

export type ProjectStatus =
  'idle' | 'scanning' | 'blueprint_ready' | 'generating' | 'completed' | 'error';

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
  /** Auth classification of this page (migration 005; null on legacy rows). */
  authStatus: PageAuthStatus | null;
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
  /**
   * On-disk path to the page's captured raw HTML (migration 007), or null when
   * the page's HTML was never captured. The clone engine reads from here rather
   * than reconstructing markup from metadata.
   */
  rawHtmlPath: string | null;
}

/** One matched signal persisted with a detection (Phase 5). */
export interface ScanTechnologyEvidence {
  vector: string;
  evidence: string;
  weight: number;
}

/**
 * A detected technology persisted by Phase 5. Extends the Phase 2 `ScanTechnology`
 * shape with the detection metadata required by
 * docs/specs/TECHNOLOGY-DETECTION.md section 4.3. `technologyId`, the status
 * fields, `evidence`, and `pages` are null/empty for rows written before
 * migration 003.
 */
export interface ScanTechnology {
  id: string;
  scanId: string;
  /** Stable rule id, e.g. `nextjs`. Null for pre-Phase-5 rows. */
  technologyId: string | null;
  category: string;
  name: string;
  version: string | null;
  /** `detected` | `probable` | `unknown`; null for pre-Phase-5 rows. */
  confidenceStatus: string | null;
  confidence: number;
  /** `exact` | `major_only` | `unavailable`; null for pre-Phase-5 rows. */
  versionStatus: string | null;
  detectionSource: string;
  evidence: ScanTechnologyEvidence[];
  pages: string[];
  limitation: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

/** Asset kinds persisted in `scan_assets` (migration 007). */
export type CloneAssetType =
  | 'image'
  | 'stylesheet'
  | 'script'
  | 'font'
  | 'video'
  | 'audio'
  | 'document'
  | 'other';

/**
 * A downloaded clone asset (migration 007). Mirrors the `scan_assets` table:
 * the source URL it was captured from, the local path inside the clone tree,
 * its MIME type / byte size / SHA-256 (the de-duplication key), and the kind.
 * The bytes themselves live on disk, never in SQLite.
 */
export interface CloneAsset {
  id: string;
  scanId: string;
  pageId: string | null;
  /** URL of the page the asset was discovered on (nullable for legacy rows). */
  pageUrl: string | null;
  sourceUrl: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  assetType: CloneAssetType;
  createdAt: string;
}

/** One anchor node's layout at a captured viewport (RESPONSIVE-SPEC section 2.1). */
export interface ResponsiveElementNode {
  key: string;
  tagName: string;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  display: string;
  fontSize: number;
}

/**
 * A responsive viewport capture (migration 006). One row per (page, profile):
 * the emulated dimensions, detected media-query breakpoints, a bounded visible
 * element map, and the on-disk path to the full-page screenshot. The screenshot
 * itself is NOT stored in SQLite.
 */
export interface ResponsiveCapture {
  id: string;
  scanId: string;
  pageId: string;
  url: string;
  profile: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  screenshotPath: string | null;
  detectedBreakpoints: number[];
  elementMap: ResponsiveElementNode[];
  truncated: boolean;
  capturedAt: string;
}

/**
 * A captured authentication session (migration 004). The encrypted envelope is
 * split into `ciphertext`/`iv`/`authTag` (Base64) plus the per-project `salt`
 * needed to re-derive the key. NO plaintext cookie value or storage state is
 * ever present on this shape.
 */
export interface AuthSession {
  id: string;
  projectId: string;
  /** Capture mechanism; the interactive flow is the only one implemented. */
  authType: 'cookie' | 'bearer_token' | 'basic_auth' | 'session_storage' | 'interactive';
  sessionName: string;
  targetDomain: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  cookieCount: number;
  originCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
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
