/**
 * Project repository - Artupski ReSite
 *
 * Typed CRUD over the `projects` table. Returns domain `Project` objects only;
 * no SQL or row shapes escape this module. Single-row lookups return `null`
 * rather than throwing when the id is missing.
 */
import type { Project } from '../../../types/models';
import type { StorageContext } from '../context';
import { toProject, type CreateProjectInput, type ProjectRow, type UpdateProjectInput } from '../types';

const COLUMNS =
  'id, name, target_url, status, storage_path, created_at, updated_at';

export class ProjectRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const db = this.context.getDatabase();
    const id = input.id ?? crypto.randomUUID();
    const status = input.status ?? 'idle';
    db.run(
      'INSERT INTO projects (id, name, target_url, status, storage_path) VALUES (?, ?, ?, ?, ?);',
      [id, input.name, input.targetUrl, status, input.storagePath]
    );
    const row = db.get<ProjectRow>(`SELECT ${COLUMNS} FROM projects WHERE id = ?;`, [id]);
    await this.context.persist();
    return toProject(row as ProjectRow);
  }

  async getById(id: string): Promise<Project | null> {
    const row = this.context
      .getDatabase()
      .get<ProjectRow>(`SELECT ${COLUMNS} FROM projects WHERE id = ?;`, [id]);
    return row ? toProject(row) : null;
  }

  async list(): Promise<Project[]> {
    const rows = this.context
      .getDatabase()
      .all<ProjectRow>(
        `SELECT ${COLUMNS} FROM projects ORDER BY updated_at DESC, created_at DESC, rowid DESC;`
      );
    return rows.map(toProject);
  }

  async update(id: string, patch: UpdateProjectInput): Promise<Project | null> {
    const db = this.context.getDatabase();
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }

    const assignments: string[] = [];
    const params: (string | number | Uint8Array | null)[] = [];
    if (patch.name !== undefined) {
      assignments.push('name = ?');
      params.push(patch.name);
    }
    if (patch.targetUrl !== undefined) {
      assignments.push('target_url = ?');
      params.push(patch.targetUrl);
    }
    if (patch.status !== undefined) {
      assignments.push('status = ?');
      params.push(patch.status);
    }
    if (patch.storagePath !== undefined) {
      assignments.push('storage_path = ?');
      params.push(patch.storagePath);
    }

    if (assignments.length > 0) {
      assignments.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);
      db.run(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?;`, params);
      await this.context.persist();
    }

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM projects WHERE id = ?;', [id]);
    if (result.changes > 0) {
      await this.context.persist();
      return true;
    }
    return false;
  }
}
