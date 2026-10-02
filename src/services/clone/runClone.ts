/**
 * Reproduce a clone for the UI - Artupski ReSite
 *
 * The single seam the React store uses to run a static clone: it resolves the
 * browser runtime, launches an isolated session, resolves the sandboxed clone
 * root via the Rust `clone_root` command, runs the `CloneService`, and closes
 * the session. It owns no rewriting/SQL/URL policy of its own.
 *
 * Honest failure: outside the Tauri shell (or without a ready browser) it
 * reports that plainly instead of pretending a clone can run.
 */
import { storageService } from '../storage';
import { cloneRoot } from '../ipc';
import { getBrowserRuntime, type BrowserRuntime } from '../browser';
import { ScannerWorkerClient } from '../scanner/scannerWorkerClient';
import { createScannerError } from '../scanner/errors';
import { createProcessError } from '../infra/processErrors';
import { createStorageError } from '../storage/errors';
import { toStructuredError, type StructuredError } from '../infra/errors';
import { createCloneService, createStorageClonePersistence } from './cloneFactory';
import { CloneService } from './cloneService';
import type { CloneManifest, CloneReport } from '../../types/clone';

export interface RunCloneRequest {
  scanId: string;
  projectId: string;
  /** Seed URL whose origin anchors the route map. */
  seedUrl: string;
  headless?: boolean;
}

export interface RunCloneOutcome {
  report: CloneReport;
  manifest?: CloneManifest;
  /** The resolved sandboxed clone root (for the preview server). */
  root: string;
}

export type RunCloneResult =
  { ok: true; data: RunCloneOutcome } | { ok: false; error: StructuredError };

type RuntimeProvider = () => BrowserRuntime | null;
let runtimeProvider: RuntimeProvider = getBrowserRuntime;

/** Inject the clone service factory (tests supply a fake). */
type CloneServiceFactory = (worker: ScannerWorkerClient) => CloneService;
let serviceFactory: CloneServiceFactory = createCloneService;

/** Run one static clone for a scan. Never throws; failures are returned. */
export async function runClone(request: RunCloneRequest): Promise<RunCloneResult> {
  if (storageService.getState() !== 'ready') {
    return {
      ok: false,
      error: createStorageError('STORAGE_NOT_READY', {
        message: 'Cannot generate the clone: local storage is not ready.'
      })
    };
  }

  const runtime = runtimeProvider();
  if (!runtime) {
    return {
      ok: false,
      error: createProcessError('PROCESS_SPAWN_FAILED', {
        message: 'The static clone engine requires the desktop application.',
        suggestedAction: 'Start the desktop app with `npm run tauri:dev`.'
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

  const rootResult = await cloneRoot();
  if (!rootResult.ok) {
    return { ok: false, error: rootResult.error };
  }

  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(request.seedUrl).origin;
  } catch {
    return {
      ok: false,
      error: createScannerError('INVALID_URL', { message: 'The scan target URL is invalid.' })
    };
  }

  const launch = await runtime.launchSession({ headless: request.headless ?? true });
  if (!launch.ok) {
    return { ok: false, error: launch.error };
  }
  const sessionId = launch.data.sessionId;

  try {
    const client = new ScannerWorkerClient(runtime.getWorkerAdapter());
    const service = serviceFactory(client);
    const result = await service.run({
      scanId: request.scanId,
      projectId: request.projectId,
      sessionId,
      sourceOrigin
    });
    if (!result.ok || !result.report) {
      return {
        ok: false,
        error:
          result.error ??
          toStructuredError(new Error('The clone run produced no report.'), {
            code: 'UNKNOWN_ERROR',
            category: 'process'
          })
      };
    }
    return {
      ok: true,
      data: { report: result.report, manifest: result.manifest, root: rootResult.data }
    };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, { code: 'UNKNOWN_ERROR', category: 'process' })
    };
  } finally {
    await runtime.closeSession(sessionId);
  }
}

/** True when a clone run can be attempted in this environment (best-effort). */
export function isCloneAvailable(): boolean {
  return runtimeProvider() !== null;
}

/** Test-only: swap the browser-runtime provider. */
export function setCloneRuntimeProviderForTests(provider: RuntimeProvider | null): void {
  runtimeProvider = provider ?? getBrowserRuntime;
}

/** Test-only: swap the clone service factory. */
export function setCloneServiceFactoryForTests(factory: CloneServiceFactory | null): void {
  serviceFactory = factory ?? createCloneService;
}

/** Re-export for callers that need the persistence adapter directly. */
export { createStorageClonePersistence };
