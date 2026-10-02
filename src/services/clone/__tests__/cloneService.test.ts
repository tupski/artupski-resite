import { describe, expect, it, vi } from 'vitest';
import {
  CloneService,
  type CloneFileIo,
  type ClonePersistence,
  type CloneWorker
} from '../cloneService';
import type { AppEvent } from '../../infra/eventBus';
import type { ScanPage } from '../../../types/models';

function makePage(overrides: Partial<ScanPage> = {}): ScanPage {
  return {
    id: 'p1',
    scanId: 's1',
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    path: '/',
    depth: 0,
    httpStatus: 200,
    title: 'Home',
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    status: 'completed',
    authStatus: null,
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 10,
    domContentLoadedTimeMs: 5,
    domNodeCount: 10,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawHtmlPath: null,
    ...overrides
  };
}

function makeWorker(overrides: Partial<CloneWorker> = {}): CloneWorker {
  return {
    extractRawHtml: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        page: {} as never,
        rawHtml: {
          html: '<html><head></head><body><img src="https://example.com/assets/logo.png"></body></html>',
          byteLength: 90,
          truncated: false
        }
      }
    }),
    captureAssets: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        assets: [
          {
            sourceUrl: 'https://example.com/assets/logo.png',
            mimeType: 'image/png',
            assetType: 'image',
            sizeBytes: 4,
            sha256: 'abc123def456',
            base64: Buffer.from([1, 2, 3, 4]).toString('base64')
          }
        ],
        skipped: 0,
        truncated: false,
        finalUrl: 'https://example.com/'
      }
    }),
    ...overrides
  };
}

function makeIo(): { io: CloneFileIo; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    io: {
      async read(relative) {
        return files.get(relative) ?? null;
      },
      async write(relative, data) {
        files.set(relative, data);
        return true;
      }
    }
  };
}

function makePersistence(pages: ScanPage[]): {
  persistence: ClonePersistence;
  upserted: () => number;
} {
  let count = 0;
  return {
    persistence: {
      async listPages() {
        return pages;
      },
      async countAssets() {
        return count;
      },
      async upsertAssets(inputs) {
        count += inputs.length;
        return inputs.length;
      }
    },
    upserted: () => count
  };
}

describe('CloneService', () => {
  it('rewrites a page, writes local assets, and emits a manifest', async () => {
    const { io, files } = makeIo();
    const { persistence } = makePersistence([makePage()]);
    const events: AppEvent[] = [];
    const service = new CloneService({
      worker: makeWorker(),
      persistence,
      io,
      events: { emit: (event) => events.push(event) },
      now: () => '2026-01-01T00:00:00.000Z'
    });

    const result = await service.run({
      scanId: 's1',
      projectId: 'proj',
      sessionId: 'sess',
      sourceOrigin: 'https://example.com'
    });

    expect(result.ok).toBe(true);
    expect(result.report?.generatedPages).toBe(1);
    expect(result.report?.assetsWritten).toBe(1);

    const html = Buffer.from(files.get('index.html') as Uint8Array).toString('utf8');
    expect(html).toContain('assets/images/logo_abc123de.png');
    expect(html).not.toContain('https://example.com/assets/logo.png');
    expect(files.has('js/mock-client.js')).toBe(true);
    expect(files.has('manifest.json')).toBe(true);

    const manifest = JSON.parse(
      Buffer.from(files.get('manifest.json') as Uint8Array).toString('utf8')
    );
    expect(manifest.pageCount).toBe(1);
    expect(manifest.assetCount).toBe(1);

    expect(events.some((event) => event.type === 'clone.completed')).toBe(true);
  });

  it('skips and counts a page whose HTML cannot be captured (never fabricates)', async () => {
    const { io, files } = makeIo();
    const { persistence } = makePersistence([makePage()]);
    const worker = makeWorker({
      extractRawHtml: vi.fn().mockResolvedValue({ ok: true, data: { page: {} as never } })
    });
    const service = new CloneService({
      worker,
      persistence,
      io,
      events: { emit: () => undefined },
      now: () => '2026-01-01T00:00:00.000Z'
    });

    const result = await service.run({
      scanId: 's1',
      projectId: 'proj',
      sessionId: 'sess',
      sourceOrigin: 'https://example.com'
    });

    expect(result.ok).toBe(true);
    expect(result.report?.generatedPages).toBe(0);
    expect(result.report?.skippedPages).toBe(1);
    expect(files.has('index.html')).toBe(false);
    expect(files.has('manifest.json')).toBe(true);
  });
});
