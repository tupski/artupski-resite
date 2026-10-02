import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UpsertBlueprintInput } from '../types';
import { computeChecksum, MIGRATIONS, readAppliedMigrations } from '../migrations';
import { createTestStorage, type TestStorage } from './helpers';

function input(overrides: Partial<UpsertBlueprintInput> = {}): UpsertBlueprintInput {
  return {
    projectId: 'project-1',
    scanId: 'scan-1',
    version: 1,
    schemaVersion: 1,
    filePath: 'v1/bp_1.json',
    isValid: true,
    validationErrors: [],
    ...overrides
  };
}

describe('migration 008 (blueprints)', () => {
  let storage: TestStorage;

  afterEach(async () => {
    await storage.close();
  });

  it('is registered last and applies cleanly with a stable checksum', async () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(8);
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.name).toBe('blueprints');

    storage = await createTestStorage();
    const applied = readAppliedMigrations(storage.db);
    expect(applied.map((m) => m.version)).toEqual(MIGRATIONS.map((m) => m.version));
    const last = applied[applied.length - 1];
    expect(last?.version).toBe(8);
    expect(last?.checksum).toBe(computeChecksum(MIGRATIONS[MIGRATIONS.length - 1]!.sql));
  });

  it('creates the table, its indexes, and the blueprint_evidence_path column', async () => {
    storage = await createTestStorage();

    const tables = storage.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blueprints';"
    );
    expect(tables).toHaveLength(1);

    const indexes = storage.db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'blueprints';"
      )
      .map((row) => row.name);
    expect(indexes).toContain('idx_blueprints_project_id');
    expect(indexes).toContain('idx_blueprints_scan_id');
    expect(indexes).toContain('idx_blueprints_scan_version');

    const columns = storage.db
      .all<{ name: string }>('PRAGMA table_info(scan_pages);')
      .map((row) => row.name);
    expect(columns).toContain('blueprint_evidence_path');
  });

  it('is idempotent on a re-run (forward-only, no duplicate rows)', async () => {
    storage = await createTestStorage();
    const before = readAppliedMigrations(storage.db).length;
    // Re-running the runner on an already-migrated database is a no-op.
    const { runMigrations } = await import('../migrations');
    const result = await runMigrations(storage.db);
    expect(result.applied).toEqual([]);
    expect(readAppliedMigrations(storage.db)).toHaveLength(before);
  });

  it('preserves data across a reopen', async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({
      name: 'P',
      targetUrl: 'https://example.com',
      storagePath: '/p'
    });
    const scan = await storage.scans.create({ projectId: project.id, status: 'completed' });
    await storage.blueprints.upsert(input({ projectId: project.id, scanId: scan.id }));

    const reopened = await storage.reopen();
    const latest = await reopened.blueprints.getLatestByScan(scan.id);
    expect(latest?.filePath).toBe('v1/bp_1.json');
    await reopened.close();
  });
});

describe('BlueprintRepository', () => {
  let storage: TestStorage;
  let projectId: string;
  let scanId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({
      name: 'Blueprint',
      targetUrl: 'https://example.com',
      storagePath: 'blueprint-project'
    });
    projectId = project.id;
    const scan = await storage.scans.create({ projectId, status: 'completed' });
    scanId = scan.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('inserts and reads back a record with validation metadata', async () => {
    const created = await storage.blueprints.upsert(
      input({
        projectId,
        scanId,
        isValid: false,
        validationErrors: [
          { code: 'BLUEPRINT_VALIDATION_FAILED', path: 'site.name', message: 'Required' }
        ]
      })
    );
    expect(created.isValid).toBe(false);
    expect(created.validationErrors).toHaveLength(1);
    expect(created.validationErrors[0]?.path).toBe('site.name');

    const fetched = await storage.blueprints.getById(created.id);
    expect(fetched?.scanId).toBe(scanId);
    expect(fetched?.schemaVersion).toBe(1);
  });

  it('upserts on the (scan_id, version) unique key instead of duplicating', async () => {
    const first = await storage.blueprints.upsert(
      input({ projectId, scanId, filePath: 'v1/first.json' })
    );
    const second = await storage.blueprints.upsert(
      input({ projectId, scanId, filePath: 'v1/second.json' })
    );

    expect(second.id).toBe(first.id);
    expect(await storage.blueprints.countByScan(scanId)).toBe(1);
    const latest = await storage.blueprints.getLatestByScan(scanId);
    expect(latest?.filePath).toBe('v1/second.json');
  });

  it('tracks multiple revisions and returns the highest as latest', async () => {
    await storage.blueprints.upsert(input({ projectId, scanId, version: 1 }));
    await storage.blueprints.upsert(input({ projectId, scanId, version: 2 }));

    const revisions = await storage.blueprints.listByScan(scanId);
    expect(revisions.map((entry) => entry.version)).toEqual([2, 1]);
    expect((await storage.blueprints.getLatestByScan(scanId))?.version).toBe(2);
  });

  it('lists by project and deletes by id/scan', async () => {
    const first = await storage.blueprints.upsert(input({ projectId, scanId, version: 1 }));
    await storage.blueprints.upsert(input({ projectId, scanId, version: 2 }));

    expect(await storage.blueprints.listByProject(projectId)).toHaveLength(2);
    expect(await storage.blueprints.deleteById(first.id)).toBe(true);
    expect(await storage.blueprints.countByScan(scanId)).toBe(1);
    expect(await storage.blueprints.deleteByScan(scanId)).toBe(1);
    expect(await storage.blueprints.getLatestByScan(scanId)).toBeNull();
  });

  it('cascades when the project is deleted', async () => {
    await storage.blueprints.upsert(input({ projectId, scanId }));
    await storage.projects.delete(projectId);
    expect(await storage.blueprints.listByProject(projectId)).toHaveLength(0);
  });

  it('nulls scan_id (keeping the row) when the scan is deleted', async () => {
    const created = await storage.blueprints.upsert(input({ projectId, scanId }));
    await storage.scans.delete(scanId);
    const fetched = await storage.blueprints.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.scanId).toBeNull();
    expect(fetched?.projectId).toBe(projectId);
  });

  it('records and clears the blueprint evidence path on a page', async () => {
    await storage.pages.upsert({
      scanId,
      url: 'https://example.com/',
      finalUrl: 'https://example.com/',
      path: '/',
      depth: 0,
      httpStatus: 200,
      title: 'Home',
      metaDescription: null,
      canonicalUrl: null,
      robotsMeta: null,
      status: 'completed',
      authStatus: null,
      errorCode: null,
      errorMessage: null,
      loadTimeMs: 10,
      domContentLoadedTimeMs: 5,
      domNodeCount: 10,
      headings: [],
      internalLinks: [],
      externalLinks: [],
      images: [],
      warnings: [],
      capturedAt: '2026-01-01T00:00:00.000Z'
    });
    const stored = await storage.pages.listByScan(scanId);
    const pageId = stored[0]!.id;
    expect(stored[0]?.blueprintEvidencePath).toBeNull();

    await storage.pages.updateBlueprintEvidencePath(pageId, 'evidence/scan/page.json');
    const updated = await storage.pages.getById(pageId);
    expect(updated?.blueprintEvidencePath).toBe('evidence/scan/page.json');

    await storage.pages.updateBlueprintEvidencePath(pageId, null);
    expect((await storage.pages.getById(pageId))?.blueprintEvidencePath).toBeNull();
  });
});
