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
import { createEvent, eventBus } from '../infra/eventBus';
import type { StructuredError } from '../infra/errors';
import { toStructuredError } from '../infra/errors';
import { logger } from '../infra/logger';
import { validateTargetUrl } from '../../lib/url';
import { storageService } from '../storage';
import { projectService } from '../projects/projectService';
import { getBrowserRuntime, type BrowserRuntime } from '../browser';
import { loadSessionForScan } from '../auth/authSessionService';
import type { AuthStorageState, ViewportProfileName } from '../infra/workerProtocol';
import { ScannerWorkerClient } from './scannerWorkerClient';
import { createCrawlerService, createStorageCrawlPersistence } from './crawlerFactory';
import type { CrawlResult, CrawlerService } from './crawlerService';
import { runResponsiveScan } from './responsiveScanner';
import { runBlueprintEvidenceCapture } from './blueprintEvidenceCapture';
import {
  runBlueprintLifecycle,
  type BlueprintLifecycleDeps,
  type BlueprintLifecycleOutcome
} from '../blueprint/blueprintLifecycle';
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
  /**
   * When true, load the project's stored session, inject it into the isolated
   * browser context, and fail the scan if authentication does not hold. When
   * false/omitted the run is a normal unauthenticated crawl (unchanged).
   */
  authenticated?: boolean;
  /**
   * Which viewport profiles to capture after the crawl (Phase 7). An empty or
   * omitted list skips responsive capture entirely (the unchanged behaviour).
   */
  viewportProfiles?: ViewportProfileName[];
  /**
   * When true, capture bounded, read-only Blueprint evidence (DOM + computed
   * styles) for each completed page after the crawl and persist it (Phase 9).
   * Opt-in so existing callers are unaffected; a capture failure never changes
   * the crawl's terminal status.
   */
  blueprint?: boolean;
}

export interface ScanRunOutcome {
  scanId: string;
  status: 'completed' | 'failed' | 'cancelled';
  pagesScanned: number;
  pagesDiscovered: number;
  pageFailures: number;
  /** Number of technologies persisted for this scan (Phase 5). */
  technologiesDetected: number;
  /** Pages classified `auth_required` during this scan. */
  pagesAuthRequired: number;
  /** Pages classified `blocked` (CAPTCHA/WAF) during this scan. */
  pagesBlocked: number;
  /** True when a captured session was injected for this run. */
  authenticated: boolean;
  /**
   * Honest Blueprint lifecycle summary when `blueprint: true` was requested for
   * a completed crawl. Absent otherwise. A Blueprint failure is recorded here
   * and never affects `status`.
   */
  blueprint?: BlueprintLifecycleOutcome;
  error: StructuredError | null;
}

export type ScanServiceResult<T> = { ok: true; data: T } | { ok: false; error: StructuredError };

/** Live run bookkeeping so `cancel` can reach the owning service instance. */
interface ActiveScan {
  scanId: string;
  service: CrawlerService;
}

let active: ActiveScan | null = null;

/**
 * Blueprint lifecycle seams. Production passes `{}` so `runBlueprintLifecycle`
 * uses the live storage/sandbox/event-bus wiring; tests inject a fake synthesis
 * + persistence + file I/O without a Tauri shell.
 */
