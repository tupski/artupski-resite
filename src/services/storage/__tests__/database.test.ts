import { describe, expect, it } from 'vitest';
import { createRawDatabase, createTestStorage } from './helpers';

describe('SqliteDatabase', () => {
  it('opens an in-memory database and executes DDL', async () => {
    const db = await createRawDatabase();
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');
    db.run('INSERT INTO t (id, n) VALUES (?, ?);', ['a', 1]);

    expect(db.get<{ id: string; n: number }>('SELECT id, n FROM t;')).toEqual({ id: 'a', n: 1 });
    db.close();
  });

  it('applies the supported pragmas on open', async () => {
    const db = await createRawDatabase();
    const foreignKeys = db.get<{ foreign_keys: number }>('PRAGMA foreign_keys;');
    const tempStore = db.get<{ temp_store: number }>('PRAGMA temp_store;');
    const busyTimeout = db.get<{ timeout: number }>('PRAGMA busy_timeout;');

    expect(foreignKeys?.foreign_keys).toBe(1);
    expect(tempStore?.temp_store).toBe(2); // MEMORY
    expect(busyTimeout?.timeout).toBe(5000);
    db.close();
  });

  it('reports changes and rolls back failed transactions', async () => {
    const db = await createRawDatabase();
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');

    const result = db.run('INSERT INTO t (id, n) VALUES (?, ?);', ['a', 1]);
    expect(result.changes).toBe(1);

    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t (id, n) VALUES (?, ?);', ['b', 2]);
        throw new Error('boom');
      })
    ).toThrow('boom');

    expect(db.all('SELECT id FROM t;')).toHaveLength(1);
    db.close();
  });

  it('exports bytes and refuses use after close', async () => {
    const db = await createRawDatabase();
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY);');
    const bytes = db.export();
    expect(bytes.length).toBeGreaterThan(0);

    db.close();
    expect(db.isClosed()).toBe(true);
    expect(() => db.exec('SELECT 1;')).toThrow();
  });

  it('persists bytes through the storage file on mutation', async () => {
    const storage = await createTestStorage();
    await storage.projects.create({ name: 'Persistence', targetUrl: 'https://a.test', storagePath: '/p' });
    expect(storage.file.writes).toBeGreaterThan(0);
    const persisted = await storage.file.read();
    expect(persisted).not.toBeNull();
    await storage.close();
  });

  it('creates a fully migrated schema', async () => {
    const storage = await createTestStorage();
    const tables = storage.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"
    );
    const names = tables.map((row) => row.name);
    expect(names).toContain('projects');
    expect(names).toContain('scans');
    expect(names).toContain('scan_technologies');
    expect(names).toContain('app_settings');
    expect(names).toContain('schema_migrations');
    // Deferred tables must NOT exist in Phase 2.
    expect(names).not.toContain('scan_pages');
    expect(names).not.toContain('scan_assets');
    expect(names).not.toContain('blueprints');
    expect(names).not.toContain('auth_sessions');
    await storage.close();
  });
});
