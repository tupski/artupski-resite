import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestStorage, type TestStorage } from './helpers';

describe('ProjectRepository', () => {
  let storage: TestStorage;

  beforeEach(async () => {
    storage = await createTestStorage();
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates and reads a project', async () => {
    const project = await storage.projects.create({
      name: 'Marketing site',
      targetUrl: 'https://example.com',
      storagePath: '/projects/1'
    });

    expect(project.id).toMatch(/[0-9a-f-]{36}/);
    expect(project.status).toBe('idle');
    expect(project.createdAt).toBeTruthy();

    const fetched = await storage.projects.getById(project.id);
    expect(fetched).toEqual(project);
  });

  it('lists projects ordered by most recently updated', async () => {
    const first = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const second = await storage.projects.create({ name: 'B', targetUrl: 'https://b.test', storagePath: '/b' });

    // CURRENT_TIMESTAMP has one-second resolution, so tie-break explicitly to
    // keep the ordering assertion deterministic.
    storage.db.run("UPDATE projects SET updated_at = '2024-01-01 00:00:00' WHERE id = ?;", [first.id]);
    storage.db.run("UPDATE projects SET updated_at = '2020-01-01 00:00:00' WHERE id = ?;", [second.id]);

    const list = await storage.projects.list();
    expect(list.map((p) => p.id)).toEqual([first.id, second.id]);
  });

  it('updates mutable fields and leaves the rest intact', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const updated = await storage.projects.update(project.id, { status: 'blueprint_ready' });

    expect(updated?.status).toBe('blueprint_ready');
    expect(updated?.name).toBe('A');
    expect(updated?.targetUrl).toBe('https://a.test');
  });

  it('returns null for missing ids instead of throwing', async () => {
    expect(await storage.projects.getById('missing')).toBeNull();
    expect(await storage.projects.update('missing', { name: 'x' })).toBeNull();
    expect(await storage.projects.delete('missing')).toBe(false);
  });

  it('deletes a project', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    expect(await storage.projects.delete(project.id)).toBe(true);
    expect(await storage.projects.getById(project.id)).toBeNull();
  });

  it('rejects an invalid status via the CHECK constraint', async () => {
    await expect(
      storage.projects.create({
        name: 'Bad',
        targetUrl: 'https://a.test',
        storagePath: '/a',
        status: 'not_a_status' as never
      })
    ).rejects.toThrow();
  });

  it('enforces NOT NULL on required columns', async () => {
    expect(() =>
      storage.db.run('INSERT INTO projects (id, name, target_url, status) VALUES (?, ?, ?, ?);', [
        'x',
        'No path',
        'https://a.test',
        'idle'
      ])
    ).toThrow();
  });

  it('enforces the primary key as a uniqueness constraint', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    expect(() =>
      storage.db.run('INSERT INTO projects (id, name, target_url, status, storage_path) VALUES (?, ?, ?, ?, ?);', [
        project.id,
        'dupe',
        'https://a.test',
        'idle',
        '/a'
      ])
    ).toThrow();
  });
});

describe('ScanRepository', () => {
  let storage: TestStorage;

  beforeEach(async () => {
    storage = await createTestStorage();
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates a scan with honest default counters', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const scan = await storage.scans.create({ projectId: project.id });

    expect(scan.status).toBe('pending');
    expect(scan.depthLimit).toBe(3);
    expect(scan.pageLimit).toBe(50);
    expect(scan.pagesDiscovered).toBe(0);
    expect(scan.pagesScanned).toBe(0);
    expect(scan.assetsDownloaded).toBe(0);
    expect(scan.completedAt).toBeNull();
    expect(scan.errorDetails).toBeNull();
  });

  it('lists scans for a project', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const other = await storage.projects.create({ name: 'B', targetUrl: 'https://b.test', storagePath: '/b' });
    await storage.scans.create({ projectId: project.id });
    await storage.scans.create({ projectId: project.id });
    await storage.scans.create({ projectId: other.id });

    expect(await storage.scans.listByProject(project.id)).toHaveLength(2);
  });

  it('stamps completed_at on terminal status and clears it otherwise', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const scan = await storage.scans.create({ projectId: project.id });

    const completed = await storage.scans.updateStatus(scan.id, { status: 'completed' });
    expect(completed?.completedAt).not.toBeNull();

    const resumed = await storage.scans.updateStatus(scan.id, { status: 'in_progress' });
    expect(resumed?.completedAt).toBeNull();
  });

  it('stores error details on failure and returns null for missing ids', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const scan = await storage.scans.create({ projectId: project.id });

    const failed = await storage.scans.updateStatus(scan.id, {
      status: 'failed',
      errorDetails: 'DNS failure'
    });
    expect(failed?.errorDetails).toBe('DNS failure');
    expect(failed?.completedAt).not.toBeNull();

    expect(await storage.scans.getById('missing')).toBeNull();
    expect(await storage.scans.updateStatus('missing', { status: 'failed' })).toBeNull();
    expect(await storage.scans.delete('missing')).toBe(false);
  });

  it('rejects an invalid scan status via the CHECK constraint', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    await expect(
      storage.scans.create({ projectId: project.id, status: 'exploding' as never })
    ).rejects.toThrow();
  });

  it('rejects a scan whose project does not exist (foreign key)', async () => {
    expect(() =>
      storage.db.run('INSERT INTO scans (id, project_id, status) VALUES (?, ?, ?);', ['s1', 'ghost', 'pending'])
    ).toThrow();
  });

  it('cascades project deletion to its scans', async () => {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const scan = await storage.scans.create({ projectId: project.id });

    await storage.projects.delete(project.id);
    expect(await storage.scans.getById(scan.id)).toBeNull();
  });
});

