/**
 * Crawler application service - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md (crawl frontier, lifecycle),
 * docs/architecture/EVENT-SYSTEM.md, docs/architecture/ERROR-HANDLING.md.
 *
 * This is the orchestration seam. It composes the Phase 4 workstream-1 pieces
 * (normalization / crawl scope / frontier / the typed worker client) with
 * persistence (scan + page repositories) and typed events, and owns the scan
 * lifecycle for the duration of one crawl. It deliberately owns NO URL policy,
 * NO DOM extraction, and NO SQL: those live in their own modules.
 *
 * Concurrency & limits: traversal is a sequential BFS (`maxConcurrency` is 1)
 * because the worker holds a single abort controller per browser session, so
 * concurrent extractions on one session are unsafe. Every limit is clamped into
 * documented hard bounds by `resolveCrawlLimits`. Page results are buffered and
 * written in bounded batches, so a large crawl does not export the database
 * once per page.
 *
 * Cancellation: `cancel(scanId)` flips a cooperative flag and calls
 * `worker.abort(sessionId)` to stop the in-flight extraction. The loop then
 * stops, flushes whatever pages were already captured (partial progress is
 * persisted, never discarded), records the scan as `cancelled`, and releases
 * its active-run slot. Shutting the worker process down is owned by the layer
 * that started it (browser runtime / caller); this service only cancels work.
 *
 * Failure semantics: a recoverable page failure (network/timeout/unsupported
 * content) is persisted as a failed page and the crawl continues; a fatal
 * worker failure (browser crash, protocol violation, unexpected exit, timeout
 * of the worker itself) stops the crawl and records the scan as `failed`.
 * A scan is only ever marked `completed` after the final page batch is written.
 */
import { createEvent, eventBus, type AppEvent } from '../infra/eventBus';
import { logger, type Logger } from '../infra/logger';
import type { StructuredError } from '../infra/errors';
import type { Scan, ScanStatus } from '../../types/models';
import type {
  CreateScanInput,
  UpdateScanProgressInput,
  UpdateScanStatusInput,
  UpsertScanPageInput,
  UpsertScanTechnologyInput
} from '../storage';
import { pathForUrl } from '../storage';
import { detectTechnologies, type DetectionInput, type DetectionReport } from '../detector';
import { createCrawlScope, type CrawlScope, type CrawlScopeOptions } from './crawlScope';
import { normalizeUrl } from './normalization';
import { CrawlFrontier } from './frontier';
import { resolveCrawlLimits, type CrawlLimits } from './crawlLimits';
import { createScannerError, toScannerError } from './errors';
import { assertTransition } from './lifecycle';
import type { ScannerResult } from './scannerWorkerClient';
import type { NormalizedPage } from './extraction/types';

/** Terminal outcome of a crawl run. */
export type CrawlTerminalStatus = 'completed' | 'failed' | 'cancelled';

export interface CrawlRequest {
  projectId: string;
  seedUrl: string;
  /** Optional pre-generated scan id so callers can subscribe before `run`. */
  scanId?: string;
  /** Worker session id (launched by the caller / browser runtime). */
  sessionId: string;
  limits?: Partial<CrawlLimits>;
  scope?: CrawlScopeOptions;
}

export interface CrawlResult {
  scanId: string;
  status: CrawlTerminalStatus;
  pagesScanned: number;
  pagesDiscovered: number;
  pageFailures: number;
  pagesPersisted: number;
  /** Number of technologies persisted for this scan (Phase 5). */
  technologiesDetected: number;
  error: StructuredError | null;
}

/** Persistence port the service depends on (implemented by the repositories). */
export interface CrawlPersistence {
  createScan(input: CreateScanInput): Promise<Scan>;
  updateStatus(id: string, input: UpdateScanStatusInput): Promise<Scan | null>;
  updateProgress(id: string, input: UpdateScanProgressInput): Promise<Scan | null>;
  findActive(): Promise<Scan[]>;
  upsertPages(inputs: UpsertScanPageInput[]): Promise<number>;
  countPages(scanId: string): Promise<number>;
  /** Persist the detection report (Phase 5). Optional for non-detection callers. */
  upsertTechnologies?(inputs: UpsertScanTechnologyInput[]): Promise<number>;
}

