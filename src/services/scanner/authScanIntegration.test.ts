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
import {
  CrawlerService,
  type CrawlEventSink,
  type CrawlPersistence,
  type CrawlWorker
} from './crawlerService';
import type { ScannerResult } from './scannerWorkerClient';
import {
  createEmptyTechEvidence,
  createEmptyLoginSignals,
  type NormalizedPage
} from './extraction/types';

const SEED = 'https://app.example.com/dashboard';

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
    loginSignals: createEmptyLoginSignals(),
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

class FakeWorker implements CrawlWorker {
  constructor(private readonly responses: Map<string, NormalizedPage>) {}
  async extract(_sessionId: string, url: string): Promise<ScannerResult<NormalizedPage>> {
    const found = this.responses.get(url);
    if (!found) {
      return { ok: true, data: page(url) };
    }
    return { ok: true, data: found };
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
    upsertPages: (inputs: UpsertScanPageInput[]): Promise<number> =>
      storage.pages.upsertMany(inputs),
    countPages: (scanId: string): Promise<number> => storage.pages.countByScan(scanId),
    upsertTechnologies: (inputs: UpsertScanTechnologyInput[]): Promise<number> =>
      storage.technologies.upsertMany(inputs)
  };
}

describe('authenticated crawl integration', () => {
  let storage: TestStorage;
  let events: AppEvent[];
  let projectId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    events = [];
    const project = await storage.projects.create({
      name: 'P',
      targetUrl: SEED,
      storagePath: '/p'
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  function buildService(worker: CrawlWorker, id = 'scan-auth'): CrawlerService {
    const sink: CrawlEventSink = { emit: (event) => events.push(event) };
    return new CrawlerService({
      persistence: persistenceFrom(storage),
      worker,
      events: sink,
      logger: new Logger('crawler-test', 'ERROR'),
      idFactory: () => id
    });
  }

  it('classifies a page reached within an active session as authenticated', async () => {
    // A page with no auth wall, scanned while a session was injected.
    const responses = new Map<string, NormalizedPage>([[SEED, page(SEED)]]);
    const service = buildService(new FakeWorker(responses));
    const result = await service.run({
      projectId,
      seedUrl: SEED,
      scanId: 's1',
      sessionId: 'sess',
      authenticated: true
    });

    expect(result.status).toBe('completed');
    expect(result.pagesAuthRequired).toBe(0);
    const pages = await storage.pages.listByScan('s1');
    expect(pages[0]?.authStatus).toBe('authenticated');
  });

  it('fails an authenticated scan when a page still requires authentication', async () => {
    const responses = new Map<string, NormalizedPage>([
      [
        SEED,
        page(SEED, {
          loginSignals: { redirectedToLogin: true, hasPasswordField: true, hasCaptcha: false }
        })
      ]
    ]);
    const service = buildService(new FakeWorker(responses));
    const result = await service.run({
      projectId,
      seedUrl: SEED,
      scanId: 's2',
      sessionId: 'sess',
      authenticated: true,
      requireAuthentication: true
    });

    expect(result.status).toBe('failed');
    expect(result.pagesAuthRequired).toBe(1);
    expect(result.error?.message).toMatch(/authentication was required/i);

    // The page is persisted as auth_required, never as a successful result.
    const pages = await storage.pages.listByScan('s2');
    expect(pages[0]?.authStatus).toBe('auth_required');
    // No scanner.completed event is emitted for a failed authenticated scan.
    expect(events.some((e) => e.type === 'scanner.completed')).toBe(false);
    expect(events.some((e) => e.type === 'scanner.failed')).toBe(true);
  });

  it('classifies a CAPTCHA/WAF challenge as blocked', async () => {
    const responses = new Map<string, NormalizedPage>([
      [
        SEED,
        page(SEED, {
          httpStatus: 429,
          loginSignals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: true }
        })
      ]
    ]);
    const service = buildService(new FakeWorker(responses));
    const result = await service.run({
      projectId,
      seedUrl: SEED,
      scanId: 's3',
      sessionId: 'sess',
      authenticated: true
    });

    expect(result.pagesBlocked).toBe(1);
    const pages = await storage.pages.listByScan('s3');
    expect(pages[0]?.authStatus).toBe('blocked');
  });

  it('regression: an unauthenticated crawl still completes and classifies public pages', async () => {
    const responses = new Map<string, NormalizedPage>([[SEED, page(SEED)]]);
    const service = buildService(new FakeWorker(responses));
    const result = await service.run({ projectId, seedUrl: SEED, scanId: 's4', sessionId: 'sess' });

    expect(result.status).toBe('completed');
    expect(result.pagesAuthRequired).toBe(0);
    const pages = await storage.pages.listByScan('s4');
    expect(pages[0]?.authStatus).toBe('public');
  });

  it('does not enqueue links from an auth-walled page (no false protected content)', async () => {
    const responses = new Map<string, NormalizedPage>([
      [
        SEED,
        page(SEED, {
          loginSignals: { redirectedToLogin: true, hasPasswordField: true, hasCaptcha: false },
          internalLinks: ['https://app.example.com/private/settings']
        })
      ]
    ]);
    // Unauthenticated run: the seed is a wall. Nothing beyond the seed is crawled.
    const service = buildService(new FakeWorker(responses));
    const result = await service.run({ projectId, seedUrl: SEED, scanId: 's5', sessionId: 'sess' });
    // The walled page's links are not followed, so nothing beyond the seed is discovered.
    expect(result.pagesDiscovered).toBe(1);
    expect(result.pagesAuthRequired).toBe(1);
  });
});
