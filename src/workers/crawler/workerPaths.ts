/**
 * Worker entrypoint resolution - Artupski ReSite
 *
 * Resolves how to launch the dedicated crawler worker (`src/workers/crawler/
 * index.ts`) with the local Node.js runtime. Kept separate from the runtime so
 * the path logic is unit-testable and the Rust spawner receives a plain
 * `{ command, args, cwd }` triple.
 *
 * In a dev checkout the worker is the co-located TypeScript entrypoint executed
 * through Node's native type stripping (Node >= 22.6 / 24). In a PACKAGED app the
 * bundler stages a self-contained `workers/crawler/index.js` under the Tauri
 * resource directory (Phase 16, impl-plan §8.2 / C1), and this module prefers it
 * when present. The resolution order and the pure logic live in
 * `../workerRuntime.ts`; this module only supplies the real environment seams
 * (`import.meta.url`, `process.platform`, the Tauri resource dir, `fs.existsSync`).
 *
 * SECURITY: `command` is always `node`/`node.exe` (on the Rust allowlist) and
 * `args` is an array - there is never a shell string. The worker path is derived
 * from the module location and the app resource directory, not from user input.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
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

/**
 * The Tauri resource directory reported by the shell, or `null` outside it.
 *
 * `@tauri-apps/api/path` is imported lazily so this module stays loadable in a
 * plain Node process (unit tests, the worker smoke test) where no Tauri global
 * exists. A failure to resolve the resource dir is an honest `null` - the dev
 * path is then used and any real problem surfaces through `PROCESS_SPAWN_FAILED`.
 */
async function resolveTauriResourceDir(): Promise<string | null> {
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

/** Build the real resolution environment for the current process. */
function currentEnv(resourceDir: string | null): WorkerResolveEnv {
  return {
    platform: process.platform,
    devDir: dirname(fileURLToPath(import.meta.url)),
    resourceDir,
    exists: (candidate) => existsSync(candidate)
  };
}

/** Absolute path to the crawler entrypoint (packaged `.js` when staged). */
export async function resolveWorkerScriptPathAsync(): Promise<string> {
  const resourceDir = await resolveTauriResourceDir();
  return resolveWithEnv(currentEnv(resourceDir), DESCRIPTOR);
}

/**
 * Build the spawn descriptor for the crawler worker.
 *
 * `resolveWorkerEntrypoint` is async so it can consult the Tauri resource
 * directory. It always resolves (never throws); callers await the descriptor.
 */
export async function resolveWorkerEntrypoint(): Promise<WorkerEntrypoint> {
  const resourceDir = await resolveTauriResourceDir();
  return buildWorkerEntrypoint(currentEnv(resourceDir), DESCRIPTOR);
}

/**
 * Synchronous, dev-only script path. Retained for callers/tests that only need
 * the co-located `.ts` path and run outside the packaged shell.
 */
export function resolveWorkerScriptPath(): string {
  return devWorkerScriptPath(currentEnv(null), DESCRIPTOR);
}
