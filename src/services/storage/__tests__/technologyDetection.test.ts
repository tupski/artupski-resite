import { describe, expect, it } from 'vitest';
import { createRawDatabase, createTestStorage } from './helpers';
import { MIGRATIONS, computeChecksum, readAppliedMigrations, runMigrations } from '../migrations';
import type { UpsertScanTechnologyInput } from '../types';

async function seedScan(storage: Awaited<ReturnType<typeof createTestStorage>>): Promise<string> {
  const project = await storage.projects.create({
    name: 'P',
    targetUrl: 'https://example.com/',
    storagePath: 'D:/p'
  });
  const scan = await storage.scans.create({ projectId: project.id });
  return scan.id;
}

function row(scanId: string, overrides: Partial<UpsertScanTechnologyInput> = {}): UpsertScanTechnologyInput {
  return {
    scanId,
    technologyId: 'nextjs',
    category: 'Meta-Framework & SSR Engine',
    name: 'Next.js',
    version: '14.2.1',
    confidence: 0.95,
    confidenceStatus: 'detected',
    versionStatus: 'exact',
    detectionSource: 'deterministic_rules',
    evidence: [{ vector: 'jsGlobals', evidence: '__NEXT_DATA__', weight: 1 }],
    pages: ['https://example.com/'],
    limitation: null,
    ...overrides
  };
}

describe('migration 003 (technology_detection)', () => {
  it('is registered, applied, and checksum-stable', async () => {
    // Migration 003 sits third in the ordered registry (later phases append).
    expect(MIGRATIONS.slice(0, 3).map((m) => m.version)).toEqual([1, 2, 3]);
    const storage = await createTestStorage();
    const applied = readAppliedMigrations(storage.db);
    expect(applied.map((m) => m.version)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(applied[2]?.name).toBe('technology_detection');
    expect(applied[2]?.checksum).toBe(computeChecksum(MIGRATIONS[2]!.sql));
    await storage.close();
  });

  it('adds the detection columns to scan_technologies', async () => {
    const storage = await createTestStorage();
    const columns = storage.db.all<{ name: string }>('PRAGMA table_info(scan_technologies);');
    const names = columns.map((column) => column.name);
    for (const expected of [
      'technology_id',
      'confidence_status',
      'version_status',
      'evidence',
      'pages',
      'limitation'
    ]) {
      expect(names).toContain(expected);
    }
    await storage.close();
  });

  it('upgrades a version-2 database to 3 without data loss', async () => {
    // Migrate a fresh database with only versions 1-2, insert a legacy row, then
    // apply the full registry and confirm migration 3 runs and the row survives.
    const legacy = await createRawDatabase();
    await runMigrations(legacy, { migrations: MIGRATIONS.slice(0, 2) });
    expect(readAppliedMigrations(legacy).map((m) => m.version)).toEqual([1, 2]);

    legacy.run(
      'INSERT INTO projects (id, name, target_url, status, storage_path) VALUES (?, ?, ?, ?, ?);',
      ['p1', 'P', 'https://example.com/', 'idle', 'D:/p']
    );
    legacy.run('INSERT INTO scans (id, project_id, status) VALUES (?, ?, ?);', ['s1', 'p1', 'pending']);
    legacy.run(
      'INSERT INTO scan_technologies (id, scan_id, category, name, confidence, detection_source) VALUES (?, ?, ?, ?, ?, ?);',
      ['t1', 's1', 'Frontend Framework', 'Legacy', 0.9, 'legacy']
    );

    const report = await runMigrations(legacy);
    // Only the migrations not already applied (3 onward) run.
    const expectedPending = MIGRATIONS.slice(2).map((m) => m.version);
    expect(report.applied.map((m) => m.version)).toEqual(expectedPending);

    const rows = legacy.all<{ name: string; technology_id: string | null }>(
      'SELECT name, technology_id FROM scan_technologies;'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Legacy');
    expect(rows[0]!.technology_id).toBeNull();
    await legacy.close();
  });
});

describe('TechnologyRepository (Phase 5)', () => {
  it('upserts and reads detections preserving evidence + pages', async () => {
    const storage = await createTestStorage();
    const scanId = await seedScan(storage);
    await storage.technologies.upsertMany([row(scanId)]);

    const list = await storage.technologies.listByScan(scanId);
    expect(list).toHaveLength(1);
    expect(list[0]!.technologyId).toBe('nextjs');
    expect(list[0]!.confidenceStatus).toBe('detected');
    expect(list[0]!.versionStatus).toBe('exact');
    expect(list[0]!.evidence).toEqual([{ vector: 'jsGlobals', evidence: '__NEXT_DATA__', weight: 1 }]);
    expect(list[0]!.pages).toEqual(['https://example.com/']);
    await storage.close();
  });

  it('dedupes on (scan_id, technology_id) via upsert', async () => {
    const storage = await createTestStorage();
    const scanId = await seedScan(storage);
    await storage.technologies.upsertMany([row(scanId)]);
    await storage.technologies.upsertMany([row(scanId, { confidence: 0.8, confidenceStatus: 'probable' })]);

    const list = await storage.technologies.listByScan(scanId);
    expect(list).toHaveLength(1);
    expect(list[0]!.confidence).toBe(0.8);
    expect(list[0]!.confidenceStatus).toBe('probable');
    expect(await storage.technologies.countByScan(scanId)).toBe(1);
    await storage.close();
  });

  it('persists a batch in one call', async () => {
    const storage = await createTestStorage();
    const scanId = await seedScan(storage);
    const written = await storage.technologies.upsertMany([
      row(scanId, { technologyId: 'nextjs', name: 'Next.js' }),
      row(scanId, { technologyId: 'react', name: 'React', category: 'Frontend Framework' })
    ]);
    expect(written).toBe(2);
    expect(await storage.technologies.countByScan(scanId)).toBe(2);
    await storage.close();
  });

  it('rolls back the whole batch when one row is invalid', async () => {
    const storage = await createTestStorage();
    const scanId = await seedScan(storage);
    await expect(
      storage.technologies.upsertMany([
        row(scanId, { technologyId: 'ok' }),
        // confidence violates the CHECK (0..1) -> transaction must roll back.
        row(scanId, { technologyId: 'bad', confidence: 5 })
      ])
    ).rejects.toThrow();
    expect(await storage.technologies.countByScan(scanId)).toBe(0);
    await storage.close();
  });

  it('cascades detections when the scan is deleted', async () => {
    const storage = await createTestStorage();
    const scanId = await seedScan(storage);
    await storage.technologies.upsertMany([row(scanId)]);
    await storage.scans.delete(scanId);
    expect(await storage.technologies.countByScan(scanId)).toBe(0);
    await storage.close();
  });

  it('survives export + reopen', async () => {
    const storage = await createTestStorage();
    const scanId = await seedScan(storage);
    await storage.technologies.upsertMany([row(scanId)]);
    const reopened = await storage.reopen();
    const list = await reopened.technologies.listByScan(scanId);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Next.js');
    await storage.close();
    await reopened.close();
  });
});
