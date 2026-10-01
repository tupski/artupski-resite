import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../infra/logger';
import { createProcessError } from '../infra/processErrors';
import { createScannerError } from './errors';
import type { StructuredError } from '../infra/errors';
import type { AppEvent, ScannerPageStartedPayload } from '../infra/eventBus';
import { createTestStorage, type TestStorage } from '../storage/__tests__/helpers';
import type { CreateScanInput, UpdateScanProgressInput, UpdateScanStatusInput, UpsertScanPageInput } from '../storage';
import type { Scan } from '../../types/models';
import { CrawlerService, type CrawlEventSink, type CrawlPersistence, type CrawlWorker } from './crawlerService';
import type { ScannerResult } from './scannerWorkerClient';
import type { NormalizedPage } from './extraction/types';

const SEED = 'http://127.0.0.1:9099/';
const ABOUT = 'http://127.0.0.1:9099/about';
const BROKEN = 'http://127.0.0.1:9099/broken';

function page(url: string, overrides: Partial<NormalizedPage> = {}): NormalizedPage {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    title: `Title ${url}`,
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    metrics: { loadTimeMs: 5, domContentLoadedTimeMs: 3, domNodeCount: 10 },
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class FakeWorker implements CrawlWorker {
  readonly extractCalls: string[] = [];
  readonly abortCalls: string[] = [];
  readonly pages = new Map<string, NormalizedPage>();
  readonly errors = new Map<string, StructuredError>();
  readonly throws = new Map<string, unknown>();
  private gate: { url: string; promise: Promise<void> } | null = null;

  setGate(url: string, promise: Promise<void>): void {
    this.gate = { url, promise };
  }

  async extract(_sessionId: string, url: string): Promise<ScannerResult<NormalizedPage>> {
    this.extractCalls.push(url);
    if (this.gate && this.gate.url === url) {
      await this.gate.promise;
    }
    if (this.throws.has(url)) {
      throw this.throws.get(url);
    }
    const error = this.errors.get(url);
    if (error) {
      return { ok: false, error };
    }
    return { ok: true, data: this.pages.get(url) ?? page(url) };
  }

  async abort(sessionId: string): Promise<ScannerResult<true>> {
    this.abortCalls.push(sessionId);
    return { ok: true, data: true };
  }
}

function persistenceFrom(storage: TestStorage): CrawlPersistence {
  return {
    createScan: (input: CreateScanInput): Promise<Scan> => storage.scans.create(input),
    updateStatus: (id: string, input: UpdateScanStatusInput): Promise<Scan | null> => storage.scans.updateStatus(id, input),
    updateProgress: (id: string, input: UpdateScanProgressInput): Promise<Scan | null> =>
      storage.scans.updateProgress(id, input),
    findActive: (): Promise<Scan[]> => storage.scans.findActive(),
    upsertPages: (inputs: UpsertScanPageInput[]): Promise<number> => storage.pages.upsertMany(inputs),
    countPages: (scanId: string): Promise<number> => storage.pages.countByScan(scanId)
  };
}

describe('CrawlerService', () => {
  let storage: TestStorage;
  let events: AppEvent[];
  let projectId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    events = [];
    const project = await storage.projects.create({ name: 'Crawl target', targetUrl: SEED, storagePath: '/p' });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  function buildService(worker: CrawlWorker, id = 'scan-1', sink?: CrawlEventSink): CrawlerService {
    return new CrawlerService({
      persistence: persistenceFrom(storage),
      worker,
      events: sink ?? { emit: (event) => events.push(event) },
      logger: new Logger('crawler-test', 'ERROR'),
      idFactory: () => id
    });
  }

  it('runs a successful crawl and persists pages + progress before completing', async () => {
    const worker = new FakeWorker();
    worker.pages.set(SEED, page(SEED, { internalLinks: [ABOUT] }));
    worker.pages.set(ABOUT, page(ABOUT, { internalLinks: [SEED] }));

    const service = buildService(worker);
    const result = await service.run({
      projectId,
      seedUrl: SEED,
      sessionId: 'sess',
      limits: { maxDepth: 3, maxPages: 10, progressEveryPages: 1 }
    });

    expect(result.status).toBe('completed');
    expect(result.pagesScanned).toBe(2);
    expect(result.pagesPersisted).toBe(2);
    expect(result.error).toBeNull();

    const scan = await storage.scans.getById(result.scanId);
    expect(scan?.status).toBe('completed');
    expect(scan?.pagesScanned).toBe(2);
    expect(scan?.pagesDiscovered).toBe(2);
    expect(scan?.completedAt).not.toBeNull();

    const pages = await storage.pages.listByScan(result.scanId);
    expect(pages.map((p) => p.url).sort()).toEqual([SEED, ABOUT].sort());

    const types = events.map((event) => event.type);
    expect(types).toContain('scanner.started');
    expect(types).toContain('scanner.page_discovered');
    expect(types).toContain('scanner.page_started');
    expect(types).toContain('scanner.page_loaded');
    expect(types).toContain('scanner.progress');
    expect(types).toContain('scanner.completed');
    expect(types).not.toContain('scanner.failed');
    expect(types).not.toContain('scanner.cancelled');

    expect(service.isRunning()).toBe(false);
  });

  it('continues past recoverable page failures and still completes', async () => {
    const worker = new FakeWorker();
    worker.pages.set(SEED, page(SEED, { internalLinks: [BROKEN] }));
    // A network-level failure is recoverable: the crawl continues.
    worker.errors.set(BROKEN, createScannerError('DNS_RESOLUTION_FAILED', { message: 'nope' }));

    const service = buildService(worker, 'scan-partial');
    const result = await service.run({
      projectId,
      seedUrl: SEED,
      sessionId: 'sess',
      limits: { maxDepth: 2, maxPages: 10, maxRetriesPerPage: 0 }
    });

    expect(result.status).toBe('completed');
    expect(result.pagesScanned).toBe(2);
    expect(result.pageFailures).toBe(1);

    expect((await storage.scans.getById('scan-partial'))?.status).toBe('completed');

    const pages = await storage.pages.listByScan('scan-partial');
    const failed = pages.find((p) => p.url === BROKEN);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorCode).toBe('DNS_RESOLUTION_FAILED');
    expect(events.map((e) => e.type)).toContain('scanner.page_failed');
  });

  it('fails the scan when the worker crashes (fatal), keeping partial progress', async () => {
    const worker = new FakeWorker();
    worker.pages.set(SEED, page(SEED, { internalLinks: [ABOUT] }));
    worker.throws.set(ABOUT, createProcessError('PROCESS_EXITED_UNEXPECTEDLY', { message: 'worker died' }));

    const service = buildService(worker, 'scan-fatal');
    const result = await service.run({ projectId, seedUrl: SEED, sessionId: 'sess', limits: { maxDepth: 2, maxPages: 10 } });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('PROCESS_EXITED_UNEXPECTEDLY');

    const scan = await storage.scans.getById('scan-fatal');
    expect(scan?.status).toBe('failed');
    expect(scan?.errorDetails).toContain('PROCESS_EXITED_UNEXPECTEDLY');
    expect(scan?.completedAt).not.toBeNull();

    // The successfully captured seed page is retained (partial progress).
    expect((await storage.pages.listByScan('scan-fatal')).map((p) => p.url)).toContain(SEED);
    expect(events.map((e) => e.type)).toContain('scanner.failed');
    expect(service.isRunning()).toBe(false);
  });

  it('cancels an in-flight crawl, persists partial progress, and records cancelled', async () => {
    const worker = new FakeWorker();
    worker.pages.set(SEED, page(SEED, { internalLinks: ['http://127.0.0.1:9099/b', 'http://127.0.0.1:9099/c'] }));
    worker.pages.set('http://127.0.0.1:9099/b', page('http://127.0.0.1:9099/b'));

    // A mutable holder lets the sink cancel the very service that emits.
    const ref: { service?: CrawlerService } = {};
    const sink: CrawlEventSink = {
      emit: (event: AppEvent) => {
        events.push(event);
        if (event.type === 'scanner.page_started') {
          const payload = event.payload as ScannerPageStartedPayload;
          if (payload.url.endsWith('/b')) {
            void ref.service?.cancel('scan-cancel');
          }
        }
      }
    };
    const service = buildService(worker, 'scan-cancel', sink);
    ref.service = service;

    const result = await service.run({ projectId, seedUrl: SEED, sessionId: 'sess', limits: { maxDepth: 2, maxPages: 10 } });

    expect(result.status).toBe('cancelled');
    expect(worker.abortCalls.length).toBeGreaterThanOrEqual(1);

    const scan = await storage.scans.getById('scan-cancel');
    expect(scan?.status).toBe('cancelled');
    expect(scan?.completedAt).not.toBeNull();

    // Partial progress (the seed page) is retained.
    expect((await storage.pages.listByScan('scan-cancel')).map((p) => p.url)).toEqual([SEED]);
    expect(events.map((e) => e.type)).toContain('scanner.cancelled');
    expect(events.map((e) => e.type)).not.toContain('scanner.completed');
  });

  it('refuses a duplicate concurrent scan with SCAN_ALREADY_RUNNING', async () => {
    const worker = new FakeWorker();
    const gate = deferred<void>();
    worker.setGate(SEED, gate.promise);

    const service = buildService(worker, 'scan-dup');
    const first = service.run({ projectId, seedUrl: SEED, sessionId: 'sess' });
    expect(service.isRunning()).toBe(true);

    const second = await service.run({ projectId, seedUrl: SEED, sessionId: 'sess' });
    expect(second.status).toBe('failed');
    expect(second.error?.code).toBe('SCAN_ALREADY_RUNNING');

    gate.resolve();
    expect((await first).status).toBe('completed');
    expect(service.isRunning()).toBe(false);
  });

  it('refuses to start when a persisted scan is already live', async () => {
    await storage.scans.create({ projectId, status: 'in_progress' });

    const worker = new FakeWorker();
    const service = buildService(worker, 'scan-dup-2');
    const result = await service.run({ projectId, seedUrl: SEED, sessionId: 'sess' });

    expect(result.error?.code).toBe('SCAN_ALREADY_RUNNING');
    expect(await storage.scans.listByProject(projectId)).toHaveLength(1);
    expect(service.isRunning()).toBe(false);
  });

  it('rejects an unparseable seed without creating a scan', async () => {
    const worker = new FakeWorker();
    const service = buildService(worker, 'scan-bad');
    const result = await service.run({ projectId, seedUrl: 'not a url', sessionId: 'sess' });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('INVALID_URL');
    expect(await storage.scans.listByProject(projectId)).toHaveLength(0);
    expect(service.isRunning()).toBe(false);
  });

  it('releases the active slot after a failure so a later crawl can start', async () => {
    const failing = new FakeWorker();
    failing.throws.set(SEED, createProcessError('PLAYWRIGHT_CRASHED', { message: 'boom' }));
    const failed = await buildService(failing, 'scan-a').run({ projectId, seedUrl: SEED, sessionId: 'sess' });
    expect(failed.status).toBe('failed');

    const succeeded = await buildService(new FakeWorker(), 'scan-b').run({ projectId, seedUrl: SEED, sessionId: 'sess' });
    expect(succeeded.status).toBe('completed');
  });

  it('persists page JSON collections and reads them back intact', async () => {
    const worker = new FakeWorker();
    worker.pages.set(
      SEED,
      page(SEED, {
        headings: [{ level: 1, text: 'Home' }],
        internalLinks: [ABOUT],
        externalLinks: ['https://external.example.com/x'],
        images: [{ src: SEED + 'logo.svg', alt: 'Logo', internal: true }],
        warnings: ['title missing']
      })
    );

    const service = buildService(worker, 'scan-json');
    await service.run({ projectId, seedUrl: SEED, sessionId: 'sess', limits: { maxDepth: 1, maxPages: 5 } });

    const [stored] = await storage.pages.listByScan('scan-json');
    expect(stored?.headings).toEqual([{ level: 1, text: 'Home' }]);
    expect(stored?.internalLinks).toEqual([ABOUT]);
    expect(stored?.externalLinks).toEqual(['https://external.example.com/x']);
    expect(stored?.images).toEqual([{ src: SEED + 'logo.svg', alt: 'Logo', internal: true }]);
    expect(stored?.warnings).toEqual(['title missing']);
  });
});
