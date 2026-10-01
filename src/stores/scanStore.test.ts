import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_CONFIGURATION, useScanStore } from './scanStore';
import { storageService } from '../services/storage';
import { projectService } from '../services/projects/projectService';
import { useProjectsStore } from './projectsStore';
import {
  resetScanServiceForTests,
  setScanRuntimeProviderForTests
} from '../services/scanner/scanService';
import type { BrowserRuntime } from '../services/browser';
import type {
  NormalizedPage,
  WorkerCommandPayload,
  WorkerResultPayload
} from '../services/infra/workerProtocol';

const SEED = 'http://127.0.0.1:9099';
const ABOUT = 'http://127.0.0.1:9099/about';

function page(url: string, internalLinks: string[] = []): NormalizedPage {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    title: `Title ${url}`,
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    headings: [],
    internalLinks,
    externalLinks: [],
    images: [],
    metrics: { loadTimeMs: 1, domContentLoadedTimeMs: 1, domNodeCount: 5 },
    authStatus: 'public',
    loginSignals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: false },
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z'
  };
}

/** A minimal worker adapter that answers extract/abort without a browser. */
function fakeAdapter(): { request: (command: WorkerCommandPayload) => Promise<WorkerResultPayload> } {
  return {
    async request(command: WorkerCommandPayload): Promise<WorkerResultPayload> {
      if (command.command === 'extract') {
        const links = command.url.includes('/about') ? [] : [ABOUT];
        return { command: 'extract', sessionId: command.sessionId, page: page(command.url, links) };
      }
      if (command.command === 'abort') {
        return { command: 'abort', sessionId: command.sessionId };
      }
      return { command: 'ping', pong: true, workerVersion: 'test' };
    }
  };
}

function fakeRuntime(): BrowserRuntime {
  const adapter = fakeAdapter();
  return {
    getState: () => 'ready',
    getLastError: () => null,
    launchSession: async () => ({ ok: true, data: { sessionId: 'sess-1', engine: 'chromium', version: '1' } }),
    closeSession: async () => ({ ok: true, data: true }),
    getWorkerAdapter: () => adapter
  } as unknown as BrowserRuntime;
}

function resetScanStore() {
  useScanStore.setState({
    targetUrl: '',
    projectId: null,
    projectTitle: '',
    status: 'idle',
    scanId: null,
    progress: { pagesScanned: 0, pagesDiscovered: 0, percentage: 0, currentUrl: null },
    logs: [],
    discoveredPages: [],
    error: null,
    configuration: DEFAULT_SCAN_CONFIGURATION
  });
}

describe('scanStore', () => {
  beforeEach(() => {
    resetScanStore();
  });

  afterEach(() => {
    resetScanServiceForTests();
  });

  it('starts in the idle lifecycle state without fabricating progress', () => {
    const state = useScanStore.getState();
    expect(state.status).toBe('idle');
    expect(state.progress.percentage).toBe(0);
    expect(state.progress.pagesScanned).toBe(0);
    expect(state.logs).toHaveLength(0);
    expect(state.discoveredPages).toHaveLength(0);
    expect(state.error).toBeNull();
  });

  it('updates the target URL', () => {
    useScanStore.getState().setTargetUrl('https://example.com');
    expect(useScanStore.getState().targetUrl).toBe('https://example.com');
  });

  it('merges configuration patches including nested viewports', () => {
    useScanStore.getState().updateConfiguration({ maxDepth: 4 });
    useScanStore.getState().updateConfiguration({ viewports: { tablet: true } } as never);

    const config = useScanStore.getState().configuration;
    expect(config.maxDepth).toBe(4);
    expect(config.viewports.tablet).toBe(true);
    // Untouched viewport flags survive a partial patch.
    expect(config.viewports.desktop).toBe(true);
  });

  it('appends structured log entries', () => {
    useScanStore.getState().appendLog('warn', 'example message');
    const [entry] = useScanStore.getState().logs;
    expect(entry?.level).toBe('warn');
    expect(entry?.message).toBe('example message');
    expect(entry?.timestamp).toBeTypeOf('string');
  });

  it('caps the log window instead of growing unbounded', () => {
    for (let i = 0; i < 1005; i++) {
      useScanStore.getState().appendLog('info', `line ${i}`);
    }
    expect(useScanStore.getState().logs.length).toBe(1000);
  });

  it('resets the lifecycle but preserves the configured target URL', () => {
    const store = useScanStore.getState();
    store.setTargetUrl('https://example.com');
    store.setStatus('scanning');
    store.appendLog('info', 'working');

    useScanStore.getState().resetScan();

    const state = useScanStore.getState();
    expect(state.status).toBe('idle');
    expect(state.logs).toHaveLength(0);
    expect(state.targetUrl).toBe('https://example.com');
  });

  it('refuses to start without an owning project and surfaces an honest error', async () => {
    useScanStore.getState().setTargetUrl('https://example.com');
    await useScanStore.getState().startScan();

    const state = useScanStore.getState();
    expect(state.status).toBe('configuring');
    expect(state.error?.code).toBe('INVALID_URL');
    expect(state.progress.pagesScanned).toBe(0);
  });

  it('cancelScan is a no-op when no scan is running', async () => {
    await useScanStore.getState().cancelScan();
    expect(useScanStore.getState().status).toBe('idle');
  });
});

describe('scanStore crawl integration (fake runtime, real storage + events)', () => {
  beforeEach(async () => {
    resetScanStore();
    useProjectsStore.getState().reset();
    await storageService.resetForTests();
    await storageService.initialize();
  });

  afterEach(async () => {
    resetScanServiceForTests();
    setScanRuntimeProviderForTests(null);
    await storageService.resetForTests();
    useProjectsStore.getState().reset();
    resetScanStore();
  });

  it('runs a real crawl, mirrors real progress/discovery, and completes', async () => {
    const created = await projectService.createProject({ name: 'Fixture', targetUrl: SEED });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    setScanRuntimeProviderForTests(fakeRuntime);
    useScanStore.getState().setTargetUrl(SEED);
    useScanStore.getState().setProjectId(created.data.id);

    await useScanStore.getState().startScan();

    const state = useScanStore.getState();
    expect(state.status).toBe('completed');
    expect(state.progress.pagesScanned).toBe(2);
    expect(state.progress.pagesDiscovered).toBe(2);
    expect(state.progress.percentage).toBe(100);
    // The frontier normalizes the root seed to include its trailing slash.
    expect(state.discoveredPages).toContain(`${SEED}/`);
    expect(state.discoveredPages).toContain(ABOUT);
    expect(state.error).toBeNull();
    expect(state.logs.some((entry) => entry.message.includes('Loaded'))).toBe(true);
  });

  it('reports a runtime-unavailable failure honestly without fabricating progress', async () => {
    const created = await projectService.createProject({ name: 'Fixture', targetUrl: SEED });
    if (!created.ok) {
      return;
    }

    setScanRuntimeProviderForTests(() => null);
    useScanStore.getState().setTargetUrl(SEED);
    useScanStore.getState().setProjectId(created.data.id);

    await useScanStore.getState().startScan();

    const state = useScanStore.getState();
    expect(state.status).toBe('configuring');
    expect(state.error).not.toBeNull();
    expect(state.progress.pagesScanned).toBe(0);
  });
});
