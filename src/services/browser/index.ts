/**
 * Browser service surface - Artupski ReSite
 *
 * Mirrors the storage service seam: a module-level singleton that the app root
 * initializes non-blocking, plus accessors. It degrades safely outside the
 * Tauri runtime (browser preview, tests) by resolving to `null` and doing
 * nothing, so a missing browser never blocks or crashes the app.
 */
import {
  BrowserRuntime,
  createDefaultBrowserRuntime,
  type BrowserDiagnostics,
  type BrowserRuntimeState,
  type BrowserSession
} from './browserRuntime';

let runtime: BrowserRuntime | null = null;
let initPromise: Promise<BrowserRuntime | null> | null = null;

/**
 * Resolve and initialize the browser runtime once. Idempotent: concurrent or
 * repeated calls share one promise. Never throws.
 */
export function initializeBrowserRuntime(): Promise<BrowserRuntime | null> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    runtime = await createDefaultBrowserRuntime();
    if (runtime) {
      await runtime.initialize();
    }
    return runtime;
  })();
  return initPromise;
}

/** The live runtime, or `null` before init / outside the Tauri shell. */
export function getBrowserRuntime(): BrowserRuntime | null {
  return runtime;
}

export function getBrowserRuntimeState(): BrowserRuntimeState {
  return runtime?.getState() ?? 'uninitialized';
}

export function getBrowserDiagnostics(): BrowserDiagnostics | null {
  return runtime?.getDiagnostics() ?? null;
}

export function getBrowserSession(): BrowserSession | null {
  return runtime?.getSession() ?? null;
}

/** Test-only hook to reset the singleton between cases. */
export async function resetBrowserRuntimeForTests(): Promise<void> {
  if (runtime) {
    await runtime.resetForTests();
  }
  runtime = null;
  initPromise = null;
}

export {
  BrowserRuntime,
  createDefaultBrowserRuntime,
  ProcessManagerBrowserWorker,
  MAX_BROWSER_TIMEOUT_MS,
  type BrowserDiagnostics,
  type BrowserRuntimeState,
  type BrowserSession,
  type BrowserResult,
  type BrowserWorkerAdapter
} from './browserRuntime';
