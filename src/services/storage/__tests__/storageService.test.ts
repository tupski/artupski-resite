import { afterEach, describe, expect, it } from 'vitest';
import type { StructuredError } from '../../infra/errors';
import { projectService } from '../../projects/projectService';
import { getStorageState, storageService } from '../storageService';

function codeOf(error: unknown): string | undefined {
  return (error as StructuredError | undefined)?.code;
}

describe('storageService singleton lifecycle', () => {
  afterEach(async () => {
    await storageService.resetForTests();
  });

  it('starts uninitialized and reports not-ready repositories', () => {
    expect(getStorageState()).toBe('uninitialized');
    try {
      storageService.getRepositories();
      throw new Error('expected STORAGE_NOT_READY');
    } catch (error) {
      expect(codeOf(error)).toBe('STORAGE_NOT_READY');
    }
  });

  it('initializes to ready (in-memory outside Tauri) and is idempotent', async () => {
    const states: string[] = [];
    const unsubscribe = storageService.onStateChange((state) => states.push(state));

    await storageService.initialize();
    await storageService.initialize();

    expect(getStorageState()).toBe('ready');
    expect(states).toEqual(['initializing', 'ready']);
    expect(storageService.getDatabaseLocation()).toBe('memory://app.db');
    unsubscribe();
  });

  it('exposes usable repositories once ready', async () => {
    await storageService.initialize();
    const repos = storageService.getRepositories();
    const project = await repos.projects.create({
      name: 'Via singleton',
      targetUrl: 'https://singleton.test',
      storagePath: '/s'
    });
    expect(await repos.projects.getById(project.id)).not.toBeNull();
  });

  it('returns to uninitialized after close', async () => {
    await storageService.initialize();
    await storageService.close();
    expect(getStorageState()).toBe('uninitialized');
  });
});

describe('projectService', () => {
  afterEach(async () => {
    await storageService.resetForTests();
  });

  it('reports STORAGE_NOT_READY before initialization', async () => {
    const result = await projectService.listProjects();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_NOT_READY');
    }
  });

  it('creates a project with a validated, normalized URL', async () => {
    await storageService.initialize();

    const result = await projectService.createProject({ name: 'Example', targetUrl: 'example.com' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.targetUrl).toBe('https://example.com');
      expect(result.data.name).toBe('Example');
      expect(result.data.storagePath).toContain(result.data.id);
    }
  });

  it('rejects an invalid target URL as a validation error', async () => {
    await storageService.initialize();

    const result = await projectService.createProject({ name: 'Bad', targetUrl: 'ftp://nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_URL');
      expect(result.error.category).toBe('validation');
    }
  });

  it('rejects an empty project name', async () => {
    await storageService.initialize();
    const result = await projectService.createProject({ name: '   ', targetUrl: 'https://a.test' });
    expect(result.ok).toBe(false);
  });

  it('lists and deletes through the repository', async () => {
    await storageService.initialize();
    const created = await projectService.createProject({ name: 'A', targetUrl: 'https://a.test' });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const listed = await projectService.listProjects();
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data).toHaveLength(1);
    }

    const deleted = await projectService.deleteProject(created.data.id);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.data).toBe(true);
    }
  });
});