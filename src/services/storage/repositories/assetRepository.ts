/**
 * Clone asset repository - Artupski ReSite
 *
 * Typed persistence for downloaded clone assets (`scan_assets`, migration 007).
 * Phase 8 owns this table; it is written by the clone service and read back to
 * render the clone panel. The asset BYTES live on disk inside the sandboxed
 * clone tree - only the local path + bounded metadata are stored here, so the
 * database stays small.
 *
 * Bounded writes: `upsertMany` writes a batch inside a single transaction and
 * persists once. The `(scan_id, sha256)` unique index de-duplicates identical
 * payloads to one physical file (DATABASE.md section 6 retention rule).
 */
import type { CloneAsset } from '../../../types/models';
import type { StorageContext } from '../context';
import type { ScanAssetRow, UpsertCloneAssetInput } from '../types';
import { toCloneAsset } from '../types';

const COLUMNS =
  'id, scan_id, page_id, page_url, source_url, local_path, mime_type, size_bytes, sha256, ' +
  'asset_type, created_at';

const UPSERT_SQL = `INSERT INTO scan_assets (
  id, scan_id, page_id, page_url, source_url, local_path, mime_type, size_bytes, sha256, asset_type
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(scan_id, sha256) DO UPDATE SET
  source_url = excluded.source_url,
  local_path = excluded.local_path,
  page_id = COALESCE(scan_assets.page_id, excluded.page_id),
  page_url = COALESCE(scan_assets.page_url, excluded.page_url);`;

export class AssetRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  /**
   * Upsert a batch of assets inside one transaction and persist once. An asset
   * whose SHA-256 already exists for the scan updates its row instead of
   * duplicating the payload.
   */
  async upsertMany(inputs: UpsertCloneAssetInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const db = this.context.getDatabase();
    db.transaction(() => {
      for (const input of inputs) {
        db.run(UPSERT_SQL, [
          input.id ?? crypto.randomUUID(),
          input.scanId,
          input.pageId,
          input.pageUrl,
          input.sourceUrl,
          input.localPath,
          input.mimeType,
          input.sizeBytes,
          input.sha256,
          input.assetType
        ]);
      }
    });
    await this.context.persist();
    return inputs.length;
  }

  async upsert(input: UpsertCloneAssetInput): Promise<void> {
    await this.upsertMany([input]);
  }

  async getById(id: string): Promise<CloneAsset | null> {
    const row = this.context
      .getDatabase()
      .get<ScanAssetRow>(`SELECT ${COLUMNS} FROM scan_assets WHERE id = ?;`, [id]);
    return row ? toCloneAsset(row) : null;
  }

  /** All assets captured for a scan, in insertion order. */
  async listByScan(scanId: string): Promise<CloneAsset[]> {
    return this.context
      .getDatabase()
      .all<ScanAssetRow>(
        `SELECT ${COLUMNS} FROM scan_assets WHERE scan_id = ? ORDER BY created_at ASC, rowid ASC;`,
        [scanId]
      )
      .map(toCloneAsset);
  }

  async listByPage(pageId: string): Promise<CloneAsset[]> {
    return this.context
      .getDatabase()
      .all<ScanAssetRow>(
        `SELECT ${COLUMNS} FROM scan_assets WHERE page_id = ? ORDER BY created_at ASC, rowid ASC;`,
        [pageId]
      )
      .map(toCloneAsset);
  }

  async countByScan(scanId: string): Promise<number> {
    const row = this.context
      .getDatabase()
      .get<{ count: number }>('SELECT COUNT(*) AS count FROM scan_assets WHERE scan_id = ?;', [
        scanId
      ]);
    return row?.count ?? 0;
  }

  /** Remove every asset row for a scan (used when a scan is re-run). */
  async deleteByScan(scanId: string): Promise<number> {
    const db = this.context.getDatabase();
    const before = await this.countByScan(scanId);
    db.run('DELETE FROM scan_assets WHERE scan_id = ?;', [scanId]);
    await this.context.persist();
    return before;
  }
}
