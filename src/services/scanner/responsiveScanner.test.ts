import { describe, expect, it } from 'vitest';
import {
  resolveProfiles,
  screenshotRelativePath,
  runResponsiveScan,
  type ResponsiveWorker
} from './responsiveScanner';
import { RESPONSIVE_VIEWPORT_PROFILES } from '../infra/workerProtocol';
import { storageService } from '../storage';

describe('resolveProfiles', () => {
  it('returns all three canonical profiles when nothing is requested', () => {
    expect(resolveProfiles()).toHaveLength(3);
    expect(resolveProfiles(undefined).map((profile) => profile.name)).toEqual([
      'desktop',
      'tablet',
      'mobile'
    ]);
  });

  it('filters to the requested profiles, preserving canonical order', () => {
    const profiles = resolveProfiles(['mobile', 'desktop']);
    expect(profiles.map((profile) => profile.name)).toEqual(['desktop', 'mobile']);
  });

  it('ignores unknown names', () => {
    expect(resolveProfiles(['tablet'] as never).map((p) => p.name)).toEqual(['tablet']);
  });
});

describe('screenshotRelativePath', () => {
  it('builds a deterministic, filesystem-safe relative path', () => {
    const path = screenshotRelativePath('scan-1', 'page-2', 'mobile');
    expect(path).toBe('responsive/scan-1/page-2-mobile.png');
  });

  it('sanitizes path-hostile characters', () => {
    const path = screenshotRelativePath('a/../b', 'p g', 'desk top');
    expect(path).not.toContain('..');
    expect(path).not.toContain(' ');
    expect(path.startsWith('responsive/')).toBe(true);
  });
});

describe('runResponsiveScan', () => {
  it('persists one capture per page/profile and reports honest counts', async () => {
    await storageService.initialize();
    const project = await storageService.getRepositories().projects.create({
      name: 'Responsive',
      targetUrl: 'https://app.example.com',
      storagePath: '/a'
    });
    const scan = await storageService.getRepositories().scans.create({
      projectId: project.id,
      status: 'completed',
      depthLimit: 1,
      pageLimit: 10
    });
    await storageService.getRepositories().pages.upsert({
      scanId: scan.id,
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
    const pages = await storageService.getRepositories().pages.listByScan(scan.id);
    const page = pages[0]!;

    const worker: ResponsiveWorker = {
      async captureViewport(_sessionId, _url, profile) {
        return {
          ok: true,
          data: {
            screenshotBase64: null,
            detectedBreakpoints: [480, 768],
            elements: [
              {
                key: 'header#0',
                tagName: 'header',
                selector: 'header',
                x: 0,
                y: 0,
                width: profile.width,
                height: 60,
                visible: true,
                display: 'block',
                fontSize: 16
              }
            ],
            truncated: false
          }
        };
      }
    };

    const outcome = await runResponsiveScan(
      {
        scanId: scan.id,
        projectId: project.id,
        sessionId: 'session-1',
        pages: [{ id: page.id, url: page.url }],
        profiles: ['desktop', 'mobile']
      },
      worker
    );

    expect(outcome.captured).toBe(2);
    expect(outcome.skipped).toBe(0);

    const stored = await storageService.getRepositories().responsiveCaptures.listByPage(page.id);
    expect(stored).toHaveLength(2);
    const mobile = stored.find((capture) => capture.profile === 'mobile');
    expect(mobile?.detectedBreakpoints).toEqual([480, 768]);
    expect(mobile?.elementMap[0]?.tagName).toBe('header');

    await storageService.resetForTests();
  });

  it('records a skip (never a throw) when the worker fails a profile', async () => {
    await storageService.initialize();
    const project = await storageService.getRepositories().projects.create({
      name: 'Responsive2',
      targetUrl: 'https://app.example.com',
      storagePath: '/a'
    });
    const scan = await storageService.getRepositories().scans.create({
      projectId: project.id,
      status: 'completed',
      depthLimit: 1,
      pageLimit: 10
    });
    const worker: ResponsiveWorker = {
      async captureViewport() {
        return {
          ok: false,
          error: {
            code: 'PLAYWRIGHT_CRASHED',
            category: 'browser',
            message: 'boom',
            severity: 'error',
            recoverable: true,
            retryable: false,
            suggestedAction: 'retry',
            timestamp: new Date().toISOString()
          }
        };
      }
    };

    const outcome = await runResponsiveScan(
      {
        scanId: scan.id,
        projectId: project.id,
        sessionId: 's',
        pages: [{ id: 'p1', url: 'https://app.example.com/x' }],
        profiles: ['desktop', 'tablet', 'mobile']
      },
      worker
    );
    expect(outcome.captured).toBe(0);
    expect(outcome.skipped).toBe(3);

    await storageService.resetForTests();
  });

  it('defines three canonical profiles with the spec dimensions', () => {
    const byName = new Map(RESPONSIVE_VIEWPORT_PROFILES.map((profile) => [profile.name, profile]));
    expect(byName.get('desktop')?.width).toBe(1440);
    expect(byName.get('tablet')?.width).toBe(768);
    expect(byName.get('mobile')?.width).toBe(375);
  });
});
