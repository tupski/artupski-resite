/**
 * Clone server entrypoint resolution - Artupski ReSite
 *
 * Resolves how to launch the dedicated clone preview server
 * (`src/workers/cloneServer/index.ts`) with the local Node.js runtime, mirroring
 * `src/workers/crawler/workerPaths.ts`: a co-located `.ts` entrypoint in a dev
 * checkout, or the bundler-staged `workers/cloneServer/index.js` inside a
 * packaged app (Phase 16, impl-plan §8.2 / C1). The pure resolution order lives
 * in `../workerRuntime.ts`.
 *
 * SECURITY: `command` is always `node`/`node.exe` (on the Rust allowlist) and
 * `args` is an array - there is never a shell string.
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

const DESCRIPTOR: WorkerDescriptor = { name: 'cloneServer', devFileName: 'index.ts' };

/** The Tauri resource directory reported by the shell, or `null` outside it. */
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

/** Absolute path to the clone server entrypoint (packaged `.js` when staged). */
export async function resolveCloneServerScriptPathAsync(): Promise<string> {
  const resourceDir = await resolveTauriResourceDir();
  return resolveWithEnv(currentEnv(resourceDir), DESCRIPTOR);
}

/** Build the spawn descriptor for the clone preview server. */
export async function resolveCloneServerEntrypoint(): Promise<WorkerEntrypoint> {
  const resourceDir = await resolveTauriResourceDir();
  return buildWorkerEntrypoint(currentEnv(resourceDir), DESCRIPTOR);
}

/** Synchronous, dev-only script path (co-located `.ts`). */
export function resolveCloneServerScriptPath(): string {
  return devWorkerScriptPath(currentEnv(null), DESCRIPTOR);
}
