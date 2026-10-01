import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestStorage, type TestStorage } from './helpers';
import type { UpsertResponsiveCaptureInput } from '../repositories/responsiveCaptureRepository';

function captureInput(
  scanId: string,
  pageId: string,
  overrides: Partial<UpsertResponsiveCaptureInput> = {}
): UpsertResponsiveCaptureInput {
  return {
    scanId,
    pageId,
    url: 'https://app.example.com/responsive',
    profile: 'desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    screenshotPath: 'responsive/scan/page-desktop.png',
    detectedBreakpoints: [480, 768],
    elementMap: [
      {
        key: 'header#0',
        tagName: 'header',
        selector: 'header',
        x: 0,
        y: 0,
        width: 1440,
        height: 60,
        visible: true,
        display: 'block',
        fontSize: 16
      }
    ],
    truncated: false,
    ...overrides
  };
}

describe('migration 006 (responsive_captures)', () => {
  it('creates the table with its indexes', async () => {
    const storage = await createTestStorage();
    const tables = storage.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'responsive_captures';"
    );
    expect(tables).toHaveLength(1);

    const indexes = storage.db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'responsive_captures';"
      )
      .map((row) => row.name);
    expect(indexes).toContain('idx_responsive_captures_page_profile');
    expect(indexes).toContain('idx_responsive_captures_scan_id');
    await storage.close();
  });
});

describe('ResponsiveCaptureRepository', () => {
  let storage: TestStorage;
  let projectId: string;
  let scanId: string;
  let pageId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({
      name: 'Responsive',
      targetUrl: 'https://app.example.com',
      storagePath: '/a'
    });
    projectId = project.id;
    const scan = await storage.scans.create({
      projectId,
      status: 'completed',
      depthLimit: 1,
      pageLimit: 10
    });
    scanId = scan.id;
    await storage.pages.upsert({
      scanId,
      url: 'https://app.example.com/responsive',
      finalUrl: 'https://app.example.com/responsive',
      path: '/responsive',
      depth: 0,
      httpStatus: 200,
      title: 'Responsive',
      metaDescription: null,
      canonicalUrl: null,
      robotsMeta: null,
      status: 'completed',
      authStatus: 'public',
      errorCode: null,
      errorMessage: null,
      loadTimeMs: 1,
      domContentLoadedTimeMs: 1,
      domNodeCount: 10,
      headings: [],
      internalLinks: [],
      externalLinks: [],
      images: [],
      warnings: [],
      capturedAt: new Date().toISOString()
    });
    const pages = await storage.pages.listByScan(scanId);
    pageId = pages[0]!.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('persists a capture and round-trips its JSON columns', async () => {
    const saved = await storage.responsiveCaptures.upsert(captureInput(scanId, pageId));
    expect(saved.profile).toBe('desktop');
    expect(saved.width).toBe(1440);
    expect(saved.detectedBreakpoints).toEqual([480, 768]);
    expect(saved.elementMap[0]?.tagName).toBe('header');
    expect(saved.screenshotPath).toBe('responsive/scan/page-desktop.png');
    expect(saved.truncated).toBe(false);
  });

  it('keeps at most one capture per (page, profile) on re-run', async () => {
    await storage.responsiveCaptures.upsert(captureInput(scanId, pageId));
    await storage.responsiveCaptures.upsert(
      captureInput(scanId, pageId, { width: 1400, screenshotPath: 'responsive/scan/re.png' })
    );
    const rows = await storage.responsiveCaptures.listByPage(pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.width).toBe(1400);
    expect(rows[0]!.screenshotPath).toBe('responsive/scan/re.png');
  });

  it('lists captures by scan and counts them', async () => {
    await storage.responsiveCaptures.upsert(captureInput(scanId, pageId, { profile: 'desktop' }));
    await storage.responsiveCaptures.upsert(
      captureInput(scanId, pageId, {
        profile: 'mobile',
        width: 375,
        height: 812,
        isMobile: true,
        hasTouch: true
      })
    );
    expect(await storage.responsiveCaptures.countByScan(scanId)).toBe(2);
    const byScan = await storage.responsiveCaptures.listByScan(scanId);
    expect(byScan).toHaveLength(2);
    // Ordered by width ascending (mobile 375 before desktop 1440).
    expect(byScan[0]!.profile).toBe('mobile');
  });

  it('cascades capture deletion when the scan is deleted', async () => {
    await storage.responsiveCaptures.upsert(captureInput(scanId, pageId));
    await storage.scans.delete(scanId);
    expect(await storage.responsiveCaptures.listByScan(scanId)).toHaveLength(0);
  });

  it('survives a database reopen', async () => {
    await storage.responsiveCaptures.upsert(captureInput(scanId, pageId));
    const reopened = await storage.reopen();
    const rows = await reopened.responsiveCaptures.listByPage(pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detectedBreakpoints).toEqual([480, 768]);
    await reopened.close();
  });
});
