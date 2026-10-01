/**
 * Scan page repository - Artupski ReSite
 *
 * Typed persistence for crawled page results (`scan_pages`, migration 002).
 * Phase 4 owns this table; it is written by the crawler application service and
 * read back for inspection. Raw extraction evidence never reaches here - only
 * the bounded, normalized `ScanPage` shape does.
 *
 * Bounded writes: `upsertMany` inserts/updates a batch inside a single
 * transaction and persists the database once, so a crawl with many pages does
 * not trigger one full-database export per page.
 */
import type { ScanPage, ScanPageStatus } from '../../../types/models';
import type { StorageContext } from '../context';
import { toScanPage, type ScanPageRow, type UpsertScanPageInput } from '../types';

const COLUMNS =
  'id, scan_id, url, final_url, path, depth, http_status, title, meta_description, canonical_url, ' +
  'robots_meta, status, error_code, error_message, load_time_ms, dom_content_loaded_time_ms, ' +
  'dom_node_count, headings, internal_links, external_links, images, warnings, captured_at, created_at';

const VALID_STATUSES: ReadonlySet<ScanPageStatus> = new Set(['completed', 'failed', 'timeout', 'skipped']);

/** Derive the indexable URL path; invalid URLs fall back to the raw string. */
export function pathForUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function toParams(input: UpsertScanPageInput): (string | number | null)[] {
  return [
    input.scanId,
    input.url,
    input.finalUrl,
    input.path,
    input.depth,
    input.httpStatus,
    input.title,
    input.metaDescription,
    input.canonicalUrl,
    input.robotsMeta,
    input.status,
    input.errorCode,
    input.errorMessage,
    input.loadTimeMs,
    input.domContentLoadedTimeMs,
    input.domNodeCount,
    JSON.stringify(input.headings),
    JSON.stringify(input.internalLinks),
    JSON.stringify(input.externalLinks),
    JSON.stringify(input.images),
    JSON.stringify(input.warnings),
    input.capturedAt
  ];
}

const UPSERT_SQL = `INSERT INTO scan_pages (
  id, scan_id, url, final_url, path, depth, http_status, title, meta_description, canonical_url,
  robots_meta, status, error_code, error_message, load_time_ms, dom_content_loaded_time_ms,
  dom_node_count, headings, internal_links, external_links, images, warnings, captured_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(scan_id, url) DO UPDATE SET
  final_url = excluded.final_url,
  path = excluded.path,
  depth = excluded.depth,
  http_status = excluded.http_status,
  title = excluded.title,
  meta_description = excluded.meta_description,
  canonical_url = excluded.canonical_url,
  robots_meta = excluded.robots_meta,
  status = excluded.status,
  error_code = excluded.error_code,
  error_message = excluded.error_message,
  load_time_ms = excluded.load_time_ms,
  dom_content_loaded_time_ms = excluded.dom_content_loaded_time_ms,
  dom_node_count = excluded.dom_node_count,
  headings = excluded.headings,
  internal_links = excluded.internal_links,
  external_links = excluded.external_links,
  images = excluded.images,
  warnings = excluded.warnings,
  captured_at = excluded.captured_at;`;

export class ScanPageRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  /**
   * Upsert a batch of page results inside one transaction and persist once.
   * Re-visiting a URL updates its row rather than duplicating it.
   */
  async upsertMany(inputs: UpsertScanPageInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const db = this.context.getDatabase();
    db.transaction(() => {
      for (const input of inputs) {
        if (!VALID_STATUSES.has(input.status)) {
          throw new Error(`Invalid scan page status "${input.status}".`);
        }
        db.run(UPSERT_SQL, [crypto.randomUUID(), ...toParams(input)]);
      }
    });
    await this.context.persist();
    return inputs.length;
  }

  /** Convenience wrapper for a single page (still one transaction + persist). */
  async upsert(input: UpsertScanPageInput): Promise<void> {
    await this.upsertMany([input]);
  }

  async getById(id: string): Promise<ScanPage | null> {
    const row = this.context
      .getDatabase()
      .get<ScanPageRow>(`SELECT ${COLUMNS} FROM scan_pages WHERE id = ?;`, [id]);
    return row ? toScanPage(row) : null;
  }

  /** List pages for a scan in crawl order (depth, then discovery order). */
  async listByScan(scanId: string): Promise<ScanPage[]> {
    const rows = this.context
      .getDatabase()
      .all<ScanPageRow>(
        `SELECT ${COLUMNS} FROM scan_pages WHERE scan_id = ? ORDER BY depth ASC, created_at ASC, rowid ASC;`,
        [scanId]
      );
    return rows.map(toScanPage);
  }

  async countByScan(scanId: string): Promise<number> {
    const row = this.context
      .getDatabase()
      .get<{ total: number }>('SELECT COUNT(*) AS total FROM scan_pages WHERE scan_id = ?;', [scanId]);
    return row?.total ?? 0;
  }

  /** Number of persisted pages that are NOT successful (failed/timeout/skipped). */
  async countFailedByScan(scanId: string): Promise<number> {
    const row = this.context
      .getDatabase()
      .get<{ total: number }>(
        "SELECT COUNT(*) AS total FROM scan_pages WHERE scan_id = ? AND status <> 'completed';",
        [scanId]
      );
    return row?.total ?? 0;
  }

  async deleteByScan(scanId: string): Promise<number> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM scan_pages WHERE scan_id = ?;', [scanId]);
    if (result.changes > 0) {
      await this.context.persist();
    }
    return result.changes;
  }
}
