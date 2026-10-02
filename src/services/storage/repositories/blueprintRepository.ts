/**
 * Blueprint repository - Artupski ReSite
 *
 * Typed persistence for generated Blueprint documents (`blueprints`, migration
 * 008). Phase 9 owns this table; it is written by the blueprint service and read
 * back to render the Blueprint panel.
 *
 * Only the sandboxed on-disk path + validation metadata live here - the (large)
 * document itself is JSON in the blueprint tree, so the database stays small.
 * The `(scan_id, version)` unique index makes synthesis idempotent: re-running a
 * scan updates its revision rather than duplicating it.
 */
import type { Blueprint } from '../../../types/models';
import type { StorageContext } from '../context';
import type { BlueprintRow, UpsertBlueprintInput } from '../types';
import { toBlueprint } from '../types';

const COLUMNS =
  'id, project_id, scan_id, version, schema_version, file_path, is_valid, validation_errors, ' +
  'created_at, updated_at';

const UPSERT_SQL = [
  'INSERT INTO blueprints (',
  '  id, project_id, scan_id, version, schema_version, file_path, is_valid, validation_errors',
  ') VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  'ON CONFLICT(scan_id, version) DO UPDATE SET',
  '  project_id = excluded.project_id,',
  '  schema_version = excluded.schema_version,',
  '  file_path = excluded.file_path,',
  '  is_valid = excluded.is_valid,',
  '  validation_errors = excluded.validation_errors,',
  '  updated_at = CURRENT_TIMESTAMP;'
].join('\n');

export class BlueprintRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  /**
   * Insert a Blueprint record, or update the existing revision for the same
   * `(scan_id, version)`. Returns the persisted domain row. When `scan_id` is
   * null SQLite treats each NULL as distinct, so a null-scan record inserts a
   * new row (the scan-less case is not a re-run).
   */
  async upsert(input: UpsertBlueprintInput): Promise<Blueprint> {
    const db = this.context.getDatabase();
    const id = input.id ?? crypto.randomUUID();
    db.run(UPSERT_SQL, [
      id,
      input.projectId,
      input.scanId,
      input.version,
      input.schemaVersion,
      input.filePath,
      input.isValid ? 1 : 0,
      JSON.stringify(input.validationErrors)
    ]);
    const row = db.get<BlueprintRow>(
      input.scanId === null
        ? `SELECT ${COLUMNS} FROM blueprints WHERE id = ? LIMIT 1;`
        : `SELECT ${COLUMNS} FROM blueprints WHERE scan_id = ? AND version = ? LIMIT 1;`,
      input.scanId === null ? [id] : [input.scanId, input.version]
    );
    await this.context.persist();
    return toBlueprint(row as BlueprintRow);
  }

  async getById(id: string): Promise<Blueprint | null> {
    const row = this.context
      .getDatabase()
      .get<BlueprintRow>(`SELECT ${COLUMNS} FROM blueprints WHERE id = ?;`, [id]);
    return row ? toBlueprint(row) : null;
  }

  /** All revisions for a project, newest revision first. */
  async listByProject(projectId: string): Promise<Blueprint[]> {
    return this.context
      .getDatabase()
      .all<BlueprintRow>(
        `SELECT ${COLUMNS} FROM blueprints WHERE project_id = ? ORDER BY version DESC, created_at DESC, rowid DESC;`,
        [projectId]
      )
      .map(toBlueprint);
  }

  /** All revisions generated for a scan, newest revision first. */
  async listByScan(scanId: string): Promise<Blueprint[]> {
    return this.context
      .getDatabase()
      .all<BlueprintRow>(
        `SELECT ${COLUMNS} FROM blueprints WHERE scan_id = ? ORDER BY version DESC, created_at DESC, rowid DESC;`,
        [scanId]
      )
      .map(toBlueprint);
  }

  /** The highest-revision Blueprint for a scan, or null when none exists. */
  async getLatestByScan(scanId: string): Promise<Blueprint | null> {
    const row = this.context
      .getDatabase()
      .get<BlueprintRow>(
        `SELECT ${COLUMNS} FROM blueprints WHERE scan_id = ? ORDER BY version DESC, created_at DESC, rowid DESC LIMIT 1;`,
        [scanId]
      );
    return row ? toBlueprint(row) : null;
  }

  async countByScan(scanId: string): Promise<number> {
    const row = this.context
      .getDatabase()
      .get<{ count: number }>('SELECT COUNT(*) AS count FROM blueprints WHERE scan_id = ?;', [
        scanId
      ]);
    return row?.count ?? 0;
  }

  /** Delete one Blueprint record. Returns true when a row was removed. */
  async deleteById(id: string): Promise<boolean> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM blueprints WHERE id = ?;', [id]);
    if (result.changes > 0) {
      await this.context.persist();
    }
    return result.changes > 0;
  }

  /** Remove every Blueprint record for a scan (used when a scan is re-run). */
  async deleteByScan(scanId: string): Promise<number> {
    const db = this.context.getDatabase();
    const before = await this.countByScan(scanId);
    if (before > 0) {
      db.run('DELETE FROM blueprints WHERE scan_id = ?;', [scanId]);
      await this.context.persist();
    }
    return before;
  }

  /**
   * Remove every Blueprint record for a project. Usually redundant (the FK
   * cascade handles project deletion) but exposed for an explicit reset.
   */
  async deleteByProject(projectId: string): Promise<number> {
    const db = this.context.getDatabase();
    const before = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM blueprints WHERE project_id = ?;',
      [projectId]
    )?.count;
    if ((before ?? 0) > 0) {
      db.run('DELETE FROM blueprints WHERE project_id = ?;', [projectId]);
      await this.context.persist();
    }
    return before ?? 0;
  }
}
