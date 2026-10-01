/**
 * Tauri process spawner - Artupski ReSite
 *
 * Production implementation of `ProcessSpawner` (see `processManager.ts`). It
 * maps the ProcessManager's spawn/write/kill calls onto the sandboxed Rust
 * commands in `src-tauri/src/process.rs` and bridges the native
 * `process://stdout|stderr|exit` events back into a `SpawnedProcess` handle.
 *
 * This mirrors the `NativeStorageFile` swap/injection pattern: the native
 * mechanism lives here, while the lifecycle logic stays testable and browser-safe.
 *
 * SECURITY.md section 6: the executable allowlist, environment sanitization,
 * and kill-tree behaviour are enforced natively - this adapter cannot widen them.
 */
import type { ProcessExitInfo, SpawnedProcess, SpawnOptions, ProcessSpawner } from './processManager';
import { createProcessError } from './processErrors';

/**
 * Minimal structural view of the native IPC surface this adapter depends on.
 * Kept as an interface so tests can inject a fake without the Tauri runtime.
 */
export interface ProcessIpcClient {
  processSpawn(args: SpawnOptions): Promise<{ id: string; pid: number }>;
  processWrite(id: string, data: string): Promise<void>;
  processKill(id: string, force: boolean): Promise<boolean>;
  onStdout(id: string, handler: (line: string) => void): Promise<() => void>;
  onStderr(id: string, handler: (line: string) => void): Promise<() => void>;
  onExit(id: string, handler: (info: ProcessExitInfo) => void): Promise<() => void>;
}

/** Build the real Tauri-backed IPC client. */
async function createTauriProcessIpc(): Promise<ProcessIpcClient> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  return {
    processSpawn: async (args) => {
      // The Rust command takes a single `request` argument object.
      return invoke<{ id: string; pid: number }>('process_spawn', {
        request: {
          command: args.command,
          args: args.args,
          cwd: args.cwd,
          env: args.env
        }
      });
    },
    processWrite: (id, data) => invoke<void>('process_write', { id, data }),
    processKill: (id, force) => invoke<boolean>('process_kill', { id, force }),
    onStdout: async (id, handler) => {
      const unlisten = await listen<{ id: string; line: string }>('process://stdout', (event) => {
        if (event.payload.id === id) {
          handler(event.payload.line);
        }
      });
      return unlisten;
    },
    onStderr: async (id, handler) => {
      const unlisten = await listen<{ id: string; line: string }>('process://stderr', (event) => {
        if (event.payload.id === id) {
          handler(event.payload.line);
        }
      });
      return unlisten;
    },
    onExit: async (id, handler) => {
      const unlisten = await listen<{ id: string; code: number | null; signal: number | null }>(
        'process://exit',
        (event) => {
          if (event.payload.id === id) {
            handler({ code: event.payload.code, signal: event.payload.signal });
          }
        }
      );
      return unlisten;
    }
  };
}

/** A `SpawnedProcess` handle backed by the Rust process commands. */
export class TauriSpawnedProcess implements SpawnedProcess {
  readonly pid: number;
  private readonly id: string;
  private readonly ipc: ProcessIpcClient;

  constructor(id: string, pid: number, ipc: ProcessIpcClient) {
    this.id = id;
    this.pid = pid;
    this.ipc = ipc;
  }

  write(data: string): void {
    // Fire-and-forget: the ProcessManager surfaces a rejection through the
    // request timeout if the write never lands.
    void this.ipc.processWrite(this.id, data).catch(() => undefined);
  }

  async kill(): Promise<void> {
    await this.ipc.processKill(this.id, false);
  }

  async forceKill(): Promise<void> {
    await this.ipc.processKill(this.id, true);
  }

  onStdout(listener: (chunk: string) => void): () => void {
    return subscribe(this.ipc.onStdout(this.id, (line) => listener(`${line}\n`)));
  }

  onStderr(listener: (chunk: string) => void): () => void {
    return subscribe(this.ipc.onStderr(this.id, (line) => listener(`${line}\n`)));
  }

  onExit(listener: (info: ProcessExitInfo) => void): () => void {
    return subscribe(this.ipc.onExit(this.id, listener));
  }
}

/**
 * Bridge an async listener registration into the synchronous disposer that the
 * ProcessManager expects. Disposal before registration resolves still works.
 */
function subscribe(registration: Promise<() => void>): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void registration.then((fn) => {
    if (disposed) {
      fn();
    } else {
      unlisten = fn;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/**
 * Production `ProcessSpawner` backed by the sandboxed Rust commands.
 *
 * Throws `PROCESS_SPAWN_FAILED` if the native runtime is unavailable or the
 * spawn command rejects (allowlist/argument/env validation happens natively).
 */
export class TauriProcessSpawner implements ProcessSpawner {
  private readonly ipcPromise: Promise<ProcessIpcClient>;

  constructor(ipc?: ProcessIpcClient) {
    this.ipcPromise = ipc ? Promise.resolve(ipc) : createTauriProcessIpc();
  }

  async spawn(options: SpawnOptions): Promise<SpawnedProcess> {
    try {
      const ipc = await this.ipcPromise;
      const handle = await ipc.processSpawn(options);
      return new TauriSpawnedProcess(handle.id, handle.pid, ipc);
    } catch (cause) {
      throw createProcessError('PROCESS_SPAWN_FAILED', {
        message: `Failed to spawn "${options.command}".`,
        cause
      });
    }
  }
}