/** Worker port the service depends on (implemented by `ScannerWorkerClient`). */
export interface CrawlWorker {
  extract(sessionId: string, url: string, options?: { timeoutMs?: number; maxRedirects?: number }): Promise<ScannerResult<NormalizedPage>>;
  abort(sessionId: string): Promise<ScannerResult<true>>;
}

/** Event sink; defaults to the shared `EventBus`. Injectable for tests. */
export interface CrawlEventSink {
  emit(event: AppEvent): void;
}

export interface CrawlerServiceDeps {
  persistence: CrawlPersistence;
  worker: CrawlWorker;
  events?: CrawlEventSink;
  logger?: Logger;
  idFactory?: () => string;
}

/** Errors that mean the worker/browser is unusable, so the crawl cannot continue. */
const FATAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'PLAYWRIGHT_CRASHED',
  'WORKER_PROTOCOL_VIOLATION',
  'PROCESS_EXITED_UNEXPECTEDLY',
  'PROCESS_SPAWN_FAILED',
  'PROCESS_TIMEOUT',
  'BROWSER_NOT_INSTALLED'
]);

function isFatalCrawlError(error: StructuredError): boolean {
  return error.severity === 'fatal' || FATAL_ERROR_CODES.has(error.code);
}

interface ActiveRun {
  scanId: string;
  sessionId: string;
  cancelled: boolean;
}

export class CrawlerService {
  private readonly persistence: CrawlPersistence;
  private readonly worker: CrawlWorker;
  private readonly events: CrawlEventSink;
  private readonly log: Logger;
  private readonly idFactory: () => string;
  private active: ActiveRun | null = null;

  constructor(deps: CrawlerServiceDeps) {
    this.persistence = deps.persistence;
    this.worker = deps.worker;
    this.events = deps.events ?? { emit: (event) => eventBus.emit(event) };
    this.log = deps.logger ?? logger.child('crawler');
    this.idFactory = deps.idFactory ?? (() => crypto.randomUUID());
  }

  /** Whether a crawl is currently owned by this service instance. */
  isRunning(): boolean {
    return this.active !== null;
  }

  getActiveScanId(): string | null {
    return this.active?.scanId ?? null;
  }

  /**
   * Run one crawl to a terminal state. Duplicate concurrent scans are refused
   * with `SCAN_ALREADY_RUNNING` (the spec supports one crawl at a time).
   */
  async run(request: CrawlRequest): Promise<CrawlResult> {
    const limits = resolveCrawlLimits(request.limits);

    // Duplicate-start prevention. The in-process slot is reserved SYNCHRONOUSLY
    // (before the first await) so two near-simultaneous `run()` calls cannot
    // both pass the check and start competing crawls.
    if (this.active) {
      return this.refuseDuplicate(request.scanId ?? null, 'A crawl is already running in this process.');
    }
    const scanId = request.scanId ?? this.idFactory();
    const run: ActiveRun = { scanId, sessionId: request.sessionId, cancelled: false };
    this.active = run;

    // Second guard: a live scan may already exist in the database (e.g. from a
    // previous process). Release the reserved slot if so.
    const activeScans = await this.persistence.findActive();
    if (activeScans.length > 0) {
      this.active = null;
      return this.refuseDuplicate(
        request.scanId ?? null,
        `A scan (${activeScans[0]!.id}) is already in progress.`
      );
    }

    const seed = normalizeUrl(request.seedUrl);
    const scope = seed ? createCrawlScope(seed, request.scope) : null;
    if (!seed || !scope) {
      this.active = null;
      return this.refuseInvalidUrl(request);
    }

    let pagesPersisted = 0;
    let pageFailures = 0;
    let technologiesDetected = 0;
    const frontier = new CrawlFrontier({ maxDepth: limits.maxDepth, maxPages: limits.maxPages });
    const batch: UpsertScanPageInput[] = [];
    // Bounded detection evidence accumulated per page. Only the bounded tech
    // record is retained - never raw page content.
    const detectionInputs: DetectionInput[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) {
        return;
      }
      const pending = batch.splice(0, batch.length);
      pagesPersisted += await this.persistence.upsertPages(pending);
    };

