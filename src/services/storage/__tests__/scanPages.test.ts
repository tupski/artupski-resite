import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UpsertScanPageInput } from '../types';
import { pathForUrl } from '../repositories/scanPageRepository';
import { computeChecksum, MIGRATIONS, readAppliedMigrations } from '../migrations';
import { createTestStorage, type TestStorage } from './helpers';

function input(scanId: string, overrides: Partial<UpsertScanPageInput> = {}): UpsertScanPageInput {
  const url = overrides.url ?? 'https://example.com/';
  return {
    scanId,
    url,
    finalUrl: url,
    path: pathForUrl(url),
    depth: 0,
    httpStatus: 200,
    title: 'Home',
    metaDescription: 'A page',
    canonicalUrl: null,
    robotsMeta: null,
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 10,
    domContentLoadedTimeMs: 5,
    domNodeCount: 42,
    headings: [{ level: 1, text: 'Home' }],
    internalLinks: ['https://example.com/about'],
    externalLinks: ['https://external.example.com'],
    images: [{ src: 'https://example.com/logo.svg', alt: 'Logo', internal: true }],
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('migration 002 (scan_pages)', () => {
  it('is registered, applied, and checksum-stable', async () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3]);
    const storage = await createTestStorage();
    const applied = readAppliedMigrations(storage.db);
    expect(applied.map((m) => m.version)).toEqual([1, 2, 3]);
    expect(applied[1]?.name).toBe('scan_pages');
    expect(applied[1]?.checksum).toBe(computeChecksum(MIGRATIONS[1]!.sql));
    await storage.close();
  });

  it('creates the table and its indexes', async () => {
    const storage = await createTestStorage();
    const tables = storage.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scan_pages';"
    );
    expect(tables).toHaveLength(1);

    const indexes = storage.db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scan_pages';")
      .map((row) => row.name);
    expect(indexes).toContain('idx_scan_pages_scan_url');
    expect(indexes).toContain('idx_scan_pages_scan_id');
    expect(indexes).toContain('idx_scan_pages_path');
    await storage.close();
  });
});

describe('ScanPageRepository', () => {
  let storage: TestStorage;
  let projectId: string;
  let scanId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({ name: 'P', targetUrl: 'https://example.com', storagePath: '/p' });
    projectId = project.id;
    const scan = await storage.scans.create({ projectId });
    scanId = scan.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('upserts a batch and reads it back with collections intact', async () => {
    const count = await storage.pages.upsertMany([
      input(scanId, { url: 'https://example.com/' }),
      input(scanId, { url: 'https://example.com/about', depth: 1 })
    ]);
    expect(count).toBe(2);

    const pages = await storage.pages.listByScan(scanId);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.url).toBe('https://example.com/');
    expect(pages[0]?.headings).toEqual([{ level: 1, text: 'Home' }]);
    expect(pages[0]?.internalLinks).toEqual(['https://example.com/about']);
    expect(pages[0]?.images[0]?.internal).toBe(true);
    expect(pages[1]?.depth).toBe(1);
  });

  it('updates an existing (scan, url) instead of duplicating it', async () => {
    await storage.pages.upsert(input(scanId, { title: 'First' }));
    await storage.pages.upsert(input(scanId, { title: 'Second', httpStatus: 500 }));

    const pages = await storage.pages.listByScan(scanId);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.title).toBe('Second');
    expect(pages[0]?.httpStatus).toBe(500);
  });

  it('tracks totals and non-completed counts', async () => {
    await storage.pages.upsertMany([
      input(scanId, { url: 'https://example.com/a', status: 'completed' }),
      input(scanId, { url: 'https://example.com/b', status: 'failed' }),
      input(scanId, { url: 'https://example.com/c', status: 'timeout' })
    ]);
    expect(await storage.pages.countByScan(scanId)).toBe(3);
    expect(await storage.pages.countFailedByScan(scanId)).toBe(2);
  });

  it('rejects an invalid page status', async () => {
    await expect(storage.pages.upsert(input(scanId, { status: 'exploding' as never }))).rejects.toThrow();
  });

  it('enforces the foreign key to scans', async () => {
    expect(() =>
      storage.db.run(
        "INSERT INTO scan_pages (id, scan_id, url, final_url, path, depth, status, captured_at) VALUES ('x','ghost','https://x.test/','https://x.test/','/','0','completed','2026-01-01T00:00:00.000Z');"
      )
    ).toThrow();
  });

  it('cascades scan deletion to its pages', async () => {
    await storage.pages.upsert(input(scanId));
    await storage.scans.delete(scanId);
    expect(await storage.pages.countByScan(scanId)).toBe(0);
  });

  it('cascades project deletion to its scans and pages', async () => {
    await storage.pages.upsert(input(scanId));
    await storage.projects.delete(projectId);
    expect(await storage.pages.countByScan(scanId)).toBe(0);
  });

  it('persists page records across a database reopen', async () => {
    await storage.pages.upsertMany([
      input(scanId, { url: 'https://example.com/a' }),
      input(scanId, { url: 'https://example.com/b', status: 'failed', errorCode: 'CONNECTION_TIMED_OUT' })
    ]);

    const reopened = await storage.reopen();
    const pages = await reopened.pages.listByScan(scanId);
    expect(pages).toHaveLength(2);
    expect(pages.find((p) => p.url === 'https://example.com/b')?.status).toBe('failed');

    // The migration ledger is intact and migrations did not re-run.
    expect(readAppliedMigrations(reopened.db).map((m) => m.version)).toEqual([1, 2, 3]);

    await storage.close();
    await reopened.close();
  });
});

describe('pathForUrl', () => {
  it('returns the pathname for a valid URL and the raw value otherwise', () => {
    expect(pathForUrl('https://example.com/a/b?x=1#frag')).toBe('/a/b');
    expect(pathForUrl('not a url')).toBe('not a url');
  });
});
