import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestStorage, type TestStorage } from './helpers';

describe('migration 007 (scan_assets)', () => {
  let storage: TestStorage;

  afterEach(async () => {
    await storage.close();
  });

  it('creates the table, its indexes, and the raw_html_path column', async () => {
    storage = await createTestStorage();

    const tables = storage.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scan_assets';"
    );
    expect(tables).toHaveLength(1);

    const indexes = storage.db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scan_assets';"
      )
      .map((row) => row.name);
    expect(indexes).toContain('idx_scan_assets_scan_sha');
    expect(indexes).toContain('idx_scan_assets_scan_id');

    const columns = storage.db
      .all<{ name: string }>('PRAGMA table_info(scan_pages);')
      .map((row) => row.name);
    expect(columns).toContain('raw_html_path');
  });
});

describe('AssetRepository', () => {
  let storage: TestStorage;
  let scanId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({
      name: 'Clone',
      targetUrl: 'https://example.com',
      storagePath: 'clone-project'
    });
    const scan = await storage.scans.create({ projectId: project.id, status: 'completed' });
    scanId = scan.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('persists assets with their metadata and local paths', async () => {
    await storage.assets.upsertMany([
      {
        scanId,
        pageId: null,
        pageUrl: 'https://example.com/',
        sourceUrl: 'https://example.com/assets/logo.png',
        localPath: 'assets/images/logo_abc12345.png',
        mimeType: 'image/png',
        sizeBytes: 128,
        sha256: 'abc12345',
        assetType: 'image'
      }
    ]);

    const assets = await storage.assets.listByScan(scanId);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.assetType).toBe('image');
    expect(assets[0]?.localPath).toBe('assets/images/logo_abc12345.png');
  });

  it('de-duplicates identical payloads by (scan_id, sha256)', async () => {
    const base = {
      scanId,
      pageId: null,
      pageUrl: 'https://example.com/',
      sourceUrl: 'https://example.com/a.png',
      localPath: 'assets/images/a_abc12345.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      sha256: 'abc12345',
      assetType: 'image' as const
    };
    await storage.assets.upsert(base);
    await storage.assets.upsert({ ...base, sourceUrl: 'https://example.com/copy.png' });

    expect(await storage.assets.countByScan(scanId)).toBe(1);
  });

  it('cascades deletes when the scan is removed', async () => {
    await storage.assets.upsert({
      scanId,
      pageId: null,
      pageUrl: null,
      sourceUrl: 'https://example.com/a.png',
      localPath: 'assets/images/a_abc12345.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      sha256: 'abc12345',
      assetType: 'image'
    });
    await storage.scans.delete(scanId);
    expect(await storage.assets.countByScan(scanId)).toBe(0);
  });

  it('survives a reopen (persistence)', async () => {
    await storage.assets.upsert({
      scanId,
      pageId: null,
      pageUrl: null,
      sourceUrl: 'https://example.com/a.png',
      localPath: 'assets/images/a_abc12345.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      sha256: 'abc12345',
      assetType: 'font'
    });
    const reopened = await storage.reopen();
    const assets = await reopened.assets.listByScan(scanId);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.assetType).toBe('font');
    await reopened.close();
  });
});
