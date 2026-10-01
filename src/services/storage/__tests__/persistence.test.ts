import { describe, expect, it } from 'vitest';
import { createEvent, eventBus } from '../../infra/eventBus';
import { createStorage } from '../storageService';
import { MemoryStorageFile } from '../persistence/storageFile';
import { createTestStorage } from './helpers';

describe('persistence across reopen', () => {
  it('survives export + rebuild from bytes', async () => {
    const storage = await createTestStorage();
    const project = await storage.projects.create({
      name: 'Persisted',
      targetUrl: 'https://persisted.test',
      storagePath: '/p'
    });
    const scan = await storage.scans.create({ projectId: project.id, depthLimit: 5, pageLimit: 120 });
    await storage.technologies.create({
      scanId: scan.id,
      category: 'framework',
      name: 'React',
      version: '18.3.1',
      confidence: 0.99,
      detectionSource: 'script_src'
    });
    await storage.settings.set('theme', 'dark');

    // Reopen from the exported bytes in a brand new in-memory database.
    const reopened = await storage.reopen();

    const projects = await reopened.projects.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('Persisted');
    expect(projects[0]?.id).toBe(project.id);

    const scans = await reopened.scans.listByProject(project.id);
    expect(scans).toHaveLength(1);
    expect(scans[0]?.depthLimit).toBe(5);
    expect(scans[0]?.pageLimit).toBe(120);

    const techs = await reopened.technologies.listByScan(scan.id);
    expect(techs).toHaveLength(1);
    expect(techs[0]?.name).toBe('React');

    expect((await reopened.settings.get('theme'))?.value).toBe('dark');

    // Migrations must NOT re-run on an already-migrated database.
    const tracked = reopened.db.all<{ version: number }>('SELECT version FROM schema_migrations;');
    expect(tracked).toHaveLength(1);

    await storage.close();
    await reopened.close();
  });

  it('restores foreign-key enforcement after reopen (export resets the pragma)', async () => {
    const storage = await createTestStorage();
    const project = await storage.projects.create({ name: 'A', targetUrl: 'https://a.test', storagePath: '/a' });
    await storage.scans.create({ projectId: project.id });

    const reopened = await storage.reopen();
    expect(reopened.db.areForeignKeysEnabled()).toBe(true);

    await reopened.projects.delete(project.id);
    expect(reopened.db.all('SELECT id FROM scans;')).toHaveLength(0);

    await storage.close();
    await reopened.close();
  });

  it('reports a database location from the storage file', async () => {
    const storage = await createTestStorage();
    expect(storage.instance.databaseLocation).toBe('memory://app.db');
    await storage.close();
  });
});

describe('createStorage lifecycle', () => {
  it('emits migration start/complete hooks on first open', async () => {
    const started: number[] = [];
    const completed: number[] = [];
    const file = new MemoryStorageFile();

    const instance = await createStorage(file, {
      onMigrationStart: (migration) => started.push(migration.version),
      onMigrationComplete: (migration) => completed.push(migration.version)
    });

    expect(started).toEqual([1]);
    expect(completed).toEqual([1]);
    await instance.close();
  });

  it('does not re-run migrations when reopening existing bytes', async () => {
    const file = new MemoryStorageFile();
    const first = await createStorage(file);
    await first.close();

    // The memory file now holds the exported, migrated database.
    const started: number[] = [];
    const second = await createStorage(file, {
      onMigrationStart: (migration) => started.push(migration.version)
    });
    expect(started).toEqual([]);
    await second.close();
  });

  it('persists a snapshot to the file on demand', async () => {
    const file = new MemoryStorageFile();
    const instance = await createStorage(file);
    await instance.persist();
    expect(await file.read()).not.toBeNull();
    await instance.close();
  });
});

describe('event bus storage contract', () => {
  it('accepts the storage domain events', () => {
    const received: string[] = [];
    const unsubscribe = eventBus.on('storage.ready', (event) => {
      received.push(event.type);
      expect(event.payload.databaseLocation).toBe('memory://app.db');
    });

    eventBus.emit(
      createEvent('storage.ready', { databaseLocation: 'memory://app.db', appliedMigrations: [] })
    );

    expect(received).toEqual(['storage.ready']);
    unsubscribe();
  });
});
