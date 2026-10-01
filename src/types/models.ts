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
