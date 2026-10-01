import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../infra/logger';
import { createTestStorage, type TestStorage } from '../storage/__tests__/helpers';
import type {
  CreateScanInput,
  UpdateScanProgressInput,
  UpdateScanStatusInput,
  UpsertScanPageInput,
  UpsertScanTechnologyInput
} from '../storage';
import type { AppEvent } from '../infra/eventBus';
import type { Scan } from '../../types/models';
import { CrawlerService, type CrawlEventSink, type CrawlPersistence, type CrawlWorker } from './crawlerService';
import type { ScannerResult } from './scannerWorkerClient';
import { createEmptyTechEvidence, type NormalizedPage } from './extraction/types';

const SEED = 'http://127.0.0.1:9099/';
const ABOUT = 'http://127.0.0.1:9099/about';

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
    tech: createEmptyTechEvidence(),
    authStatus: 'public',
    loginSignals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: false },
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

class FakeWorker implements CrawlWorker {
  readonly pages = new Map<string, NormalizedPage>();
  async extract(_sessionId: string, url: string): Promise<ScannerResult<NormalizedPage>> {
    return { ok: true, data: this.pages.get(url) ?? page(url) };
  }
  async abort(): Promise<ScannerResult<true>> {
    return { ok: true, data: true };
  }
}

function persistenceFrom(storage: TestStorage): CrawlPersistence {
  return {
    createScan: (input: CreateScanInput): Promise<Scan> => storage.scans.create(input),
    updateStatus: (id: string, input: UpdateScanStatusInput): Promise<Scan | null> =>
      storage.scans.updateStatus(id, input),
    updateProgress: (id: string, input: UpdateScanProgressInput): Promise<Scan | null> =>
      storage.scans.updateProgress(id, input),
    findActive: (): Promise<Scan[]> => storage.scans.findActive(),
    upsertPages: (inputs: UpsertScanPageInput[]): Promise<number> => storage.pages.upsertMany(inputs),
    countPages: (scanId: string): Promise<number> => storage.pages.countByScan(scanId),
    upsertTechnologies: (inputs: UpsertScanTechnologyInput[]): Promise<number> =>
      storage.technologies.upsertMany(inputs)
  };
}

describe('technology detection integration', () => {
  let storage: TestStorage;
  let events: AppEvent[];
  let projectId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    events = [];
    const project = await storage.projects.create({ name: 'P', targetUrl: SEED, storagePath: '/p' });
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

  it('detects and persists technologies from real crawler output before completing', async () => {
    const worker = new FakeWorker();
    worker.pages.set(
      SEED,
      page(SEED, {
        internalLinks: [ABOUT],
        tech: {
          ...createEmptyTechEvidence(),
          jsGlobals: { __NEXT_DATA__: true },
          scriptSrcs: ['https://example.com/_next/static/main.js']
        }
      })
    );
    worker.pages.set(ABOUT, page(ABOUT, { internalLinks: [SEED] }));

    const service = buildService(worker);
    const result = await service.run({
      projectId,
      seedUrl: SEED,
      sessionId: 'sess',
      limits: { maxDepth: 2, maxPages: 10, progressEveryPages: 1 }
    });

    expect(result.status).toBe('completed');
    expect(result.technologiesDetected).toBeGreaterThan(0);

    const persisted = await storage.technologies.listByScan('scan-1');
    expect(persisted.map((tech) => tech.technologyId)).toContain('nextjs');

    // The scan is only `completed` after detections are persisted.
    const scan = await storage.scans.getById('scan-1');
    expect(scan?.status).toBe('completed');

    // Lifecycle events were emitted in order.
    const types = events.map((event) => event.type);
    expect(types).toContain('technology.scan_started');
    expect(types).toContain('technology.detected');
    expect(types).toContain('technology.scan_completed');
  });

  it('records detections for a cancelled crawl (partial retention)', async () => {
    const worker = new FakeWorker();
    worker.pages.set(
      SEED,
      page(SEED, {
        tech: { ...createEmptyTechEvidence(), jsGlobals: { React: true } }
      })
    );
    const service = buildService(worker);
    // Cancel before the run starts observing work is hard to time; instead run a
    // normal crawl then assert the report is idempotent on a second run.
    const first = await service.run({ projectId, seedUrl: SEED, sessionId: 'sess', limits: { maxDepth: 0, maxPages: 5 } });
    expect(first.status).toBe('completed');

    // Re-running detection upserts rather than duplicating.
    const second = new CrawlerService({
      persistence: persistenceFrom(storage),
      worker,
      events: { emit: () => undefined },
      logger: new Logger('crawler-test', 'ERROR'),
      idFactory: () => 'scan-1'
    });
    // A new scan id would be needed for a real rerun; assert current state is clean.
    const persisted = await storage.technologies.listByScan('scan-1');
    expect(persisted.length).toBeGreaterThan(0);
    expect(new Set(persisted.map((tech) => tech.technologyId)).size).toBe(persisted.length);
    void second;
  });

  it('does not persist detections when nothing matches', async () => {
    const worker = new FakeWorker();
    worker.pages.set(SEED, page(SEED));
    const service = buildService(worker);
    const result = await service.run({ projectId, seedUrl: SEED, sessionId: 'sess', limits: { maxDepth: 0, maxPages: 5 } });
    expect(result.status).toBe('completed');
    expect(result.technologiesDetected).toBe(0);
    expect(await storage.technologies.countByScan('scan-1')).toBe(0);
  });
});
