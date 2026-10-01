/**
 * Migration runner - Artupski ReSite
 *
 * Ordering, tracking, and integrity are handled here so individual migration
 * modules only declare SQL. The runner:
 *
 * 1. Ensures `schema_migrations` exists (it is owned by the runner, not by any
 *    migration).
 * 2. Verifies the checksum of every already-applied migration; a mismatch is a
 *    hard stop (`MIGRATION_CHECKSUM_MISMATCH`) - the database is not touched.
 * 3. Applies only pending versions, each inside its own transaction; a failing
 *    migration is rolled back and re-thrown as `MIGRATION_FAILED`.
 *
 * Checksums use a deterministic, synchronous FNV-1a hash over the normalized
 * SQL text - no async crypto, so the runner stays usable from the webview and
 * from tests alike.
 */
import type { SqliteDatabase } from '../driver/database';
import { createStorageError } from '../errors';
import type { SchemaMigrationRow } from '../types';
import { MIGRATION_001_INIT } from './001_init';
import { MIGRATION_002_SCAN_PAGES } from './002_scan_pages';
import { MIGRATION_003_TECHNOLOGY_DETECTION } from './003_technology_detection';
import { MIGRATION_004_AUTH_SESSIONS } from './004_auth_sessions';
import { MIGRATION_005_SCAN_PAGE_AUTH } from './005_scan_page_auth';
import { MIGRATION_006_RESPONSIVE_CAPTURES } from './006_responsive_captures';
import type { AppliedMigration, Migration, MigrationResult } from './types';

export type { AppliedMigration, Migration, MigrationResult } from './types';

/**
 * Ordered registry. Append new migrations; never reorder or edit applied SQL
 * (a change would break checksum verification for existing databases).
 */
export const MIGRATIONS: readonly Migration[] = [
  MIGRATION_001_INIT,
  MIGRATION_002_SCAN_PAGES,
  MIGRATION_003_TECHNOLOGY_DETECTION,
  MIGRATION_004_AUTH_SESSIONS,
  MIGRATION_005_SCAN_PAGE_AUTH,
  MIGRATION_006_RESPONSIVE_CAPTURES
];

const CREATE_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

/** Deterministic FNV-1a 32-bit hash rendered as a zero-padded hex string. */
export function computeChecksum(sql: string): string {
  // Normalize line endings and surrounding whitespace so platforms agree.
  const normalized = sql.replace(/\r\n/g, '\n').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Read the applied-migration ledger. */
export function readAppliedMigrations(db: SqliteDatabase): AppliedMigration[] {
  const rows = db.all<SchemaMigrationRow>(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC;'
  );
  return rows.map((row) => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at
  }));
}

export interface RunMigrationsOptions {
  /** Test seam: replaces the registry (used to inject a failing migration). */
  migrations?: readonly Migration[];
  /** Called immediately before each migration is applied. */
  onApply?: (migration: Migration) => void;
  /**
   * Called once after all pending migrations succeed. Migrations run without a
   * repository, so the owner uses this hook to durably persist the schema
   * changes (e.g. `storageService` exports and writes the database file).
   */
  onApplied?: () => void | Promise<void>;
}

/**
 * Apply pending migrations. Returns the newly applied migrations and the
 * versions that were already present.
 */
export async function runMigrations(
  db: SqliteDatabase,
  options: RunMigrationsOptions = {}
): Promise<MigrationResult> {
  const migrations = options.migrations ?? MIGRATIONS;

  db.exec(CREATE_TRACKING_TABLE);

  const applied = readAppliedMigrations(db);
  const appliedByVersion = new Map(applied.map((entry) => [entry.version, entry]));

  // Verify integrity of everything already applied before touching anything.
  for (const migration of migrations) {
    const existing = appliedByVersion.get(migration.version);
    if (!existing) {
      continue;
    }
    const expected = computeChecksum(migration.sql);
    if (existing.checksum !== expected) {
      throw createStorageError('MIGRATION_CHECKSUM_MISMATCH', {
        message: `Migration ${migration.version} ("${migration.name}") no longer matches its recorded checksum.`,
        details: {
          version: migration.version,
          name: migration.name,
          recordedChecksum: existing.checksum,
          computedChecksum: expected
        }
      });
    }
  }

  const pending = [...migrations]
    .filter((migration) => !appliedByVersion.has(migration.version))
    .sort((a, b) => a.version - b.version);

  const appliedNow: AppliedMigration[] = [];
  const alreadyApplied = applied.map((entry) => entry.version);

  for (const migration of pending) {
    const checksum = computeChecksum(migration.sql);
    options.onApply?.(migration);
    try {
      db.transaction(() => {
        db.exec(migration.sql);
        db.run('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?);', [
          migration.version,
          migration.name,
          checksum
        ]);
      });
    } catch (error) {
      throw createStorageError('MIGRATION_FAILED', {
        message: `Migration ${migration.version} ("${migration.name}") failed and was rolled back.`,
        details: { version: migration.version, name: migration.name },
        cause: error
      });
    }
    appliedNow.push({
      version: migration.version,
      name: migration.name,
      checksum,
      appliedAt: new Date().toISOString()
    });
  }

  if (appliedNow.length > 0 && options.onApplied) {
    await options.onApplied();
  }

  return { applied: appliedNow, alreadyApplied };
}
