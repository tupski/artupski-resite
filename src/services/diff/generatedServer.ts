/**
 * Generated project dev server - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 13 task 1 - "launch generated
 * project in background dev server"), docs/architecture/ARCHITECTURE.md section 2
 * Layer 1, and docs/impl-plan/phase-13-impl-plan.md sections 6, 10-11.
 *
 * Owns the lifecycle of the local static server that serves a Phase 12 generated
 * project for screenshot capture. It mirrors the Phase 8 clone preview server
 * (`src/services/clone/localServer.ts`) exactly:
 *
 *  - the server is a `ProcessManager`-managed Node child (AGENTS.md: no unmanaged
 *    long-running child processes);
 *  - it binds LOOPBACK ONLY and serves strictly inside the generated project root
 *    (path confinement is enforced by the shared `serverPathPolicy`);
 *  - the runtime is injectable so this service is unit-testable without a Tauri
 *    shell or a real server;
 *  - it NEVER executes the generated application code (only the static server
 *    process runs) and never touches the database.
 *
 * The generated project is served as STATIC BUILT OUTPUT (`dist/`) so no
 * dependency install or framework dev server is required at diff time. The
 * caller supplies the directory to serve; `resolveGeneratedServeRoot` maps a
 * generated project root to its `dist/` directory.
 */
import { createEvent, eventBus } from '../infra/eventBus';
import { logger } from '../infra/logger';
import { createStructuredError, toStructuredError, type StructuredError } from '../infra/errors';
import type { WorkerCommandPayload, WorkerResultPayload } from '../infra/workerProtocol';

export type GeneratedServerResult<T> =
  { ok: true; data: T } | { ok: false; error: StructuredError };

/** The ProcessManager-backed boundary this service depends on (injectable). */
export interface GeneratedServerAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): string;
  request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload>;
}

export interface GeneratedServerHandle {
  url: string;
  port: number;
  root: string;
}

export interface GeneratedServerOptions {
  adapter?: GeneratedServerAdapter;
  /** Optional port preference; 0/undefined means ephemeral. */
  port?: number;
}

const log = logger.child('diff');

/**
 * Translate a generated project root into the directory the diff server serves.
 * The Phase 12 output is a Vite project whose runnable artifact is `dist/`, so
 * the served root is `<projectRoot>/dist`. The traversal rules are re-checked by
 * the shared policy at request time regardless.
 */
export function resolveGeneratedServeRoot(projectRoot: string): string {
  const normalized = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${normalized}/dist`;
}

/**
 * Start the static server for a generated project's built output. Never throws -
 * a failure is returned as a structured error.
 */
export async function startGeneratedServer(
  root: string,
  options: GeneratedServerOptions = {}
): Promise<GeneratedServerResult<GeneratedServerHandle>> {
  const adapter = options.adapter ?? (await resolveDefaultAdapter());
  if (!adapter) {
    return {
      ok: false,
      error: createStructuredError({
        code: 'IPC_ERROR',
        category: 'ipc',
        message: 'The generated preview server is only available in the desktop shell.',
        severity: 'warning',
        recoverable: true,
        suggestedAction: 'Run the desktop shell with `npm run tauri:dev`.'
      })
    };
  }

  try {
    if (adapter.getState() !== 'ready' && adapter.getState() !== 'busy') {
      await adapter.start();
    }
    const payload = await adapter.request({ command: 'serveClone', root, port: options.port ?? 0 });
    if (payload.command !== 'serveClone') {
      return {
        ok: false,
        error: createStructuredError({
          code: 'WORKER_PROTOCOL_VIOLATION',
          category: 'process',
          message: 'The generated preview server returned an unexpected result.',
          severity: 'error',
          recoverable: true,
          suggestedAction: 'Retry the visual comparison.'
        })
      };
    }
    log.info('Generated project server started', { port: payload.port });
    return { ok: true, data: { url: payload.url, port: payload.port, root: payload.root } };
  } catch (error) {
    return { ok: false, error: toStructuredError(error) };
  }
}

/** Stop the generated preview server if it is running. Never throws. */
export async function stopGeneratedServer(
  options: GeneratedServerOptions = {}
): Promise<GeneratedServerResult<boolean>> {
  const adapter = options.adapter ?? (await resolveDefaultAdapter());
  if (!adapter) {
    return { ok: true, data: false };
  }
  try {
    const payload = await adapter.request({ command: 'stopClone' });
    const stopped = payload.command === 'stopClone' ? payload.stopped : false;
    return { ok: true, data: stopped };
  } catch (error) {
    return { ok: false, error: toStructuredError(error) };
  }
}

/** Emit the bounded `diff.failed` event for a server failure. */
export function reportGeneratedServerFailure(error: StructuredError): void {
  eventBus.emit(
    createEvent('diff.failed', {
      code: error.code,
      message: error.message
    })
  );
}

/** Resolve the production adapter (ProcessManager over the Rust spawner). */
async function resolveDefaultAdapter(): Promise<GeneratedServerAdapter | null> {
  const { isTauriRuntime } = await import('../ipc/tauri');
  if (!isTauriRuntime()) {
    log.debug('Skipping generated preview server outside the Tauri shell.');
    return null;
  }
  const { ProcessManager } = await import('../infra/processManager');
  const { TauriProcessSpawner } = await import('../infra/tauriProcessSpawner');
  // The Phase 8 clone preview server is the exact loopback + root-confined static
  // server this phase needs; it is reused rather than duplicated (impl plan §17).
  const workerPathsModule = '../../workers/cloneServer/workerPaths';
  const { resolveCloneServerEntrypoint } = (await import(/* @vite-ignore */ workerPathsModule)) as {
    resolveCloneServerEntrypoint: () => { command: string; args: string[]; cwd: string };
  };
  const entry = resolveCloneServerEntrypoint();
  const manager = new ProcessManager({
    name: 'diff-server',
    spawner: new TauriProcessSpawner(),
    spawn: { command: entry.command, args: entry.args, cwd: entry.cwd }
  });
  return new ProcessManagerGeneratedServerAdapter(manager);
}

/** Production adapter: maps server operations onto the shared protocol. */
class ProcessManagerGeneratedServerAdapter implements GeneratedServerAdapter {
  constructor(private readonly manager: ProcessManagerHandle) {}

  start(): Promise<void> {
    return this.manager.start();
  }

  stop(): Promise<void> {
    return this.manager.stop();
  }

  getState(): string {
    return this.manager.getState();
  }

  request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload> {
    return this.manager.request(command, timeoutMs);
  }
}

/** Structural view of `ProcessManager` used here (avoids a value import cycle). */
interface ProcessManagerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): string;
  request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload>;
}