let blueprintLifecycleDeps: BlueprintLifecycleDeps = {};

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
      error: createScannerError('INVALID_URL', {
        message: 'The project for this scan no longer exists.'
      })
    };
  }

  const runtime = runtimeProvider();
  if (!runtime) {
    return {
      ok: false,
      error: createProcessError('PROCESS_SPAWN_FAILED', {
        message: 'The crawler requires the desktop application.',
        suggestedAction:
          'Start the desktop app with `npm run tauri:dev` (the browser preview cannot crawl).'
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

  // For an authenticated run, load and decrypt the stored session BEFORE
  // launching the browser. A missing/expired/mismatched session fails here, so
  // an authenticated scan can never silently degrade into a public crawl.
  const authenticated = request.authenticated === true;
  let authState: AuthStorageState | undefined;
  if (authenticated) {
    const loaded = await loadSessionForScan(request.projectId, validation.url);
    if (!loaded.ok) {
      return { ok: false, error: loaded.error };
    }
    authState = loaded.data;
  }

  const launch = await runtime.launchSession({
    headless: request.headless ?? true,
    ...(authState ? { authState } : {})
  });
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

  eventBus.emit(
    createEvent('auth.scan_started', {
      scanId: request.scanId,
      projectId: request.projectId,
      authenticated
    })
  );

  let blueprintOutcome: BlueprintLifecycleOutcome | undefined;

  try {
    const result = await service.run({
      projectId: request.projectId,
      seedUrl: validation.url,
      scanId: request.scanId,
      sessionId,
      authenticated,
      requireAuthentication: authenticated,
      limits: {
        ...(request.limits?.maxDepth !== undefined ? { maxDepth: request.limits.maxDepth } : {}),
        ...(request.limits?.maxPages !== undefined ? { maxPages: request.limits.maxPages } : {})
      }
    });

    // Responsive viewport capture (Phase 7): only for a completed crawl, and
    // only when the caller requested profiles. A capture failure is reported in
    // the outcome but never changes the crawl's terminal status.
    const requestedProfiles = request.viewportProfiles ?? [];
    if (result.status === 'completed' && requestedProfiles.length > 0) {
      const pages = await storageService.getRepositories().pages.listByScan(result.scanId);
      const capturable = pages
        .filter((page) => page.status === 'completed')
        .map((page) => ({ id: page.id, url: page.finalUrl || page.url }));
      const responsive = await runResponsiveScan(
        {
          scanId: result.scanId,
          projectId: request.projectId,
          sessionId,
          pages: capturable,
          profiles: requestedProfiles
        },
        runtime
      );
      logger.child('scan').info('Responsive capture summary', {
        scanId: result.scanId,
        captured: responsive.captured,
        skipped: responsive.skipped
      });
    }

    // Blueprint evidence capture (Phase 9): only for a completed crawl, and only
    // when the caller opted in. Bounded, read-only DOM/computed-style evidence is
    // captured per completed page and its path persisted on the page row. A
    // capture failure is reported in the log but never changes the crawl's
    // terminal status (the same rule as responsive capture).
    if (result.status === 'completed' && request.blueprint === true) {
      const pages = await storageService.getRepositories().pages.listByScan(result.scanId);
      const capturable = pages
        .filter((page) => page.status === 'completed')
        .map((page) => ({ id: page.id, url: page.finalUrl || page.url }));
      const evidence = await runBlueprintEvidenceCapture(
        {
          scanId: result.scanId,
          projectId: request.projectId,
          sessionId,
          pages: capturable
        },
        { worker: client }
      );
      logger.child('scan').info('Blueprint evidence summary', {
        scanId: result.scanId,
        captured: evidence.captured,
        skipped: evidence.skipped
      });

      // Blueprint synthesis + persistence (Phase 9): runs after evidence capture,
      // after the crawl has already reached its terminal `completed` status. It
      // emits `blueprint.*` events and persists the document/row. `runBlueprint`
      // never throws and `runBlueprintLifecycle` isolates every failure, so this
      // step can NEVER change the crawl's terminal status (the same rule as the
      // responsive/evidence steps). A synthesis failure is recorded honestly in
      // the returned outcome rather than propagated.
      blueprintOutcome = await runBlueprintLifecycle(
        {
          scanId: result.scanId,
          projectId: request.projectId,
          sourceUrl: request.seedUrl
        },
        blueprintLifecycleDeps
      );
      logger.child('scan').info('Blueprint synthesis summary', {
        scanId: result.scanId,
        persisted: blueprintOutcome.blueprintId,
        valid: blueprintOutcome.isValid,
        partial: blueprintOutcome.partial
      });
    }

    return { ok: true, data: toOutcome(result, authenticated, blueprintOutcome) };
  } catch (error) {
    // The service already maps expected failures into `CrawlResult`; this guard
    // keeps an unexpected throw from reaching the UI as a raw stack trace.
    return {
      ok: false,
      error: toStructuredError(error, { code: 'UNKNOWN_ERROR', category: 'process' })
    };
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
  blueprintLifecycleDeps = {};
}

/**
 * Test-only: swap the Blueprint lifecycle seams (synthesis/persistence/file I/O/
 * events) so the integration can be exercised without a Tauri shell. Pass `null`
 * to restore the live wiring.
 */
export function setBlueprintLifecycleDepsForTests(deps: BlueprintLifecycleDeps | null): void {
  blueprintLifecycleDeps = deps ?? {};
}

/** Test-only: swap the browser-runtime provider (pass `null` to restore). */
export function setScanRuntimeProviderForTests(provider: RuntimeProvider | null): void {
  runtimeProvider = provider ?? getBrowserRuntime;
}

function toOutcome(
  result: CrawlResult,
  authenticated: boolean,
  blueprint?: BlueprintLifecycleOutcome
): ScanRunOutcome {
  return {
    scanId: result.scanId,
    status: result.status,
    pagesScanned: result.pagesScanned,
    pagesDiscovered: result.pagesDiscovered,
    pageFailures: result.pageFailures,
    technologiesDetected: result.technologiesDetected,
    pagesAuthRequired: result.pagesAuthRequired,
    pagesBlocked: result.pagesBlocked,
    authenticated,
    ...(blueprint ? { blueprint } : {}),
    error: result.error
  };
}
