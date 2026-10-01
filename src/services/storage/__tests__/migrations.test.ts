import { describe, expect, it, vi } from 'vitest';
import type { StructuredError } from '../../infra/errors';
import { computeChecksum, MIGRATIONS, readAppliedMigrations, runMigrations } from '../migrations';
import type { Migration } from '../migrations/types';
import { createRawDatabase } from './helpers';

function codeOf(error: unknown): string | undefined {
  return (error as StructuredError | undefined)?.code;
}

describe('migration runner', () => {
  it('applies migrations on a fresh database and records tracking rows', async () => {
    const db = await createRawDatabase();
    const result = await runMigrations(db);

    expect(result.applied.map((m) => m.version)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(result.alreadyApplied).toEqual([]);

    const tracked = readAppliedMigrations(db);
    expect(tracked).toHaveLength(MIGRATIONS.length);
    expect(tracked[0]?.version).toBe(1);
    expect(tracked[0]?.name).toBe('init');
    expect(tracked[0]?.checksum).toBe(computeChecksum(MIGRATIONS[0]!.sql));
    db.close();
  });

  it('is a no-op when run repeatedly', async () => {
    const db = await createRawDatabase();
    const first = await runMigrations(db);
    const second = await runMigrations(db);

    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(first.applied.map((m) => m.version));
    expect(readAppliedMigrations(db)).toHaveLength(MIGRATIONS.length);
    db.close();
  });

  it('applies only pending versions', async () => {
    const db = await createRawDatabase();
    const base = MIGRATIONS[0]!;
    await runMigrations(db, { migrations: [base] });

    const second: Migration = {
      version: 2,
      name: 'second',
      sql: 'CREATE TABLE extra (id TEXT PRIMARY KEY);'
    };
    const result = await runMigrations(db, { migrations: [base, second] });

    expect(result.applied.map((m) => m.version)).toEqual([2]);
    expect(result.alreadyApplied).toEqual([1]);
    expect(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='extra';")).toHaveLength(1);
    db.close();
  });

  it('throws MIGRATION_CHECKSUM_MISMATCH when applied SQL changed', async () => {
    const db = await createRawDatabase();
    const original: Migration = { version: 1, name: 'init', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' };
    await runMigrations(db, { migrations: [original] });

    const tampered: Migration = {
      version: 1,
      name: 'init',
      sql: 'CREATE TABLE a (id TEXT PRIMARY KEY, extra TEXT);'
    };
    await expect(runMigrations(db, { migrations: [tampered] })).rejects.toMatchObject({
      code: 'MIGRATION_CHECKSUM_MISMATCH'
    });
    db.close();
  });

  it('rolls back a failing migration and does not record it', async () => {
    const db = await createRawDatabase();
    const good: Migration = { version: 1, name: 'init', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' };
    await runMigrations(db, { migrations: [good] });

    const broken: Migration = {
      version: 2,
      name: 'broken',
      sql: 'CREATE TABLE b (id TEXT PRIMARY KEY); THIS IS NOT VALID SQL;'
    };

    try {
      await runMigrations(db, { migrations: [good, broken] });
      throw new Error('expected MIGRATION_FAILED');
    } catch (error) {
      expect(codeOf(error)).toBe('MIGRATION_FAILED');
    }

    // The partial table from the failed migration must not survive.
    expect(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='b';")).toHaveLength(0);
    expect(readAppliedMigrations(db).map((m) => m.version)).toEqual([1]);
    db.close();
  });

  it('emits an apply callback per pending migration and a completion callback', async () => {
    const db = await createRawDatabase();
    const onApply = vi.fn();
    const onApplied = vi.fn();
    await runMigrations(db, { onApply, onApplied });

    expect(onApply).toHaveBeenCalledTimes(MIGRATIONS.length);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ version: 1, name: 'init' }));
    expect(onApplied).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('does not call the completion callback when nothing was pending', async () => {
    const db = await createRawDatabase();
    await runMigrations(db);
    const onApplied = vi.fn();
    await runMigrations(db, { onApplied });
    expect(onApplied).not.toHaveBeenCalled();
    db.close();
  });

  it('produces deterministic checksums', () => {
    expect(computeChecksum('CREATE TABLE t (id TEXT);')).toBe(
      computeChecksum('CREATE TABLE t (id TEXT);')
    );
    expect(computeChecksum('CREATE TABLE t (id TEXT);')).toMatch(/^[0-9a-f]{8}$/);
    expect(computeChecksum('a')).not.toBe(computeChecksum('b'));
  });
});
