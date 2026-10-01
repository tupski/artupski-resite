import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestStorage, type TestStorage } from './helpers';

describe('ScanRepository progress & active queries', () => {
  let storage: TestStorage;
  let projectId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({ name: 'P', targetUrl: 'https://example.com', storagePath: '/p' });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('updates only the supplied counters', async () => {
    const scan = await storage.scans.create({ projectId });
    const updated = await storage.scans.updateProgress(scan.id, { pagesScanned: 3 });
    expect(updated?.pagesScanned).toBe(3);
    expect(updated?.pagesDiscovered).toBe(0);

    const updated2 = await storage.scans.updateProgress(scan.id, { pagesDiscovered: 7 });
    expect(updated2?.pagesScanned).toBe(3);
    expect(updated2?.pagesDiscovered).toBe(7);
  });

  it('clamps counters to non-negative integers', async () => {
    const scan = await storage.scans.create({ projectId });
    const updated = await storage.scans.updateProgress(scan.id, { pagesScanned: -5, pagesDiscovered: 2.9 });
    expect(updated?.pagesScanned).toBe(0);
    expect(updated?.pagesDiscovered).toBe(2);
  });

  it('returns null when updating progress for a missing scan', async () => {
    expect(await storage.scans.updateProgress('missing', { pagesScanned: 1 })).toBeNull();
  });

  it('finds active scans for a project and globally', async () => {
    const other = await storage.projects.create({ name: 'Q', targetUrl: 'https://q.test', storagePath: '/q' });
    const live = await storage.scans.create({ projectId, status: 'in_progress' });
    await storage.scans.create({ projectId, status: 'completed' });
    await storage.scans.create({ projectId: other.id, status: 'pending' });

    const active = await storage.scans.findActive();
    expect(active.map((s) => s.id).sort()).toEqual([live.id, active[1]!.id].sort());
    expect(active).toHaveLength(2);

    expect(await storage.scans.findActiveByProject(projectId)).toHaveLength(1);
    expect((await storage.scans.findActiveByProject(projectId))[0]?.id).toBe(live.id);
  });

  it('treats pending and in_progress as the only live states', async () => {
    await storage.scans.create({ projectId, status: 'completed' });
    await storage.scans.create({ projectId, status: 'failed' });
    await storage.scans.create({ projectId, status: 'cancelled' });
    expect(await storage.scans.findActive()).toHaveLength(0);
  });

  it('honours a caller-supplied scan id', async () => {
    const scan = await storage.scans.create({ id: 'fixed-id', projectId });
    expect(scan.id).toBe('fixed-id');
    expect(await storage.scans.getById('fixed-id')).not.toBeNull();
  });
});