    const reportProgress = async (): Promise<void> => {
      const stats = frontier.getStats();
      await this.persistence.updateProgress(scanId, {
        pagesDiscovered: stats.discovered,
        pagesScanned: stats.scanned
      });
      this.emitProgress(scanId, stats.scanned, stats.discovered, limits, null);
    };

    try {
      await this.persistence.createScan({
        id: scanId,
        projectId: request.projectId,
        status: 'pending',
        depthLimit: limits.maxDepth,
        pageLimit: limits.maxPages
      });

      await this.transition(scanId, 'pending', 'in_progress');
      this.events.emit(
        createEvent('scanner.started', {
          scanId,
          projectId: request.projectId,
          seedUrl: seed,
          maxDepth: limits.maxDepth,
          maxPages: limits.maxPages
        })
      );
      this.log.info('Crawl started', { scanId, seedUrl: seed, limits });

      const seedResult = frontier.enqueue(seed, 0, scope);
      if (seedResult.status === 'enqueued') {
        this.emitDiscovered(scanId, seedResult.url, 0);
      }

      let fatalError: StructuredError | null = null;

      while (frontier.hasQueuedWork()) {
        if (run.cancelled) {
          break;
        }
        const item = frontier.dequeue();
        if (!item) {
          break;
        }

        this.events.emit(
          createEvent('scanner.page_started', { scanId, url: item.url, depth: item.depth })
        );

        const outcome = await this.extractWithRetry(run, item.url, limits);

        // Cancellation wins over whatever the extraction returned.
        if (run.cancelled || (outcome.error?.code === 'USER_CANCELLED')) {
          break;
        }

        if (outcome.fatalError) {
          fatalError = outcome.fatalError;
          frontier.markScanned();
          batch.push(this.failureRecord(scanId, item, outcome.fatalError));
          break;
        }

        frontier.markScanned();
        const page = outcome.page;
        if (!page) {
          // Defensive: a non-fatal failure without a page is recorded as failed.
          const error = outcome.error ?? createScannerError('NAVIGATION_ABORTED', { message: 'Extraction produced no page.' });
          batch.push(this.failureRecord(scanId, item, error));
          pageFailures += 1;
          this.emitPageFailed(scanId, item.url, error);
        } else {
          batch.push(this.pageRecord(scanId, item.depth, page));
          if (page.status === 'completed') {
            this.emitPageLoaded(scanId, item.url, page, item.depth);
            this.enqueueLinks(frontier, scope, page, item.depth, scanId);
            if (page.tech) {
              detectionInputs.push({ url: page.finalUrl || page.requestedUrl, tech: page.tech });
            }
          } else {
            pageFailures += 1;
            this.emitPageFailed(
              scanId,
              item.url,
              createScannerError((page.errorCode as never) ?? 'NAVIGATION_ABORTED', {
                message: page.errorMessage ?? 'Page extraction did not complete.'
              })
            );
          }
        }

        if (batch.length >= limits.persistenceBatchSize) {
          await flush();
        }
        if (frontier.getStats().scanned % limits.progressEveryPages === 0) {
          await reportProgress();
        }

        if (pageFailures >= limits.maxPageFailures) {
          fatalError = createScannerError('CONNECTION_TIMED_OUT', {
            message: `Aborting crawl after ${pageFailures} page failures.`,
            details: { pageFailures }
          });
          break;
        }
      }

      // Persist all captured pages BEFORE declaring any terminal status.
      await flush();
      const stats = frontier.getStats();
      await this.persistence.updateProgress(scanId, {
        pagesDiscovered: stats.discovered,
        pagesScanned: stats.scanned
      });

      // Run technology detection AFTER pages are durable but BEFORE any terminal
      // status is written, so a `completed` scan always has its detections
      // persisted. A fatal crawl failure skips detection (the scan is `failed`);
      // a cancelled crawl still persists the partial detections it collected.
      if (!fatalError) {
        technologiesDetected = await this.runDetection(
          scanId,
          request.projectId,
          detectionInputs
        );
      }

      if (run.cancelled) {
        await this.transition(scanId, 'in_progress', 'cancelled');
        this.events.emit(
          createEvent('scanner.cancelled', {
            scanId,
            projectId: request.projectId,
            pagesScanned: stats.scanned,
            pagesDiscovered: stats.discovered
          })
        );
        this.log.info('Crawl cancelled', { scanId, pagesScanned: stats.scanned });
        return this.result(
          scanId,
          'cancelled',
          stats.scanned,
          stats.discovered,
          pageFailures,
          pagesPersisted,
          null,
          technologiesDetected
        );
      }

      if (fatalError) {
        await this.transition(scanId, 'in_progress', 'failed', JSON.stringify(fatalError));
        this.events.emit(
          createEvent('scanner.failed', {
            scanId,
            projectId: request.projectId,
            url: seed,
            code: fatalError.code,
            message: fatalError.message
          })
        );
        this.log.error('Crawl failed', fatalError, { scanId });
        return this.result(scanId, 'failed', stats.scanned, stats.discovered, pageFailures, pagesPersisted, fatalError);
      }

      await this.transition(scanId, 'in_progress', 'completed');
      this.events.emit(
        createEvent('scanner.completed', {
          scanId,
          projectId: request.projectId,
          pagesScanned: stats.scanned,
          pagesDiscovered: stats.discovered
        })
      );
      this.log.info('Crawl completed', { scanId, pagesScanned: stats.scanned, pageFailures });
      return this.result(
        scanId,
        'completed',
        stats.scanned,
        stats.discovered,
        pageFailures,
        pagesPersisted,
        null,
        technologiesDetected
      );
    } catch (error) {
      const structured = toScannerError(error);
      this.log.error('Crawl aborted by an unexpected error', structured, { scanId });
      try {
        await flush();
        await this.persistence.updateStatus(scanId, { status: 'failed', errorDetails: JSON.stringify(structured) });
        this.events.emit(
          createEvent('scanner.failed', {
            scanId,
            projectId: request.projectId,
            url: seed,
            code: structured.code,
            message: structured.message
          })
        );
      } catch (persistError) {
        this.log.error('Failed to record the terminal scan state', toScannerError(persistError), { scanId });
      }
      const stats = frontier.getStats();
      return this.result(scanId, 'failed', stats.scanned, stats.discovered, pageFailures, pagesPersisted, structured);
    } finally {
      // Cleanup: always release the active slot so the next crawl can start.
      this.active = null;
    }
  }

  /**
   * Request cancellation of a running scan. Returns `true` when a matching
   * crawl was found. The in-flight extraction is aborted on a best-effort
   * basis; the run loop observes the flag and settles deterministically.
   */
  async cancel(scanId: string): Promise<boolean> {
    const run = this.active;
    if (!run || run.scanId !== scanId) {
      return false;
    }
    run.cancelled = true;
    this.log.info('Crawl cancellation requested', { scanId });
    try {
      await this.worker.abort(run.sessionId);
    } catch (error) {
      this.log.warn('Worker abort during cancellation failed', { scanId, error: String(error) });
    }
    return true;
  }

  private async extractWithRetry(
    run: ActiveRun,
    url: string,
    limits: CrawlLimits
  ): Promise<{ page?: NormalizedPage; error?: StructuredError; fatalError?: StructuredError }> {
    let attempt = 0;
    // attempt 0 is the first try; then up to `maxRetriesPerPage` retries.
    for (;;) {
      let result: ScannerResult<NormalizedPage>;
      try {
        result = await this.worker.extract(run.sessionId, url, {
          timeoutMs: limits.navigationTimeoutMs,
          maxRedirects: limits.maxRedirects
        });
      } catch (error) {
        const structured = toScannerError(error);
        if (isFatalCrawlError(structured)) {
          return { fatalError: structured };
        }
        return { error: structured };
      }

      if (run.cancelled) {
        return { error: createScannerError('USER_CANCELLED') };
      }

      if (result.ok) {
        return { page: result.data };
      }

      const error = result.error;
      if (isFatalCrawlError(error)) {
        return { fatalError: error };
      }
      if (error.code === 'USER_CANCELLED') {
        return { error };
      }
      if (error.retryable && attempt < limits.maxRetriesPerPage) {
        attempt += 1;
        this.log.debug('Retrying page extraction', { url, attempt, code: error.code });
        continue;
      }
      return { error };
    }
  }

  private enqueueLinks(
    frontier: CrawlFrontier,
    scope: CrawlScope,
    page: NormalizedPage,
    depth: number,
    scanId: string
  ): void {
    for (const link of page.internalLinks) {
      const result = frontier.enqueue(link, depth + 1, scope);
      if (result.status === 'enqueued') {
        this.emitDiscovered(scanId, result.url, depth + 1);
      }
    }
  }

  private async transition(
    scanId: string,
    from: ScanStatus,
    to: ScanStatus,
    errorDetails?: string
  ): Promise<void> {
    assertTransition(from, to);
    await this.persistence.updateStatus(scanId, { status: to, ...(errorDetails ? { errorDetails } : {}) });
  }

  /**
   * Run the deterministic detection engine over the collected page evidence and
   * persist the report. Returns the number of technologies persisted. Emits
   * `technology.scan_started`, one `technology.detected` per result, and
   * `technology.scan_completed`. Detection is best-effort relative to the crawl:
   * a persistence failure here surfaces as a scan failure (the caller treats a
   * throw as fatal) rather than silently claiming success.
   */
  private async runDetection(
    scanId: string,
    projectId: string,
    inputs: DetectionInput[]
  ): Promise<number> {
    this.events.emit(
      createEvent('technology.scan_started', {
        scanId,
        projectId,
        pagesConsidered: inputs.length
      })
    );

    const report: DetectionReport = detectTechnologies(inputs);
    const persistence = this.persistence;
    let persisted = 0;
    if (report.technologies.length > 0 && persistence.upsertTechnologies) {
      const rows: UpsertScanTechnologyInput[] = report.technologies.map((tech) => ({
        scanId,
        technologyId: tech.technologyId,
        category: tech.category,
        name: tech.name,
        version: tech.version,
        confidence: tech.confidence,
        confidenceStatus: tech.confidenceStatus,
        versionStatus: tech.versionStatus,
        detectionSource: 'deterministic_rules',
        evidence: tech.matchedSignals.map((signal) => ({
          vector: signal.vector,
          evidence: signal.evidence,
          weight: signal.weight
        })),
        pages: tech.pages,
        limitation: tech.limitation
      }));
      persisted = await persistence.upsertTechnologies(rows);
    }

    for (const tech of report.technologies) {
      this.events.emit(
        createEvent('technology.detected', {
          scanId,
          projectId,
          technologyId: tech.technologyId,
          name: tech.name,
          category: tech.category,
          confidence: tech.confidence,
          confidenceStatus: tech.confidenceStatus,
          version: tech.version
        })
      );
    }

    this.events.emit(
      createEvent('technology.scan_completed', {
        scanId,
        projectId,
        detectedCount: report.technologies.length,
        pagesWithEvidence: report.pagesWithEvidence,
        partial: report.truncatedEvidence
      })
    );
    this.log.info('Technology detection completed', {
      scanId,
      detected: report.technologies.length,
      pagesWithEvidence: report.pagesWithEvidence
    });
    return persisted;
  }

  private pageRecord(scanId: string, depth: number, page: NormalizedPage): UpsertScanPageInput {
    return {
      scanId,
      url: page.requestedUrl,
      finalUrl: page.finalUrl,
      path: pathForUrl(page.finalUrl || page.requestedUrl),
      depth,
      httpStatus: page.httpStatus,
      title: page.title.length > 0 ? page.title : null,
      metaDescription: page.metaDescription,
      canonicalUrl: page.canonicalUrl,
      robotsMeta: page.robotsMeta,
      status: page.status,
      errorCode: page.errorCode,
      errorMessage: page.errorMessage,
      loadTimeMs: page.metrics.loadTimeMs,
      domContentLoadedTimeMs: page.metrics.domContentLoadedTimeMs,
      domNodeCount: page.metrics.domNodeCount,
      headings: page.headings,
      internalLinks: page.internalLinks,
      externalLinks: page.externalLinks,
      images: page.images,
      warnings: page.warnings,
      capturedAt: page.capturedAt
    };
  }

  private failureRecord(
    scanId: string,
    item: { url: string; depth: number },
    error: StructuredError
  ): UpsertScanPageInput {
    return {
      scanId,
      url: item.url,
      finalUrl: item.url,
      path: pathForUrl(item.url),
      depth: item.depth,
      httpStatus: null,
      title: null,
      metaDescription: null,
      canonicalUrl: null,
      robotsMeta: null,
      status: 'failed',
      errorCode: error.code,
      errorMessage: error.message,
      loadTimeMs: null,
      domContentLoadedTimeMs: null,
      domNodeCount: null,
      headings: [],
      internalLinks: [],
      externalLinks: [],
      images: [],
      warnings: [],
      capturedAt: new Date().toISOString()
    };
  }

  private emitDiscovered(scanId: string, url: string, depth: number): void {
    this.events.emit(createEvent('scanner.page_discovered', { scanId, url, depth }));
  }

  private emitPageLoaded(scanId: string, url: string, page: NormalizedPage, depth: number): void {
    this.events.emit(
      createEvent('scanner.page_loaded', {
        scanId,
        url,
        statusCode: page.httpStatus,
        title: page.title,
        depth
      })
    );
  }

  private emitPageFailed(scanId: string, url: string, error: StructuredError): void {
    this.events.emit(
      createEvent('scanner.page_failed', {
        scanId,
        url,
        code: error.code,
        message: error.message
      })
    );
  }

  private emitProgress(
    scanId: string,
    pagesScanned: number,
    pagesDiscovered: number,
    limits: CrawlLimits,
    currentUrl: string | null
  ): void {
    const progressPercentage = Math.min(100, Math.round((pagesScanned / limits.maxPages) * 100));
    this.events.emit(
      createEvent('scanner.progress', {
        scanId,
        pagesScanned,
        pagesDiscovered,
        progressPercentage,
        currentUrl
      })
    );
  }

  private refuseDuplicate(scanId: string | null, message: string): CrawlResult {
    const error = createScannerError('SCAN_ALREADY_RUNNING', { message });
    return this.result(scanId ?? '', 'failed', 0, 0, 0, 0, error);
  }

  private refuseInvalidUrl(request: CrawlRequest): CrawlResult {
    const error = createScannerError('INVALID_URL', {
      message: `The seed URL could not be parsed: ${request.seedUrl}`
    });
    return this.result(request.scanId ?? '', 'failed', 0, 0, 0, 0, error);
  }

  private result(
    scanId: string,
    status: CrawlTerminalStatus,
    pagesScanned: number,
    pagesDiscovered: number,
    pageFailures: number,
    pagesPersisted: number,
    error: StructuredError | null,
    technologiesDetected = 0
  ): CrawlResult {
    return {
      scanId,
      status,
      pagesScanned,
      pagesDiscovered,
      pageFailures,
      pagesPersisted,
      technologiesDetected,
      error
    };
  }
}
