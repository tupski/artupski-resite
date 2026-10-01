/**
 * Scan repository - Artupski ReSite
 *
 * Lifecycle state only: creating/reading/updating a scan record. There is no
 * crawling here and no fabricated results - counters default to 0 and
 * `completed_at` stays null until a terminal status is set.
 */
import type { Scan, ScanStatus } from '../../../types/models';
import type { StorageContext } from '../context';
import { toScan, type CreateScanInput, type ScanRow } from '../types';

const COLUMNS =
  'id, project_id, status, depth_limit, page_limit, pages_discovered, pages_scanned, assets_downloaded, started_at, completed_at, error_details';

const TERMINAL_STATUSES: ReadonlySet<ScanStatus> = new Set(['completed', 'failed', 'cancelled']);

export interface UpdateScanStatusInput {
  status: ScanStatus;
  errorDetails?: string | null;
}

export class ScanRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  async create(input: CreateScanInput): Promise<Scan> {
    const db = this.context.getDatabase();
    const id = crypto.randomUUID();
    db.run(
      'INSERT INTO scans (id, project_id, status, depth_limit, page_limit) VALUES (?, ?, ?, ?, ?);',
      [
        id,
        input.projectId,
        input.status ?? 'pending',
        input.depthLimit ?? 3,
        input.pageLimit ?? 50
      ]
    );
    const row = db.get<ScanRow>(`SELECT ${COLUMNS} FROM scans WHERE id = ?;`, [id]);
    await this.context.persist();
    return toScan(row as ScanRow);
  }

  async getById(id: string): Promise<Scan | null> {
    const row = this.context
      .getDatabase()
      .get<ScanRow>(`SELECT ${COLUMNS} FROM scans WHERE id = ?;`, [id]);
    return row ? toScan(row) : null;
  }

  async listByProject(projectId: string): Promise<Scan[]> {
    const rows = this.context
      .getDatabase()
      .all<ScanRow>(
        `SELECT ${COLUMNS} FROM scans WHERE project_id = ? ORDER BY started_at DESC;`,
        [projectId]
      );
    return rows.map(toScan);
  }

  async updateStatus(id: string, input: UpdateScanStatusInput): Promise<Scan | null> {
    const db = this.context.getDatabase();
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }

    const assignments = ['status = ?'];
    const params: (string | number | Uint8Array | null)[] = [input.status];

    if (input.errorDetails !== undefined) {
      assignments.push('error_details = ?');
      params.push(input.errorDetails);
    }

    // Terminal states stamp completion; re-opening to a non-terminal state
    // clears it so the record never implies a finished run that is still going.
    if (TERMINAL_STATUSES.has(input.status)) {
      assignments.push('completed_at = CURRENT_TIMESTAMP');
    } else {
      assignments.push('completed_at = NULL');
    }

    params.push(id);
    db.run(`UPDATE scans SET ${assignments.join(', ')} WHERE id = ?;`, params);
    await this.context.persist();
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM scans WHERE id = ?;', [id]);
    if (result.changes > 0) {
      await this.context.persist();
      return true;
    }
    return false;
  }
}
