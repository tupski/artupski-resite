/**
 * Project presentation helpers - Artupski ReSite
 *
 * Shared, presentation-only mapping between persisted domain enums and the
 * labels/tones the UI renders. Kept out of the route components so the Projects
 * list and the Project detail view cannot drift apart.
 */
import type { BadgeTone } from '../ui/Badge';
import type { ProjectStatus, ScanStatus, ScanPageStatus } from '../../types/models';

export const PROJECT_STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  idle: 'neutral',
  scanning: 'brand',
  blueprint_ready: 'brand',
  generating: 'warning',
  completed: 'success',
  error: 'danger'
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  idle: 'Idle',
  scanning: 'Scanning',
  blueprint_ready: 'Blueprint ready',
  generating: 'Generating',
  completed: 'Completed',
  error: 'Error'
};

/** Labels/tones for the persisted `scans.status` enum (distinct from UI lifecycle). */
export const SCAN_RECORD_STATUS_TONE: Record<ScanStatus, BadgeTone> = {
  pending: 'neutral',
  in_progress: 'brand',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning'
};

export const SCAN_RECORD_STATUS_LABEL: Record<ScanStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

/** Tone for a crawled page's persisted outcome. */
export const SCAN_PAGE_STATUS_TONE: Record<ScanPageStatus, BadgeTone> = {
  completed: 'success',
  failed: 'danger',
  timeout: 'warning',
  skipped: 'neutral'
};

export const SCAN_PAGE_STATUS_LABEL: Record<ScanPageStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  timeout: 'Timeout',
  skipped: 'Skipped'
};

/**
 * Human, locale-aware timestamp. Stored as SQLite `CURRENT_TIMESTAMP`
 * (UTC, "YYYY-MM-DD HH:MM:SS") or ISO-8601. A null/unparseable value renders as
 * an em dash rather than a fabricated date.
 */
export function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—';
  }
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

/** Human byte size; whole bytes below 1 KiB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
