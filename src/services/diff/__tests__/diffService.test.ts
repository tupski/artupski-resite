import { describe, expect, it, vi } from 'vitest';
import { runVisualDiff, joinUrl, type VisualDiffServiceDeps } from '../diffService';
import { encodePng, decodePng } from '../png';
import type { RgbaImage } from '../../../types/visualDiff';
import type { StructuredError } from '../../../services/infra/errors';

function solid(width: number, height: number, value: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

async function base64Png(image: RgbaImage): Promise<string> {
  const bytes = await encodePng(image);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function makeError(): StructuredError {
  return {
    code: 'PROCESS_SPAWN_FAILED',
    category: 'process',
    message: 'Could not start the process.',
    severity: 'error',
    recoverable: true,
    retryable: true,
    suggestedAction: 'Retry.',
    timestamp: new Date().toISOString()
  };
}

/** A working capture adapter whose screenshot payload can be overridden. */
function captureAdapter(screenshotBase64: string | null, failCapture = false) {
  return {
    launch: vi.fn(async () => ({ ok: true as const, sessionId: 's1' })),
    capture: vi.fn(async () =>
      failCapture
        ? { ok: false as const, error: makeError() }
        : { ok: true as const, screenshotBase64 }
    ),
    close: vi.fn(async () => undefined)
  };
}

/** A server launcher that starts successfully by default. */
function serverLauncher(fail = false, stop = vi.fn(async () => true)) {
  return {
    start: vi.fn(async (_root: string) =>
      fail
        ? { ok: false as const, error: makeError() }
        : { ok: true as const, data: { url: 'http://127.0.0.1:5', port: 5, root: '/x' } }
    ),
    stop
  };
}

describe('joinUrl', () => {
  it('joins a base and a route path without doubling slashes', () => {
    expect(joinUrl('http://127.0.0.1:4321', '/about')).toBe('http://127.0.0.1:4321/about');
    expect(joinUrl('http://127.0.0.1:4321/', 'about')).toBe('http://127.0.0.1:4321/about');
  });
});

describe('runVisualDiff', () => {
  it('compares a matching original and generated render (happy path)', async () => {
    const pngBase64 = await base64Png(solid(4, 4, 200));
    const originalPng = await encodePng(solid(4, 4, 200));
    const deps: VisualDiffServiceDeps = {
      server: serverLauncher(),
      capture: captureAdapter(pngBase64),
      originals: { read: async () => originalPng }
    };

    const report = await runVisualDiff(
      '/projects/p1',
      {
        routes: [{ path: '/' }],
        profiles: ['desktop'],
        originals: {
          desktop: {
            profile: 'desktop',
            screenshotPath: 'scans/x/desktop.png',
            width: 4,
            height: 4
          }
        }
      },
      deps
    );

    expect(report.ok).toBe(true);
    expect(report.summary.compared).toBe(1);
    expect(report.summary.skipped).toBe(0);
    expect(report.summary.averageSimilarityPercent).toBe(100);
    expect(report.summary.partial).toBe(false);
    // The diff image must decode back to a valid PNG (real artifact check).
    const diffPng = report.comparisons[0]!.diffPng!;
    expect(diffPng).not.toBeNull();
    const decoded = await decodePng(diffPng);
    expect(decoded.width).toBe(4);
  });

  it('reports a partial run when the original screenshot is missing', async () => {
    const pngBase64 = await base64Png(solid(4, 4, 200));
    const deps: VisualDiffServiceDeps = {
      server: serverLauncher(),
      capture: captureAdapter(pngBase64),
      originals: { read: async () => null }
    };
    const report = await runVisualDiff(
      '/projects/p1',
      {
        routes: [{ path: '/' }],
        profiles: ['desktop'],
        originals: { desktop: { profile: 'desktop', screenshotPath: null, width: 4, height: 4 } }
      },
      deps
    );
    expect(report.ok).toBe(true);
    expect(report.summary.compared).toBe(0);
    expect(report.summary.skipped).toBe(1);
    expect(report.summary.partial).toBe(true);
    expect(report.comparisons[0]?.skippedReason).toMatch(/original/i);
  });

  it('skips a viewport when the generated capture is unavailable but keeps the run green', async () => {
    const originalPng = await encodePng(solid(4, 4, 10));
    const deps: VisualDiffServiceDeps = {
      server: serverLauncher(),
      capture: captureAdapter(null, true),
      originals: { read: async () => originalPng }
    };
    const report = await runVisualDiff(
      '/projects/p1',
      {
        routes: [{ path: '/' }],
        profiles: ['desktop'],
        originals: { desktop: { profile: 'desktop', screenshotPath: 'a.png', width: 4, height: 4 } }
      },
      deps
    );
    expect(report.ok).toBe(true);
    expect(report.comparisons[0]?.compared).toBe(false);
    expect(report.summary.partial).toBe(true);
  });

  it('fails cleanly when the server cannot start', async () => {
    const deps: VisualDiffServiceDeps = {
      server: serverLauncher(true),
      capture: captureAdapter(null),
      originals: { read: async () => null }
    };
    const report = await runVisualDiff(
      '/projects/p1',
      { routes: [{ path: '/' }], profiles: ['desktop'], originals: {} },
      deps
    );
    expect(report.ok).toBe(false);
    expect(report.error?.code).toBe('PROCESS_SPAWN_FAILED');
    expect(report.comparisons).toEqual([]);
  });

  it('fails cleanly and stops the server when the browser session cannot launch', async () => {
    const stop = vi.fn(async () => true);
    const deps: VisualDiffServiceDeps = {
      server: serverLauncher(false, stop),
      capture: {
        launch: vi.fn(async () => ({ ok: false as const, error: makeError() })),
        capture: vi.fn(async () => ({ ok: true as const, screenshotBase64: null })),
        close: vi.fn(async () => undefined)
      },
      originals: { read: async () => null }
    };
    const report = await runVisualDiff(
      '/projects/p1',
      { routes: [{ path: '/' }], profiles: ['desktop'], originals: {} },
      deps
    );
    expect(report.ok).toBe(false);
    // The server must be stopped even when capture setup fails (no leak).
    expect(stop).toHaveBeenCalledOnce();
  });

  it('rejects an empty route list before touching any collaborator', async () => {
    const server = serverLauncher();
    const report = await runVisualDiff(
      '/projects/p1',
      { routes: [], profiles: ['desktop'], originals: {} },
      { server, capture: captureAdapter(null), originals: { read: async () => null } }
    );
    expect(report.ok).toBe(false);
    expect(report.error?.code).toBe('NO_ROUTES');
    expect(server.start).not.toHaveBeenCalled();
  });

  it('rejects an empty profile list', async () => {
    const report = await runVisualDiff(
      '/projects/p1',
      { routes: [{ path: '/' }], profiles: [], originals: {} },
      {
        server: serverLauncher(),
        capture: captureAdapter(null),
        originals: { read: async () => null }
      }
    );
    expect(report.error?.code).toBe('NO_PROFILES');
  });

  it('rejects a missing project root', async () => {
    const report = await runVisualDiff(
      '   ',
      { routes: [{ path: '/' }], profiles: ['desktop'], originals: {} },
      {
        server: serverLauncher(),
        capture: captureAdapter(null),
        originals: { read: async () => null }
      }
    );
    expect(report.error?.code).toBe('INVALID_ROOT');
  });

  it('honors an abort signal and stops collaborators', async () => {
    const controller = new AbortController();
    controller.abort();
    const stop = vi.fn(async () => true);
    const close = vi.fn(async () => undefined);
    const deps: VisualDiffServiceDeps = {
      server: serverLauncher(false, stop),
      capture: {
        launch: vi.fn(async () => ({ ok: true as const, sessionId: 's1' })),
        capture: vi.fn(async () => ({ ok: true as const, screenshotBase64: null })),
        close
      },
      originals: { read: async () => null },
      signal: controller.signal
    };
    const report = await runVisualDiff(
      '/projects/p1',
      { routes: [{ path: '/' }], profiles: ['desktop', 'mobile'], originals: {} },
      deps
    );
    expect(report.ok).toBe(true);
    expect(report.aborted).toBe(true);
    expect(report.comparisons).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
