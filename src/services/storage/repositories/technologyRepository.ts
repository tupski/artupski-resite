/**
 * Scan technology repository - Artupski ReSite
 *
 * Persists detected technology rows attached to a scan. Phase 5 (detection)
 * produces the data; this repository only stores and retrieves it.
 */
import type { ScanTechnology } from '../../../types/models';
import type { StorageContext } from '../context';
import { toScanTechnology, type CreateScanTechnologyInput, type ScanTechnologyRow } from '../types';

const COLUMNS =
  'id, scan_id, category, name, version, confidence, detection_source, metadata, created_at';

export class TechnologyRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  async create(input: CreateScanTechnologyInput): Promise<ScanTechnology> {
    const db = this.context.getDatabase();
    const id = crypto.randomUUID();
    db.run(
      'INSERT INTO scan_technologies (id, scan_id, category, name, version, confidence, detection_source, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [
        id,
        input.scanId,
        input.category,
        input.name,
        input.version ?? null,
        input.confidence,
        input.detectionSource,
        input.metadata ?? null
      ]
    );
    const row = db.get<ScanTechnologyRow>(
      `SELECT ${COLUMNS} FROM scan_technologies WHERE id = ?;`,
      [id]
    );
    await this.context.persist();
    return toScanTechnology(row as ScanTechnologyRow);
  }

  async listByScan(scanId: string): Promise<ScanTechnology[]> {
    const rows = this.context
      .getDatabase()
      .all<ScanTechnologyRow>(
        `SELECT ${COLUMNS} FROM scan_technologies WHERE scan_id = ? ORDER BY category ASC, name ASC;`,
        [scanId]
      );
    return rows.map(toScanTechnology);
  }

  async delete(id: string): Promise<boolean> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM scan_technologies WHERE id = ?;', [id]);
    if (result.changes > 0) {
      await this.context.persist();
      return true;
    }
    return false;
  }
}
