/**
 * Worker entrypoint resolution - Artupski ReSite
 *
 * Resolves how to launch the dedicated crawler worker (`src/workers/crawler/
 * index.ts`) with the local Node.js runtime. Kept separate from the runtime so
 * the path logic is unit-testable and the Rust spawner receives a plain
 * `{ command, args, cwd }` triple.
 *
 * There are exactly two callers, with different needs:
 *
 *  - **Node (dev checkout / unit tests / worker smoke test):**
 *    `resolveWorkerEntrypoint()` resolves the co-located `index.ts`, executed
 *    through Node's native type stripping (Node >= 22.6 / 24). When a Tauri
 *    resource directory IS available it still prefers the bundler-staged
 *    `workers/crawler/index.js` there; the pure order lives in `workerRuntime`.
 *
 *  - **Tauri webview (packaged app):** this module is NOT used by the webview.
 *    The webview imports the pure, Node-free `../workerEntrypoints.ts` instead,
 *    because it cannot stat the filesystem (`node:fs` is externalized for browser
 *    compatibility) and has no filesystem module URL (`import.meta.url` is
 *    `http://tauri.localhost/…`).
 *
 * Keeping the Node-only imports out of the webview path is deliberate: an
 * earlier revision resolved the entrypoint in the webview through a
 * `/* @vite-ignore *\/` dynamic import, which Vite left unresolved and which
 * threw at runtime with
 * `Failed to fetch dynamically imported module: .../workers/crawler/workerPaths`.
 *
 * SECURITY: `command` is always `node`/`node.exe` (on the Rust allowlist) and
 * `args` is an array - there is never a shell string. The worker path is derived
 * from the app resource directory, not from user input.
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

const DESCRIPTOR: WorkerDescriptor = { name: 'crawler', devFileName: 'index.ts' };

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

/**
 * Build the spawn descriptor for the crawler worker in the current process.
 *
 * Node-only (it probes the filesystem). It always resolves (never throws);
 * callers await the descriptor.
 */
export async function resolveWorkerEntrypoint(): Promise<WorkerEntrypoint> {
  return buildWorkerEntrypoint(await currentEnv(null), DESCRIPTOR);
}

/**
 * Absolute path to the crawler entrypoint (packaged `.js` when staged).
 *
 * Node-only: it probes the filesystem. The webview uses
 * `../workerEntrypoints.ts` instead.
 */
export async function resolveWorkerScriptPathAsync(): Promise<string> {
  return resolveWithEnv(await currentEnv(null), DESCRIPTOR);
}

/**
 * Dev-only script path. Retained for callers/tests that only need the
 * co-located `.ts` path and run outside the packaged shell.
 *
 * Node-only: it derives the path from `import.meta.url`.
 */
export async function resolveWorkerScriptPath(): Promise<string> {
  return devWorkerScriptPath(await currentEnv(null), DESCRIPTOR);
}
