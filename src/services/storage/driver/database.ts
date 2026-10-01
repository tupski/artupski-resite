/**
 * SqliteDatabase wrapper - Artupski ReSite
 *
 * Thin, typed façade over a sql.js `Database`. It owns parameter binding,
 * result mapping, transaction handling, and the small set of pragmas that are
 * meaningful for the WASM engine. Nothing above this module deals with sql.js
 * types (see docs/architecture/DATABASE.md section 2).
 */
import type { SqlJsDatabase, SqlJsValue } from './sqljs';
import { openDatabase } from './sqljs';

/** Shape returned by mutating statements. */
export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/** A row as a loosely-typed record before mapper conversion. */
export type RowRecord = Record<string, SqlJsValue>;

function columnValue(statement: {
  getColumnNames(): string[];
  get(): SqlJsValue[];
}): RowRecord | null {
  const values = statement.get();
  if (values.length === 0) {
    return null;
  }
  const names = statement.getColumnNames();
  const row: RowRecord = {};
  names.forEach((name, index) => {
    row[name] = values[index] ?? null;
  });
  return row;
}

/**
 * Owns a single sql.js database handle.
 *
 * Callers receive plain JS values (objects/arrays) rather than sql.js
 * primitives; `SqliteDatabase` is the boundary that keeps the driver contained.
 */
export class SqliteDatabase {
  private readonly db: SqlJsDatabase;
  private closed = false;

  private constructor(db: SqlJsDatabase) {
    this.db = db;
  }

  /** Open a database, optionally hydrating from previously exported bytes. */
  static async open(data?: Uint8Array): Promise<SqliteDatabase> {
    const db = await openDatabase(data);
    return new SqliteDatabase(db);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Cannot use a closed SqliteDatabase instance.');
    }
  }

  /**
   * Apply the pragmas this engine supports. WAL, `synchronous`, `mmap_size`,
   * and `cache_size` are no-ops or unsupported under WASM and are deliberately
   * not issued (documented deviation in DATABASE.md section 2).
   *
   * `foreign_keys` is toggled OFF for the duration of schema changes because
   * SQLite only backfills the parent index of a foreign key from data present
   * at CREATE TABLE time; creating `scans` before `projects` has rows would
   * otherwise silently disable `ON DELETE CASCADE`.
   */
  applyPragmas(): void {
    this.assertOpen();
    this.db.run('PRAGMA busy_timeout = 5000;');
    this.db.run('PRAGMA temp_store = MEMORY;');
    this.db.run('PRAGMA foreign_keys = OFF;');
  }

  /** Enable foreign-key enforcement for normal query work. */
  enableForeignKeys(): void {
    this.assertOpen();
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  /** Whether `PRAGMA foreign_keys` is currently enforced. */
  areForeignKeysEnabled(): boolean {
    const row = this.get<{ foreign_keys: number }>('PRAGMA foreign_keys;');
    return row?.foreign_keys === 1;
  }

  /** Run one or more statements (DDL/multi-statement) without parameters. */
  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  /** Execute a single parameterized statement and report the effects. */
  run(sql: string, params: SqlJsValue[] = []): RunResult {
    this.assertOpen();
    const changesBefore = this.countRows('SELECT COUNT(*) AS total FROM sqlite_master;');
    const statement = this.db.prepare(sql);
    try {
      if (params.length > 0) {
        statement.bind(params);
      }
      statement.step();
    } finally {
      statement.free();
    }
    // Probe `last_insert_rowid()` only immediately after a statement that could
    // have created a table. Issuing the probe on every statement flips
    // `PRAGMA foreign_keys` off as a side effect of sql.js's internal
    // savepoint-based `exec`, which would silently disable ON DELETE CASCADE.
    const isDdl = /^\s*(create|drop|alter)\b/i.test(sql);
    const createdTable =
      isDdl && this.countRows('SELECT COUNT(*) AS total FROM sqlite_master;') > changesBefore;
    return {
      changes: this.db.getRowsModified(),
      lastInsertRowid: createdTable ? lastRowId(this.db) : 0
    };
  }

  private countRows(sql: string): number {
    const statement = this.db.prepare(sql);
    try {
      const row = columnValue(statement);
      const value = row?.total;
      return typeof value === 'number' ? value : 0;
    } finally {
      statement.free();
    }
  }

  /** Return every row of a parameterized query. */
  all<T>(sql: string, params: SqlJsValue[] = []): T[] {
    this.assertOpen();
    const statement = this.db.prepare(sql);
    try {
      if (params.length > 0) {
        statement.bind(params);
      }
      const rows: T[] = [];
      while (statement.step()) {
        const row = columnValue(statement);
        if (row) {
          rows.push(row as T);
        }
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  /** Return the first row of a parameterized query, or `null`. */
  get<T>(sql: string, params: SqlJsValue[] = []): T | null {
    this.assertOpen();
    const rows = this.all<T>(sql, params);
    return rows.length > 0 ? (rows[0] as T) : null;
  }

  /**
   * Run `fn` inside a single transaction. On any thrown value the transaction
   * is rolled back and the original error is re-thrown.
   */
  transaction<T>(fn: () => T): T {
    this.assertOpen();
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // A rollback failure must not mask the original error.
      }
      throw error;
    }
  }

  /**
   * Serialize the whole database to bytes for persistence.
   *
   * sql.js 1.12.0's `export()` resets connection-level pragmas (notably
   * `foreign_keys` back to OFF) as a side effect of its internal serialization.
   * Because persistence runs after every mutation, the pragma is restored here
   * so ON DELETE CASCADE keeps working across the application's lifetime.
   */
  export(): Uint8Array {
    this.assertOpen();
    const bytes = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  /** Release the underlying handle. Idempotent. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }

  /** Whether `close()` has been called. */
  isClosed(): boolean {
    return this.closed;
  }
}

/**
 * sql.js does not surface `last_insert_rowid` directly on run(). Phase 2 rows
 * use application-generated UUIDs, so this is reported only after DDL (see
 * `run`); it reflects the rowid of the most recent successful insert.
 */
function lastRowId(db: SqlJsDatabase): number {
  const statement = db.prepare('SELECT last_insert_rowid() AS id;');
  try {
    const row = columnValue(statement);
    const value = row?.id;
    return typeof value === 'number' ? value : 0;
  } finally {
    statement.free();
  }
}
