import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listByScan = vi.fn();
const getState = vi.fn();

vi.mock('../services/storage', () => ({
  storageService: {
    getState: () => getState(),
    getRepositories: () => ({ assets: { listByScan } })
  }
}));

import { useCloneStore } from './cloneStore';

describe('cloneStore', () => {
  beforeEach(() => {
    listByScan.mockReset();
    getState.mockReset();
    useCloneStore.getState().reset();
  });

  afterEach(() => {
    useCloneStore.getState().reset();
  });

  it('clears assets when no scan id is provided', async () => {
    await useCloneStore.getState().loadForScan(null);
    expect(useCloneStore.getState().assets).toEqual([]);
  });

  it('loads persisted assets (DB is the source of truth)', async () => {
    getState.mockReturnValue('ready');
    listByScan.mockResolvedValue([
      {
        id: 'a1',
        scanId: 's1',
        pageId: null,
        pageUrl: null,
        sourceUrl: 'https://x/a.png',
        localPath: 'assets/images/a_1.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        sha256: '1',
        assetType: 'image',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    await useCloneStore.getState().loadForScan('s1');
    expect(useCloneStore.getState().assets).toHaveLength(1);
    expect(useCloneStore.getState().error).toBeNull();
  });

  it('reports a read failure honestly', async () => {
    getState.mockReturnValue('ready');
    listByScan.mockRejectedValue(new Error('boom'));
    await useCloneStore.getState().loadForScan('s1');
    expect(useCloneStore.getState().assets).toEqual([]);
    expect(useCloneStore.getState().error?.code).toBe('STORAGE_READ_FAILED');
  });

  it('records a run report', () => {
    useCloneStore.getState().setReport({
      scanId: 's1',
      generatedPages: 2,
      skippedPages: 1,
      assetsWritten: 3,
      assetsSkipped: 0,
      warnings: []
    });
    expect(useCloneStore.getState().lastReport?.generatedPages).toBe(2);
  });
});
