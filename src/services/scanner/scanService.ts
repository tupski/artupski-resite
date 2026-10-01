/**
 * Scan application service - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md, docs/architecture/ARCHITECTURE.md
 * section 5, docs/dev/TESTING.md.
 *
 * The single seam the UI uses to run a crawl. It composes the already-built
 * Phase 4 pieces and owns none of them:
 *
 *   scanStore -> scanService -> { browserRuntime (worker process + session)
 *                                 scannerWorkerClient (typed protocol client)
 *                                 crawlerService (orchestration/lifecycle)
 *                                 storage repositories (persistence) }
 *
 * The React UI never touches Playwright, child processes, or the worker
 * protocol. This service is the only place that (a) resolves the project,
 * (b) launches the shared browser session, (c) starts the crawl, and (d)
 * exposes cancellation.
 *
 * Honest failure: outside the Tauri shell there is no worker process, so the
 * browser runtime resolves to `null`; this service reports that plainly instead
 * of pretending a scan can run.
 */
import type { StructuredError } from '../infra/errors';
import { toStructuredError } from '../infra/errors';
import { logger } from '../infra/logger';
import { validateTargetUrl } from '../../lib/url';
import { storageService } from '../storage';
import { projectService } from '../projects/projectService';
import { getBrowserRuntime, type BrowserRuntime } from '../browser';
import { ScannerWorkerClient } from './scannerWorkerClient';
import { createCrawlerService, createStorageCrawlPersistence } from './crawlerFactory';
import type { CrawlResult, CrawlerService } from './crawlerService';
import { createScannerError } from './errors';
import { createProcessError } from '../infra/processErrors';
import { createStorageError } from '../storage/errors';

/**
 * Runtime resolution is injectable so the seam can be unit-tested without a
 * real Tauri shell, mirroring the `resetForTests` pattern used elsewhere.
 */
type RuntimeProvider = () => BrowserRuntime | null;
let runtimeProvider: RuntimeProvider = getBrowserRuntime;

export interface ScanRunRequest {
  /** Pre-generated so the caller can subscribe to events before `run`. */
  scanId: string;
  projectId: string;
  seedUrl: string;
  limits?: { maxDepth?: number; maxPages?: number };
  headless?: boolean;
}

export interface ScanRunOutcome {
  scanId: string;
  status: 'completed' | 'failed' | 'cancelled';
  pagesScanned: number;
  pagesDiscovered: number;
  pageFailures: number;
  /** Number of technologies persisted for this scan (Phase 5). */
  technologiesDetected: number;
  error: StructuredError | null;
}

export type ScanServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: StructuredError };

/** Live run bookkeeping so `cancel` can reach the owning service instance. */
interface ActiveScan {
  scanId: string;
  service: CrawlerService;
}

let active: ActiveScan | null = null;

function notReady(operation: string): StructuredError {
  return createStorageError('STORAGE_NOT_READY', {
    message: `Cannot ${operation}: local storage is not ready.`
  });
}

/**
 * Run one crawl to a terminal state. Resolves with the honest crawl outcome
 * (never throws); a fatal crawl failure is reported through the returned
 * structured error, not an exception.
 */
export async function runScan(request: ScanRunRequest): Promise<ScanServiceResult<ScanRunOutcome>> {
  if (active) {
    return {
      ok: false,
      error: createScannerError('SCAN_ALREADY_RUNNING', {
        message: 'A scan is already running in this session.'
      })
    };
  }

  // Validate the target before touching the worker or the database.
  const validation = validateTargetUrl(request.seedUrl);
  if (!validation.valid) {
    return { ok: false, error: createScannerError('INVALID_URL', { message: validation.message }) };
  }

  if (storageService.getState() !== 'ready') {
    return { ok: false, error: notReady('start the scan') };
  }

  // Resolve the owning project (created from the same URL on the Projects view).
  const projectResult = await projectService.getProject(request.projectId);
  if (!projectResult.ok) {
    return { ok: false, error: projectResult.error };
  }
  if (!projectResult.data) {
    return {
      ok: false,
      error: createScannerError('INVALID_URL', { message: 'The project for this scan no longer exists.' })
    };
  }

  const runtime = runtimeProvider();
  if (!runtime) {
    return {
      ok: false,
      error: createProcessError('PROCESS_SPAWN_FAILED', {
        message: 'The crawler requires the desktop application.',
        suggestedAction: 'Start the desktop app with `npm run tauri:dev` (the browser preview cannot crawl).'
      })
    };
  }
  if (runtime.getState() !== 'ready') {
    return {
      ok: false,
      error:
        runtime.getLastError() ??
        createProcessError('PROCESS_SPAWN_FAILED', {
          message: 'The browser runtime is not ready.',
          suggestedAction: 'Install Chromium with `npx playwright install chromium`, then retry.'
        })
    };
  }

  const launch = await runtime.launchSession({ headless: request.headless ?? true });
  if (!launch.ok) {
    return { ok: false, error: launch.error };
  }
  const sessionId = launch.data.sessionId;

  const client = new ScannerWorkerClient(runtime.getWorkerAdapter());
  const service = createCrawlerService({
    worker: client,
    persistence: createStorageCrawlPersistence()
  });

  const run: ActiveScan = { scanId: request.scanId, service };
  active = run;

  try {
    const result = await service.run({
      projectId: request.projectId,
      seedUrl: validation.url,
      scanId: request.scanId,
      sessionId,
      limits: {
        ...(request.limits?.maxDepth !== undefined ? { maxDepth: request.limits.maxDepth } : {}),
        ...(request.limits?.maxPages !== undefined ? { maxPages: request.limits.maxPages } : {})
      }
    });
    return { ok: true, data: toOutcome(result) };
  } catch (error) {
    // The service already maps expected failures into `CrawlResult`; this guard
    // keeps an unexpected throw from reaching the UI as a raw stack trace.
    return { ok: false, error: toStructuredError(error, { code: 'UNKNOWN_ERROR', category: 'process' }) };
  } finally {
    await runtime.closeSession(sessionId);
    if (active === run) {
      active = null;
    }
    logger.child('scan').info('Scan run finished', { scanId: request.scanId });
  }
}

/** Request cancellation of the active scan. Returns `true` when one matched. */
export async function cancelScan(scanId: string): Promise<boolean> {
  if (!active || active.scanId !== scanId) {
    return false;
  }
  return active.service.cancel(scanId);
}

/** True when a crawl is currently owned by this service. */
export function isScanRunning(): boolean {
  return active !== null;
}

/** Test-only: forget any in-flight run and restore the default runtime. */
export function resetScanServiceForTests(): void {
  active = null;
  runtimeProvider = getBrowserRuntime;
}

/** Test-only: swap the browser-runtime provider (pass `null` to restore). */
export function setScanRuntimeProviderForTests(provider: RuntimeProvider | null): void {
  runtimeProvider = provider ?? getBrowserRuntime;
}

function toOutcome(result: CrawlResult): ScanRunOutcome {
  return {
    scanId: result.scanId,
    status: result.status,
    pagesScanned: result.pagesScanned,
    pagesDiscovered: result.pagesDiscovered,
    pageFailures: result.pageFailures,
    technologiesDetected: result.technologiesDetected,
    error: result.error
  };
}