describe('TechnologyRepository', () => {
  let storage: TestStorage;

  beforeEach(async () => {
    storage = await createTestStorage();
  });

  afterEach(async () => {
    await storage.close();
  });

  async function seedScan(): Promise<string> {
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    const scan = await storage.scans.create({ projectId: project.id });
    return scan.id;
  }

  it('creates and lists technologies for a scan', async () => {
    const scanId = await seedScan();
    await storage.technologies.create({
      scanId,
      category: 'framework',
      name: 'Next.js',
      version: '14.2.1',
      confidence: 0.95,
      detectionSource: 'script_src'
    });
    await storage.technologies.create({
      scanId,
      category: 'css',
      name: 'Tailwind CSS',
      confidence: 0.8,
      detectionSource: 'class_names'
    });

    const list = await storage.technologies.listByScan(scanId);
    expect(list.map((t) => t.name)).toEqual(['Tailwind CSS', 'Next.js']);
    expect(list[1]?.version).toBe('14.2.1');
  });

  it('rejects confidence outside the 0..1 bounds', async () => {
    const scanId = await seedScan();
    await expect(
      storage.technologies.create({
        scanId,
        category: 'framework',
        name: 'X',
        confidence: 1.4,
        detectionSource: 'x'
      })
    ).rejects.toThrow();
  });

  it('cascades scan deletion to its technologies', async () => {
    const scanId = await seedScan();
    const tech = await storage.technologies.create({
      scanId,
      category: 'framework',
      name: 'X',
      confidence: 0.5,
      detectionSource: 'x'
    });

    await storage.scans.delete(scanId);
    expect(storage.db.get('SELECT id FROM scan_technologies WHERE id = ?;', [tech.id])).toBeNull();
  });

  it('returns false when deleting a missing technology', async () => {
    expect(await storage.technologies.delete('missing')).toBe(false);
  });
});

describe('SettingsRepository', () => {
  let storage: TestStorage;

  beforeEach(async () => {
    storage = await createTestStorage();
  });

  afterEach(async () => {
    await storage.close();
  });

  it('round-trips a setting and upserts on conflict', async () => {
    const created = await storage.settings.set('theme', 'dark');
    expect(created.value).toBe('dark');

    const updated = await storage.settings.set('theme', 'light');
    expect(updated.key).toBe('theme');
    expect(updated.value).toBe('light');
    expect(await storage.settings.getAll()).toHaveLength(1);
    expect((await storage.settings.get('theme'))?.value).toBe('light');
  });

  it('returns null for a missing key and false when deleting it', async () => {
    expect(await storage.settings.get('nope')).toBeNull();
    expect(await storage.settings.delete('nope')).toBe(false);
  });

  it('deletes an existing setting', async () => {
    await storage.settings.set('compact', 'true');
    expect(await storage.settings.delete('compact')).toBe(true);
    expect(await storage.settings.get('compact')).toBeNull();
  });

  it('persists every mutation through the storage file', async () => {
    const before = storage.file.writes;
    await storage.settings.set('a', '1');
    expect(storage.file.writes).toBeGreaterThan(before);
  });
});

describe('repository surface guard', () => {
  it('exposes no generic SQL escape hatch', async () => {
    // Regression guard: repositories must stay typed and must not leak a
    // generic execute()/raw query method to callers.
    const forbidden = ['execute', 'exec', 'query', 'raw', 'run'];
    const { ProjectRepository } = await import('../repositories/projectRepository');
    for (const name of forbidden) {
      expect(
        Object.getOwnPropertyNames(ProjectRepository.prototype).includes(name)
      ).toBe(false);
    }
  });
});
