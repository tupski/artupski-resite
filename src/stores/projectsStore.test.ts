import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storageService } from '../services/storage';
import { useProjectsStore } from './projectsStore';

describe('projectsStore', () => {
  beforeEach(async () => {
    useProjectsStore.getState().reset();
  });

  afterEach(async () => {
    await storageService.resetForTests();
    useProjectsStore.getState().reset();
  });

  it('reports an error state when storage is not ready', async () => {
    await useProjectsStore.getState().loadProjects();
    const state = useProjectsStore.getState();

    expect(state.status).toBe('error');
    expect(state.projects).toEqual([]);
    expect(state.error?.code).toBe('STORAGE_NOT_READY');
  });

  it('loads a genuinely empty list without fabricating rows', async () => {
    await storageService.initialize();
    await useProjectsStore.getState().loadProjects();
    const state = useProjectsStore.getState();

    expect(state.status).toBe('ready');
    expect(state.projects).toEqual([]);
  });

  it('waits out an in-flight storage initialization instead of erroring', async () => {
    // Start (but do not await) initialization so the store observes the
    // `initializing` state, then load concurrently.
    const initialization = storageService.initialize();
    const loading = useProjectsStore.getState().loadProjects();

    await initialization;
    await loading;

    const state = useProjectsStore.getState();
    expect(state.status).toBe('ready');
    expect(state.projects).toEqual([]);
  });

  it('creates and then deletes a project, delegating to the service', async () => {
    await storageService.initialize();

    const created = await useProjectsStore
      .getState()
      .createProject({ name: 'Store project', targetUrl: 'example.com' });
    expect(created).toBe(true);
    expect(useProjectsStore.getState().projects).toHaveLength(1);

    const project = useProjectsStore.getState().projects[0]!;
    expect(project.targetUrl).toBe('https://example.com');
    expect(project.status).toBe('idle');

    const deleted = await useProjectsStore.getState().deleteProject(project.id);
    expect(deleted).toBe(true);
    expect(useProjectsStore.getState().projects).toEqual([]);
  });

  it('refuses to create a project with an invalid URL', async () => {
    await storageService.initialize();
    const created = await useProjectsStore
      .getState()
      .createProject({ name: 'Bad', targetUrl: 'not a url' });

    expect(created).toBe(false);
    expect(useProjectsStore.getState().projects).toEqual([]);
  });

  it('clears the selection when the selected project is deleted', async () => {
    await storageService.initialize();
    await useProjectsStore.getState().createProject({ name: 'Sel', targetUrl: 'https://sel.test' });
    const project = useProjectsStore.getState().projects[0]!;

    useProjectsStore.getState().selectProject(project.id);
    expect(useProjectsStore.getState().selectedProjectId).toBe(project.id);

    await useProjectsStore.getState().deleteProject(project.id);
    expect(useProjectsStore.getState().selectedProjectId).toBeNull();
  });
});
