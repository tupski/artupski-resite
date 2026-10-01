/**
 * Auth session repository - Artupski ReSite
 *
 * Typed persistence for captured authentication sessions (`auth_sessions`,
 * migration 004). The authentication phase owns this table; it is written by
 * the auth session service and read back only to inject a session into a crawl
 * or to clear it.
 *
 * SECRET HANDLING: every value this repository stores is already ciphertext
 * (AES-256-GCM). It never sees, logs, or returns plaintext cookies. Deleting a
 * record is a cryptographic deletion: the ciphertext (and the only useful copy
 * of the bearer material) is gone.
 *
 * Isolation guarantees:
 *  - `saveSession` deactivates any existing active session for the project first,
 *    in one transaction, so the partial unique index
 *    (`idx_auth_sessions_project_active`) is never violated and one scan cannot
 *    inherit a previous session's state.
 *  - `findActive` returns exactly the active session for a project (or null), so
 *    a scan never touches another project's session.
 *  - `purgeExpired` implements the spec's pre-crawl auto-expiry purge.
 */
import type { AuthSession } from '../../../types/models';
import type { StorageContext } from '../context';
import { toAuthSession, type AuthSessionRow, type CreateAuthSessionInput } from '../types';

const COLUMNS =
  'id, project_id, auth_type, session_name, target_domain, ciphertext, iv, auth_tag, salt, ' +
  'cookie_count, origin_count, is_active, expires_at, created_at';

export class AuthSessionRepository {
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  /**
   * Persist a captured session and make it the single active session for its
   * project. Any previously active session is deactivated first.
   */
  async saveSession(input: CreateAuthSessionInput): Promise<AuthSession> {
    const db = this.context.getDatabase();
    const id = input.id ?? crypto.randomUUID();
    db.transaction(() => {
      db.run('UPDATE auth_sessions SET is_active = 0 WHERE project_id = ? AND is_active = 1;', [
        input.projectId
      ]);
      db.run(
        `INSERT INTO auth_sessions (
          id, project_id, auth_type, session_name, target_domain, ciphertext, iv, auth_tag, salt,
          cookie_count, origin_count, is_active, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?);`,
        [
          id,
          input.projectId,
          input.authType,
          input.sessionName,
          input.targetDomain,
          input.ciphertext,
          input.iv,
          input.authTag,
          input.salt,
          input.cookieCount,
          input.originCount,
          input.expiresAt
        ]
      );
    });
    const row = db.get<AuthSessionRow>(`SELECT ${COLUMNS} FROM auth_sessions WHERE id = ?;`, [id]);
    await this.context.persist();
    return toAuthSession(row as AuthSessionRow);
  }

  /** The active session for a project, or null. Never another project's. */
  async findActive(projectId: string): Promise<AuthSession | null> {
    const row = this.context
      .getDatabase()
      .get<AuthSessionRow>(
        `SELECT ${COLUMNS} FROM auth_sessions WHERE project_id = ? AND is_active = 1 LIMIT 1;`,
        [projectId]
      );
    return row ? toAuthSession(row) : null;
  }

  async getById(id: string): Promise<AuthSession | null> {
    const row = this.context
      .getDatabase()
      .get<AuthSessionRow>(`SELECT ${COLUMNS} FROM auth_sessions WHERE id = ?;`, [id]);
    return row ? toAuthSession(row) : null;
  }

  async listByProject(projectId: string): Promise<AuthSession[]> {
    const rows = this.context
      .getDatabase()
      .all<AuthSessionRow>(
        `SELECT ${COLUMNS} FROM auth_sessions WHERE project_id = ? ORDER BY created_at DESC;`,
        [projectId]
      );
    return rows.map(toAuthSession);
  }

  /** Cryptographic deletion of every session for a project ("Clear Session"). */
  async deleteByProject(projectId: string): Promise<number> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM auth_sessions WHERE project_id = ?;', [projectId]);
    if (result.changes > 0) {
      await this.context.persist();
    }
    return result.changes;
  }

  async deleteById(id: string): Promise<number> {
    const db = this.context.getDatabase();
    const result = db.run('DELETE FROM auth_sessions WHERE id = ?;', [id]);
    if (result.changes > 0) {
      await this.context.persist();
    }
    return result.changes;
  }

  /**
   * Delete records whose `expires_at` is in the past. Called before a crawl so
   * an expired session is never injected. `nowMs` defaults to the current time
   * and is injectable for deterministic tests.
   */
  async purgeExpired(nowMs: number = Date.now()): Promise<number> {
    const db = this.context.getDatabase();
    // `expires_at` is written as an ISO-8601 UTC string (from cookie expiry), so
    // the cutoff uses the identical format; lexicographic ordering is correct.
    const cutoff = new Date(nowMs).toISOString();
    const result = db.run(
      'DELETE FROM auth_sessions WHERE expires_at IS NOT NULL AND expires_at <= ?;',
      [cutoff]
    );
    if (result.changes > 0) {
      await this.context.persist();
    }
    return result.changes;
  }

  /** True when the session's `expires_at` is in the past. */
  isExpired(session: AuthSession, nowMs: number = Date.now()): boolean {
    if (!session.expiresAt) {
      return false;
    }
    const parsed = Date.parse(
      session.expiresAt.includes('T')
        ? session.expiresAt
        : `${session.expiresAt.replace(' ', 'T')}Z`
    );
    return Number.isFinite(parsed) && parsed <= nowMs;
  }
}
