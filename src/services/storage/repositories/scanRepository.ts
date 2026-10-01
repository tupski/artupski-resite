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

/** States in which a scan is considered live (owns a worker / must be cleaned up). */
const ACTIVE_STATUSES: readonly ScanStatus[] = ['pending', 'in_progress'];

export interface UpdateScanStatusInput {
  status: ScanStatus;
  errorDetails?: string | null;
}

/** Monotonic counters updated as a crawl makes progress. */
export interface UpdateScanProgressInput {
  pagesDiscovered?: number;
  pagesScanned?: number;
  assetsDownloaded?: number;
}

export class ScanRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  async create(input: CreateScanInput): Promise<Scan> {
    const db = this.context.getDatabase();
    const id = input.id ?? crypto.randomUUID();
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

  /**
   * Persist progress counters. Only the supplied counters are written, so a
   * caller cannot accidentally reset one it does not own. Counters are clamped
   * to non-negative integers to keep the record honest under retries.
   */
  async updateProgress(id: string, input: UpdateScanProgressInput): Promise<Scan | null> {
    const db = this.context.getDatabase();
    const assignments: string[] = [];
    const params: (string | number | Uint8Array | null)[] = [];

    const clamp = (value: number): number => Math.max(0, Math.floor(value));
    if (input.pagesDiscovered !== undefined) {
      assignments.push('pages_discovered = ?');
      params.push(clamp(input.pagesDiscovered));
    }
    if (input.pagesScanned !== undefined) {
      assignments.push('pages_scanned = ?');
      params.push(clamp(input.pagesScanned));
    }
    if (input.assetsDownloaded !== undefined) {
      assignments.push('assets_downloaded = ?');
      params.push(clamp(input.assetsDownloaded));
    }
    if (assignments.length === 0) {
      return this.getById(id);
    }

    params.push(id);
    const result = db.run(`UPDATE scans SET ${assignments.join(', ')} WHERE id = ?;`, params);
    if (result.changes === 0) {
      return null;
    }
    await this.context.persist();
    return this.getById(id);
  }

  /** Scans for a project that are still live (pending/in_progress). */
  async findActiveByProject(projectId: string): Promise<Scan[]> {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const rows = this.context
      .getDatabase()
      .all<ScanRow>(
        `SELECT ${COLUMNS} FROM scans WHERE project_id = ? AND status IN (${placeholders}) ORDER BY started_at ASC;`,
        [projectId, ...ACTIVE_STATUSES]
      );
    return rows.map(toScan);
  }

  /** Every live scan across all projects (used to enforce one crawl at a time). */
  async findActive(): Promise<Scan[]> {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const rows = this.context
      .getDatabase()
      .all<ScanRow>(
        `SELECT ${COLUMNS} FROM scans WHERE status IN (${placeholders}) ORDER BY started_at ASC;`,
        [...ACTIVE_STATUSES]
      );
    return rows.map(toScan);
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
