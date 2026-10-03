/**
 * Clone server entrypoint resolution - Artupski ReSite
 *
 * Resolves how to launch the dedicated clone preview server
 * (`src/workers/cloneServer/index.ts`) with the local Node.js runtime, mirroring
 * `src/workers/crawler/workerPaths.ts`:
 *
 *  - **Node (dev checkout / unit tests):** `resolveCloneServerEntrypoint()`
 *    resolves the co-located `index.ts` (native type stripping). When a Tauri
 *    resource directory IS available it still prefers the bundler-staged
 *    `workers/cloneServer/index.js` there.
 *
 *  - **Tauri webview (packaged app):** this module is NOT used by the webview.
 *    The webview imports the pure, Node-free `../workerEntrypoints.ts` instead,
 *    because it cannot stat the filesystem (`node:fs` is externalized for
 *    browser compatibility) and has no filesystem module URL (Phase 16,
 *    impl-plan §8.2 / C1).
 *
 * SECURITY: `command` is always `node`/`node.exe` (on the Rust allowlist) and
 * `args` is an array - there is never a shell string.
 */
import {
  buildWorkerEntrypoint,
  devWorkerScriptPath,
  resolveWorkerScriptPath as resolveWithEnv,
  type WorkerDescriptor,
  type WorkerEntrypoint,
  type WorkerResolveEnv
} from '../workerRuntime';

export type { WorkerEntrypoint } from '../workerRuntime';

const DESCRIPTOR: WorkerDescriptor = { name: 'cloneServer', devFileName: 'index.ts' };

/** Build the Node resolution environment for the current process. */
async function currentEnv(resourceDir: string | null): Promise<WorkerResolveEnv> {
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname } = await import('node:path');
  return {
    platform: process.platform,
    devDir: dirname(fileURLToPath(import.meta.url)),
    resourceDir,
    exists: (candidate) => existsSync(candidate)
  };
}

/** Build the spawn descriptor for the clone preview server in the current process. */
export async function resolveCloneServerEntrypoint(): Promise<WorkerEntrypoint> {
  return buildWorkerEntrypoint(await currentEnv(null), DESCRIPTOR);
}

/**
 * Absolute path to the clone server entrypoint (packaged `.js` when staged).
 *
 * Node-only: it probes the filesystem. The webview uses
 * `../workerEntrypoints.ts` instead.
 */
export async function resolveCloneServerScriptPathAsync(): Promise<string> {
  return resolveWithEnv(await currentEnv(null), DESCRIPTOR);
}

/** Dev-only script path (co-located `.ts`). Node-only. */
export async function resolveCloneServerScriptPath(): Promise<string> {
  return devWorkerScriptPath(await currentEnv(null), DESCRIPTOR);
}
