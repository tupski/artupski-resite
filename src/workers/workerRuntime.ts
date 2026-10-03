/**
 * Worker entrypoint resolution (dev + packaged) - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 8.2 and 14 (C1).
 *
 * Both Node workers (the crawler `src/workers/crawler/index.ts` and the clone
 * preview server `src/workers/cloneServer/index.ts`) are launched through the
 * Rust `process_spawn` command, which only allows `node`/`node.exe`. In a dev
 * checkout the worker is a co-located `.ts` file executed through Node's native
 * type stripping; in a PACKAGED app that `.ts` file does not exist, so the
 * worker is staged by the bundler (see `scripts/stageWorkers.mjs`) as a
 * self-contained `.js` bundle under the Tauri resource directory.
 *
 * This module is deliberately PURE: it never imports Tauri, `node:fs`, or
 * `node:url`. The environment (platform, resource dir, existence probe) is
 * injected, so the resolution order is unit-testable without a shell. The
 * `workerPaths.ts` modules supply the real seams.
 *
 * SECURITY: `command` is always `node`/`node.exe` (the Rust allowlist) and
 * `args` is always an ARRAY - there is never a shell string. The worker path is
 * derived from the module location and the app's resource directory, never from
 * user input.
 */

/** A plain spawn descriptor understood by the Rust `process_spawn` command. */
export interface WorkerEntrypoint {
  command: string;
  args: string[];
  cwd: string;
}

/** The only executables the Rust process layer permits (must stay in sync). */
export const ALLOWED_WORKER_COMMANDS: readonly string[] = ['node', 'node.exe'];

/** Which worker tree is being resolved. */
export interface WorkerDescriptor {
  /** Directory/bundle name, e.g. `crawler` or `cloneServer`. */
  name: string;
  /** The co-located dev entrypoint file name (always `index.ts` today). */
  devFileName: string;
}

/** Injectable environment used to resolve the packaged worker without Tauri. */
export interface WorkerResolveEnv {
  /** `process.platform` (injected so tests can exercise both branches). */
  platform: string;
  /** Absolute directory holding the dev co-located `.ts` entrypoint. */
  devDir: string;
  /**
   * Absolute Tauri resource directory (where `<resourceDir>/workers/<name>/`
   * is staged), or `null` when unknown / outside a packaged app.
   */
  resourceDir: string | null;
  /** Existence probe (Node `fs.existsSync` in production; injected in tests). */
  exists: (path: string) => boolean;
}

/**
 * The platform-appropriate Node command. This is the ONLY command the resolver
 * ever emits and it is always on the Rust allowlist.
 */
export function allowlistedNodeCommand(platform: string): string {
  return platform === 'win32' ? 'node.exe' : 'node';
}

/** Absolute packaged worker path inside the resource directory. */
export function packagedWorkerScriptPath(
  resourceDir: string,
  descriptor: WorkerDescriptor
): string {
  // Packaged workers are plain CommonJS `.js` bundles (no type stripping needed).
  return joinPath(resourceDir, 'workers', descriptor.name, 'index.js');
}

/** The co-located dev worker path (`<devDir>/index.ts`). */
export function devWorkerScriptPath(env: WorkerResolveEnv, descriptor: WorkerDescriptor): string {
  return joinPath(env.devDir, descriptor.devFileName);
}

/**
 * Resolve the worker script path with the documented fallback order:
 *
 *   1. **Packaged**: `<resourceDir>/workers/<name>/index.js` when a resource
 *      directory is known AND that file exists.
 *   2. **Dev**: the co-located `<devDir>/index.ts` (current behaviour) when it
 *      exists.
 *   3. **Honest fallback**: the dev candidate even when neither exists, so the
 *      existing `PROCESS_SPAWN_FAILED` path reports the real, unresolvable path
 *      instead of silently succeeding.
 *
 * The packaged candidate is preferred first so a packaged app never accidentally
 * resolves a stale dev file; within a dev checkout `resourceDir` is `null`, so
 * dev resolution is unchanged.
 */
export function resolveWorkerScriptPath(
  env: WorkerResolveEnv,
  descriptor: WorkerDescriptor
): string {
  const dev = devWorkerScriptPath(env, descriptor);
  if (env.resourceDir) {
    const packaged = packagedWorkerScriptPath(env.resourceDir, descriptor);
    if (env.exists(packaged)) {
      return packaged;
    }
  }
  return dev;
}

/**
 * Build the spawn descriptor for a worker. `args` is always an array and the
 * command is always the allowlisted Node binary; a packaged worker is a `.js`
 * file so no type-stripping flag is added.
 */
export function buildWorkerEntrypoint(
  env: WorkerResolveEnv,
  descriptor: WorkerDescriptor
): WorkerEntrypoint {
  const script = resolveWorkerScriptPath(env, descriptor);
  const packaged = script.endsWith('.js');
  const args = packaged ? [script] : ['--experimental-strip-types', script];
  return {
    command: allowlistedNodeCommand(env.platform),
    args,
    cwd: dirnamePath(script)
  };
}

/* -------------------------------------------------------------------------- */
/* Minimal, dependency-free POSIX path helpers                                */
/* -------------------------------------------------------------------------- */

/** Join path segments with `/` (Node accepts `/` on Windows too). */
function joinPath(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
}

/** Directory portion of a path (POSIX or Windows separators). */
function dirnamePath(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const index = normalised.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '.';
}
