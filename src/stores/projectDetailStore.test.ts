import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storageService } from '../services/storage';
import { useProjectDetailStore } from './projectDetailStore';
import { pathForUrl } from '../services/storage/repositories/scanPageRepository';

/** Create a project directly through the repository seam (storage must be ready). */
async function seedProject(name: string, targetUrl: string) {
  return storageService.getRepositories().projects.create({
    name,
    targetUrl,
    storagePath: `AppData/Local/ArtupskiReSite/projects/${name}`
  });
}

describe('projectDetailStore', () => {
  beforeEach(() => {
    useProjectDetailStore.getState().reset();
  });

  afterEach(async () => {
    await storageService.resetForTests();
    useProjectDetailStore.getState().reset();
  });

  it('reports an honest error when storage is not ready', async () => {
    await useProjectDetailStore.getState().load('missing');

    const state = useProjectDetailStore.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('STORAGE_NOT_READY');
  });

  it('reports not_found for an id that does not exist', async () => {
    await storageService.initialize();
    await useProjectDetailStore.getState().load('does-not-exist');

    const state = useProjectDetailStore.getState();
    expect(state.status).toBe('not_found');
    expect(state.project).toBeNull();
    expect(state.scans).toEqual([]);
    expect(state.activeScanId).toBeNull();
  });

  it('loads a project with no scans and an empty page list', async () => {
    await storageService.initialize();
    const project = await seedProject('Empty', 'https://empty.test');

    await useProjectDetailStore.getState().load(project.id);

    const state = useProjectDetailStore.getState();
    expect(state.status).toBe('ready');
    expect(state.project?.id).toBe(project.id);
    expect(state.scans).toEqual([]);
    expect(state.activeScanId).toBeNull();
    expect(state.pages).toEqual([]);
  });

  it('loads scan history and the newest scan pages, then switches scans', async () => {
    await storageService.initialize();
    const project = await seedProject('Scanned', 'https://scanned.test');
    const repos = storageService.getRepositories();

    const older = await repos.scans.create({ projectId: project.id, status: 'completed' });
    const newer = await repos.scans.create({ projectId: project.id, status: 'completed' });

    await repos.pages.upsertMany([
      {
        scanId: older.id,
        url: 'https://scanned.test/old',
        finalUrl: 'https://scanned.test/old',
        path: pathForUrl('https://scanned.test/old'),
        depth: 0,
        httpStatus: 200,
        title: 'Old',
        metaDescription: null,
        canonicalUrl: null,
        robotsMeta: null,
        status: 'completed',
        authStatus: null,
        errorCode: null,
        errorMessage: null,
        loadTimeMs: 1,
        domContentLoadedTimeMs: 1,
        domNodeCount: 1,
        headings: [],
        internalLinks: [],
        externalLinks: [],
        images: [],
        warnings: [],
        capturedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        scanId: newer.id,
        url: 'https://scanned.test/new',
        finalUrl: 'https://scanned.test/new',
        path: pathForUrl('https://scanned.test/new'),
        depth: 0,
        httpStatus: 200,
        title: 'New',
        metaDescription: null,
        canonicalUrl: null,
        robotsMeta: null,
        status: 'completed',
        authStatus: null,
        errorCode: null,
        errorMessage: null,
        loadTimeMs: 1,
        domContentLoadedTimeMs: 1,
        domNodeCount: 1,
        headings: [],
        internalLinks: [],
        externalLinks: [],
        images: [],
        warnings: [],
        capturedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);

    await useProjectDetailStore.getState().load(project.id);

    // `scans.started_at` has second resolution, so two scans created in the
    // same second tie and the repository's DESC order is not stable. Assert the
    // contract (both scans present; the first is active) rather than a tie order.
    let state = useProjectDetailStore.getState();
    expect(state.status).toBe('ready');
    expect(new Set(state.scans.map((scan) => scan.id))).toEqual(new Set([newer.id, older.id]));
    expect(state.activeScanId).toBe(state.scans[0]!.id);

    const titleByScan = new Map([
      [older.id, 'Old'],
      [newer.id, 'New']
    ]);
    expect(state.pages.map((page) => page.title)).toEqual([
      titleByScan.get(state.activeScanId!)
    ]);

    const otherScanId = state.scans[0]!.id === older.id ? newer.id : older.id;
    await useProjectDetailStore.getState().selectScan(otherScanId);
    state = useProjectDetailStore.getState();
    expect(state.activeScanId).toBe(otherScanId);
    expect(state.pages.map((page) => page.title)).toEqual([titleByScan.get(otherScanId)]);
  });

  it('does not show a previous project while the next one loads', async () => {
    await storageService.initialize();
    const first = await seedProject('First', 'https://first.test');
    const second = await seedProject('Second', 'https://second.test');

    await useProjectDetailStore.getState().load(first.id);
    expect(useProjectDetailStore.getState().project?.id).toBe(first.id);

    await useProjectDetailStore.getState().load(second.id);
    expect(useProjectDetailStore.getState().project?.id).toBe(second.id);
  });
});
