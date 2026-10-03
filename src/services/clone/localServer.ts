/**
 * Local clone preview server - Artupski ReSite
 * Source of truth: docs/architecture/ARCHITECTURE.md section 2 (Layer 1) and
 * docs/specs/CLONE-SPEC.md section 6, plus the Phase 8 impl plan (open decision C5).
 *
 * Owns the lifecycle of the `cloneServer` worker through the shared
 * `ProcessManager` (AGENTS.md: no unmanaged long-running child processes). The
 * server binds loopback-only and is confined to the canonical clone root passed
 * by the Rust `clone_root` command; the returned URL is opened in the SYSTEM
 * browser so the webview CSP `connect-src` is never widened.
 *
 * The runtime is injectable so this service is unit-testable without a Tauri
 * shell, mirroring `scanService`.
 */
import { createEvent, eventBus } from '../infra/eventBus';
import { logger } from '../infra/logger';
import { createStructuredError, toStructuredError, type StructuredError } from '../infra/errors';
import type { ProcessManager } from '../infra/processManager';
import type { WorkerCommandPayload, WorkerResultPayload } from '../infra/workerProtocol';
import {
  resolvePackagedCloneServerEntrypoint,
  resolveTauriResourceDir
} from '../../workers/workerEntrypoints';

export type LocalServerResult<T> = { ok: true; data: T } | { ok: false; error: StructuredError };

/** The ProcessManager-backed boundary this service depends on (injectable). */
export interface CloneServerAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): string;
  request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload>;
}

export interface LocalServerHandle {
  url: string;
  port: number;
  root: string;
}

/** The signature used to launch the server (so tests can supply a fake). */
export interface CloneServerOptions {
  adapter?: CloneServerAdapter;
  /** Optional port preference; 0/undefined means ephemeral. */
  port?: number;
}

const log = logger.child('clone');

/**
 * Start the preview server for `root` and return its loopback URL. Never throws
 * - a failure is returned as a structured error.
 */
export async function startLocalServer(
  root: string,
  options: CloneServerOptions = {}
): Promise<LocalServerResult<LocalServerHandle>> {
  const adapter = options.adapter ?? (await resolveDefaultAdapter());
  if (!adapter) {
    return {
      ok: false,
      error: createStructuredError({
        code: 'IPC_ERROR',
        category: 'ipc',
        message: 'The local preview server is only available in the desktop shell.',
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
          message: 'The preview server returned an unexpected result.',
          severity: 'error',
          recoverable: true,
          suggestedAction: 'Retry starting the preview.'
        })
      };
    }
    eventBus.emit(createEvent('clone.server_started', { url: payload.url }));
    log.info('Clone preview server started', { port: payload.port });
    return { ok: true, data: { url: payload.url, port: payload.port, root: payload.root } };
  } catch (error) {
    const structured = toStructuredError(error);
    eventBus.emit(
      createEvent('clone.failed', {
        scanId: null,
        code: structured.code,
        message: structured.message
      })
    );
    return { ok: false, error: structured };
  }
}

/** Stop the preview server if it is running. Never throws. */
export async function stopLocalServer(
  options: CloneServerOptions = {}
): Promise<LocalServerResult<boolean>> {
  const adapter = options.adapter ?? (await resolveDefaultAdapter());
  if (!adapter) {
    return { ok: true, data: false };
  }
  try {
    const payload = await adapter.request({ command: 'stopClone' });
    const stopped = payload.command === 'stopClone' ? payload.stopped : false;
    if (stopped) {
      eventBus.emit(createEvent('clone.server_stopped', {}));
    }
    return { ok: true, data: stopped };
  } catch (error) {
    return { ok: false, error: toStructuredError(error) };
  }
}

/** Resolve the production adapter (ProcessManager over the Rust spawner). */
async function resolveDefaultAdapter(): Promise<CloneServerAdapter | null> {
  const { isTauriRuntime } = await import('../ipc/tauri');
  if (!isTauriRuntime()) {
    log.debug('Skipping clone preview server outside the Tauri shell.');
    return null;
  }
  const { ProcessManager } = await import('../infra/processManager');
  const { TauriProcessSpawner } = await import('../infra/tauriProcessSpawner');
  // Static, webview-safe resolver (no `node:*`, no unresolved `@vite-ignore`
  // dynamic import); the packaged path comes from the Tauri resource directory.
  const resourceDir = await resolveTauriResourceDir();
  if (!resourceDir) {
    return null;
  }
  const entry = resolvePackagedCloneServerEntrypoint(resourceDir);
  const manager = new ProcessManager({
    name: 'clone-server',
    spawner: new TauriProcessSpawner(),
    spawn: { command: entry.command, args: entry.args, cwd: entry.cwd }
  });
  return new ProcessManagerCloneServerAdapter(manager);
}

/** Production adapter: maps the server operations onto the shared protocol. */
class ProcessManagerCloneServerAdapter implements CloneServerAdapter {
  constructor(private readonly manager: ProcessManager) {}

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
