/**
 * Webview-safe worker entrypoint resolution - Artupski ReSite
 *
 * This module is imported by the React/webview bundle (browser runtime, scanner
 * client, clone/diff servers). It is deliberately PURE and webview-safe:
 *
 *  - it contains NO `node:*` imports (Vite externalizes those for the browser,
 *    producing `__vite-browser-external` shims that throw if executed);
 *  - it contains NO bare `process` reference (there is no `process` global in the
 *    Tauri webview - only `process.platform` is needed and that is read through
 *    `detectRuntimePlatform()`);
 *  - it performs NO filesystem probe. The Tauri resource directory reported by
 *    `@tauri-apps/api/path` is authoritative for a packaged app, and
 *    `scripts/stageWorkers.mjs` always stages `<resourceDir>/workers/<name>/index.js`.
 *
 * The Node-only resolution used by the dev checkout, unit tests, and the worker
 * smoke test lives in `./crawler/workerPaths.ts` and `./cloneServer/workerPaths.ts`.
 *
 * Root cause this module fixes: the previous call sites resolved the worker via
 * `await import(/* @vite-ignore *\/ '../../workers/crawler/workerPaths')`. Vite
 * left that relative, extensionless specifier unresolved in the production
 * bundle, so at runtime the webview threw
 * `Failed to fetch dynamically imported module: http://tauri.localhost/workers/crawler/workerPaths`.
 */
import {
  buildPackagedWorkerEntrypoint,
  detectRuntimePlatform,
  type WorkerDescriptor,
  type WorkerEntrypoint
} from './workerRuntime';

const CRAWLER: WorkerDescriptor = { name: 'crawler', devFileName: 'index.ts' };
const CLONE_SERVER: WorkerDescriptor = { name: 'cloneServer', devFileName: 'index.ts' };

/**
 * The Tauri resource directory reported by the shell, or `null` outside it.
 *
 * `@tauri-apps/api/path` is imported lazily so this module stays loadable in a
 * plain Node process (unit tests) where no Tauri global exists. A failure to
 * resolve the resource dir is an honest `null`.
 */
export async function resolveTauriResourceDir(): Promise<string | null> {
  const globalWindow = globalThis as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  const inTauri = Boolean(globalWindow.__TAURI_INTERNALS__ || globalWindow.__TAURI__);
  if (!inTauri) {
    return null;
  }
  try {
    const path = await import('@tauri-apps/api/path');
    return await path.resourceDir();
  } catch {
    return null;
  }
}

/** Build the packaged crawler spawn descriptor from a known resource directory. */
export function resolvePackagedCrawlerEntrypoint(resourceDir: string): WorkerEntrypoint {
  return buildPackagedWorkerEntrypoint(resourceDir, detectRuntimePlatform(), CRAWLER);
}

/** Build the packaged clone-server spawn descriptor from a known resource directory. */
export function resolvePackagedCloneServerEntrypoint(resourceDir: string): WorkerEntrypoint {
  return buildPackagedWorkerEntrypoint(resourceDir, detectRuntimePlatform(), CLONE_SERVER);
}
