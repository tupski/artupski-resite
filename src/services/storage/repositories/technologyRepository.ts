/**
 * Scan technology repository - Artupski ReSite
 *
 * Persists detected technology rows attached to a scan. Phase 5 (detection)
 * produces the data; this repository only stores and retrieves it. The
 * `upsertMany` path writes a whole detection report in one transaction so a scan
 * with many technologies does not trigger one full-database export per row, and
 * the `(scan_id, technology_id)` UNIQUE index keeps re-runs idempotent.
 */
import type { ScanTechnology } from '../../../types/models';
import type { StorageContext } from '../context';
import {
  toScanTechnology,
  type CreateScanTechnologyInput,
  type ScanTechnologyRow,
  type UpsertScanTechnologyInput
} from '../types';

const COLUMNS =
  'id, scan_id, technology_id, category, name, version, confidence_status, confidence, ' +
  'version_status, detection_source, evidence, pages, limitation, metadata, created_at';

const UPSERT_SQL = `INSERT INTO scan_technologies (
  id, scan_id, technology_id, category, name, version, confidence_status, confidence,
  version_status, detection_source, evidence, pages, limitation
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(scan_id, technology_id) DO UPDATE SET
  category = excluded.category,
  name = excluded.name,
  version = excluded.version,
  confidence_status = excluded.confidence_status,
  confidence = excluded.confidence,
  version_status = excluded.version_status,
  detection_source = excluded.detection_source,
  evidence = excluded.evidence,
  pages = excluded.pages,
  limitation = excluded.limitation;`;

function toUpsertParams(input: UpsertScanTechnologyInput): (string | number | null)[] {
  return [
    crypto.randomUUID(),
    input.scanId,
    input.technologyId,
    input.category,
    input.name,
    input.version,
    input.confidenceStatus,
    input.confidence,
    input.versionStatus,
    input.detectionSource,
    JSON.stringify(input.evidence),
    JSON.stringify(input.pages),
    input.limitation
  ];
}

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

  /**
   * Upsert a whole detection report in one transaction and persist once.
   * Re-running detection for a scan updates each technology's row in place.
   */
  async upsertMany(inputs: UpsertScanTechnologyInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const db = this.context.getDatabase();
    db.transaction(() => {
      for (const input of inputs) {
        db.run(UPSERT_SQL, toUpsertParams(input));
      }
    });
    await this.context.persist();
    return inputs.length;
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

  async countByScan(scanId: string): Promise<number> {
    const row = this.context
      .getDatabase()
      .get<{ total: number }>('SELECT COUNT(*) AS total FROM scan_technologies WHERE scan_id = ?;', [
        scanId
      ]);
    return row?.total ?? 0;
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

  async deleteByScan(scanId: string): Promise<number> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM scan_technologies WHERE scan_id = ?;', [scanId]);
    if (result.changes > 0) {
      await this.context.persist();
    }
    return result.changes;
  }
}
