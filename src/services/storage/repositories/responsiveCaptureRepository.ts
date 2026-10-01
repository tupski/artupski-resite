/**
 * Responsive capture repository - Artupski ReSite
 *
 * Typed persistence for responsive viewport captures (`responsive_captures`,
 * migration 006). The responsive phase owns this table; it is written by the
 * responsive scanner service and read back to render the viewport gallery.
 *
 * Only the screenshot PATH is stored here - the PNG itself lives on disk under
 * the project's storage path. The element map and breakpoint list are JSON text,
 * already bounded by the worker before they reach this layer.
 */
import type { ResponsiveCapture, ResponsiveElementNode } from '../../../types/models';
import type { StorageContext } from '../context';
import type { ResponsiveCaptureRow } from '../types';

const COLUMNS =
  'id, scan_id, page_id, url, profile, width, height, device_scale_factor, is_mobile, has_touch, ' +
  'screenshot_path, detected_breakpoints, element_map, truncated, captured_at';

export interface UpsertResponsiveCaptureInput {
  id?: string;
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
}

/** Parse a JSON text column, returning a safe default on malformed content. */
function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toResponsiveCapture(row: ResponsiveCaptureRow): ResponsiveCapture {
  return {
    id: row.id,
    scanId: row.scan_id,
    pageId: row.page_id,
    url: row.url,
    profile: row.profile,
    width: row.width,
    height: row.height,
    deviceScaleFactor: row.device_scale_factor,
    isMobile: row.is_mobile === 1,
    hasTouch: row.has_touch === 1,
    screenshotPath: row.screenshot_path,
    detectedBreakpoints: parseJson<number[]>(row.detected_breakpoints, []),
    elementMap: parseJson<ResponsiveElementNode[]>(row.element_map, []),
    truncated: row.truncated === 1,
    capturedAt: row.captured_at
  };
}

export class ResponsiveCaptureRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  /**
   * Insert or replace the capture for one (page, profile). A single page can be
   * captured at most once per profile, so re-running replaces the prior row
   * rather than accumulating duplicates.
   */
  async upsert(input: UpsertResponsiveCaptureInput): Promise<ResponsiveCapture> {
    const db = this.context.getDatabase();
    const id = input.id ?? crypto.randomUUID();
    db.run(
      `INSERT INTO responsive_captures (
        id, scan_id, page_id, url, profile, width, height, device_scale_factor, is_mobile,
        has_touch, screenshot_path, detected_breakpoints, element_map, truncated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_id, profile) DO UPDATE SET
        scan_id = excluded.scan_id,
        url = excluded.url,
        width = excluded.width,
        height = excluded.height,
        device_scale_factor = excluded.device_scale_factor,
        is_mobile = excluded.is_mobile,
        has_touch = excluded.has_touch,
        screenshot_path = excluded.screenshot_path,
        detected_breakpoints = excluded.detected_breakpoints,
        element_map = excluded.element_map,
        truncated = excluded.truncated;`,
      [
        id,
        input.scanId,
        input.pageId,
        input.url,
        input.profile,
        input.width,
        input.height,
        input.deviceScaleFactor,
        input.isMobile ? 1 : 0,
        input.hasTouch ? 1 : 0,
        input.screenshotPath,
        JSON.stringify(input.detectedBreakpoints),
        JSON.stringify(input.elementMap),
        input.truncated ? 1 : 0
      ]
    );
    const row = db.get<ResponsiveCaptureRow>(
      `SELECT ${COLUMNS} FROM responsive_captures WHERE page_id = ? AND profile = ? LIMIT 1;`,
      [input.pageId, input.profile]
    );
    await this.context.persist();
    return toResponsiveCapture(row as ResponsiveCaptureRow);
  }

  /** All captures for a scan, ordered by page then profile for stable rendering. */
  async listByScan(scanId: string): Promise<ResponsiveCapture[]> {
    return this.context
      .getDatabase()
      .all<ResponsiveCaptureRow>(
        `SELECT ${COLUMNS} FROM responsive_captures WHERE scan_id = ? ORDER BY url ASC, width ASC;`,
        [scanId]
      )
      .map(toResponsiveCapture);
  }

  /** All captures for a single page (one per profile). */
  async listByPage(pageId: string): Promise<ResponsiveCapture[]> {
    return this.context
      .getDatabase()
      .all<ResponsiveCaptureRow>(
        `SELECT ${COLUMNS} FROM responsive_captures WHERE page_id = ? ORDER BY width ASC;`,
        [pageId]
      )
      .map(toResponsiveCapture);
  }

  async countByScan(scanId: string): Promise<number> {
    const row = this.context
      .getDatabase()
      .get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM responsive_captures WHERE scan_id = ?;',
        [scanId]
      );
    return row?.count ?? 0;
  }

  /** Remove every capture for a scan (used when a scan is re-run). */
  async deleteByScan(scanId: string): Promise<number> {
    const db = this.context.getDatabase();
    const before = await this.countByScan(scanId);
    db.run('DELETE FROM responsive_captures WHERE scan_id = ?;', [scanId]);
    await this.context.persist();
    return before;
  }
}
