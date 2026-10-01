import { describe, expect, it, vi } from 'vitest';
import { ProcessManager } from './processManager';
import type {
  ProcessExitInfo,
  ProcessSpawner,
  SpawnOptions,
  SpawnedProcess
} from './processManager';
import {
  MAX_FRAME_BYTES,
  createResultMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  type WorkerCommandMessage,
  type WorkerResultPayload
} from './workerProtocol';
import type { StructuredError } from './errors';

type Behavior = 'ok' | 'no-handshake' | 'malformed-handshake' | 'spawn-error';

interface FakeOptions {
  behavior?: Behavior;
  /** Delay before a graceful kill emits the exit event (ms). */
  killDelayMs?: number;
  /** When true, kill() never emits an exit (forces the grace timeout path). */
  killHangs?: boolean;
}

/** In-memory stand-in for a spawned child process. */
class FakeProcess implements SpawnedProcess {
  readonly pid = 4321;
  killed = false;
  forceKilled = false;
  readonly received: WorkerCommandMessage[] = [];

  private readonly stdoutListeners = new Set<(chunk: string) => void>();
  private readonly stderrListeners = new Set<(chunk: string) => void>();
  private readonly exitListeners = new Set<(info: ProcessExitInfo) => void>();

  constructor(private readonly options: FakeOptions) {}

  write(data: string): void {
    const decoded = decodeFrames(data);
    for (const frame of decoded.frames) {
      const parsed = parseMessage(frame);
      if (!parsed.ok || parsed.message.type !== 'command') {
        continue;
      }
      this.received.push(parsed.message);
      this.respond(parsed.message);
    }
  }

  private respond(command: WorkerCommandMessage): void {
    if (command.payload.command === 'ping') {
      if (this.options.behavior === 'no-handshake') {
        return; // never answer -> startup timeout
      }
      if (this.options.behavior === 'malformed-handshake') {
        this.emitStdout('{ this is not json ');
        return;
      }
      const payload: WorkerResultPayload = {
        command: 'ping',
        pong: true,
        workerVersion: '0.1.0',
        browser: { engine: 'chromium', installed: true, executablePath: '/fake/chromium' }
      };
      this.emitStdout(serializeMessage(createResultMessage(command.id, payload)).trimEnd());
      return;
    }
    const payload: WorkerResultPayload = { command: 'ping', pong: true, workerVersion: '0.1.0' };
    this.emitStdout(serializeMessage(createResultMessage(command.id, payload)).trimEnd());
  }

  emitStdout(frame: string): void {
    for (const listener of [...this.stdoutListeners]) {
      listener(`${frame}\n`);
    }
  }

  emitStderr(frame: string): void {
    for (const listener of [...this.stderrListeners]) {
      listener(`${frame}\n`);
    }
  }

  /** Simulate the process exiting on its own. */
  emitExit(info: ProcessExitInfo = { code: 0, signal: null }): void {
    for (const listener of [...this.exitListeners]) {
      listener(info);
    }
  }

  kill(): Promise<void> {
    this.killed = true;
    if (!this.options.killHangs) {
      setTimeout(() => this.emitExit({ code: 0, signal: null }), this.options.killDelayMs ?? 0);
    }
    return Promise.resolve();
  }

  forceKill(): Promise<void> {
    this.forceKilled = true;
    this.emitExit({ code: null, signal: 9 });
    return Promise.resolve();
  }

  onStdout(listener: (chunk: string) => void): () => void {
    this.stdoutListeners.add(listener);
    return () => this.stdoutListeners.delete(listener);
  }

  onStderr(listener: (chunk: string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }

  onExit(listener: (info: ProcessExitInfo) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }
}

class FakeSpawner implements ProcessSpawner {
  spawnCount = 0;
  lastProcess: FakeProcess | null = null;

  constructor(private readonly options: FakeOptions = {}) {}

  spawn(_options: SpawnOptions): Promise<SpawnedProcess> {
    this.spawnCount += 1;
    if (this.options.behavior === 'spawn-error') {
      return Promise.reject(new Error('ENOENT: node not found'));
    }
    const process = new FakeProcess(this.options);
    this.lastProcess = process;
    return Promise.resolve(process);
  }
}

function makeManager(spawner: ProcessSpawner, overrides: { maxBufferBytes?: number } = {}) {
  return new ProcessManager({
    name: 'crawler',
    spawner,
    spawn: { command: 'node', args: ['worker.ts'] },
    startupTimeoutMs: 200,
    communicationTimeoutMs: 100,
    shutdownGraceMs: 60,
    ...overrides
  });
}

function errorCode(error: unknown): string | undefined {
  return (error as StructuredError | undefined)?.code;
}

describe('ProcessManager startup', () => {
  it('starts successfully and reaches ready', async () => {
    const spawner = new FakeSpawner();
    const manager = makeManager(spawner);

    await manager.start();

    expect(manager.getState()).toBe('ready');
    expect(manager.getPid()).toBe(4321);
    expect(spawner.spawnCount).toBe(1);
    await manager.stop();
  });

  it('emits process.spawning and process.ready events', async () => {
    const { eventBus } = await import('./eventBus');
    const seen: string[] = [];
    const off = eventBus.on('process.spawning', () => seen.push('spawning'));
    const off2 = eventBus.on('process.ready', () => seen.push('ready'));

    const manager = makeManager(new FakeSpawner());
    await manager.start();

    expect(seen).toContain('spawning');
    expect(seen).toContain('ready');
    off();
    off2();
    await manager.stop();
  });

  it('prevents duplicate starts (shares one spawn)', async () => {
    const spawner = new FakeSpawner();
    const manager = makeManager(spawner);

    await Promise.all([manager.start(), manager.start(), manager.start()]);

    expect(spawner.spawnCount).toBe(1);
    expect(manager.getState()).toBe('ready');
    await manager.stop();
  });

  it('rejects a start that cannot complete the handshake (startup timeout)', async () => {
    const manager = makeManager(new FakeSpawner({ behavior: 'no-handshake' }));

    await expect(manager.start()).rejects.toSatisfy((error) => errorCode(error) === 'PROCESS_TIMEOUT');
    expect(manager.getState()).toBe('failed');
    expect(manager.getLastError()?.code).toBe('PROCESS_TIMEOUT');
  });

  it('fails with WORKER_PROTOCOL_VIOLATION on a malformed handshake frame', async () => {
    const manager = makeManager(new FakeSpawner({ behavior: 'malformed-handshake' }));

    await expect(manager.start()).rejects.toSatisfy(
      (error) => errorCode(error) === 'WORKER_PROTOCOL_VIOLATION'
    );
    expect(manager.getState()).toBe('failed');
  });

  it('reports PROCESS_SPAWN_FAILED when the spawner rejects', async () => {
    const manager = makeManager(new FakeSpawner({ behavior: 'spawn-error' }));

    await expect(manager.start()).rejects.toSatisfy(
      (error) => errorCode(error) === 'PROCESS_SPAWN_FAILED'
    );
    expect(manager.getState()).toBe('failed');
  });
});

describe('ProcessManager shutdown', () => {
  it('stops gracefully and cleans up listeners', async () => {
    const spawner = new FakeSpawner();
    const manager = makeManager(spawner);
    await manager.start();

    await manager.stop();

    expect(manager.getState()).toBe('stopped');
    expect(manager.getPid()).toBeNull();
    expect(spawner.lastProcess?.killed).toBe(true);
  });

  it('force-kills when graceful shutdown exceeds the grace period', async () => {
    const spawner = new FakeSpawner({ killHangs: true });
    const manager = makeManager(spawner);
    await manager.start();

    await manager.stop();

    expect(spawner.lastProcess?.forceKilled).toBe(true);
    expect(manager.getState()).toBe('stopped');
  });

  it('is idempotent', async () => {
    const spawner = new FakeSpawner();
    const manager = makeManager(spawner);
    await manager.start();

    await Promise.all([manager.stop(), manager.stop()]);

    expect(manager.getState()).toBe('stopped');
  });
});

describe('ProcessManager communication', () => {
  it('resolves a correlated result', async () => {
    const manager = makeManager(new FakeSpawner());
    await manager.start();

    const result = await manager.request({ command: 'ping' });
    expect(result.command).toBe('ping');

    await manager.stop();
  });

  it('rejects a request that gets no answer (communication timeout)', async () => {
    const manager = makeManager(new FakeSpawner());
    await manager.start();

    // Temporarily silence the fake so the navigate request never resolves.
    const fake = (manager as unknown as { handle: FakeProcess }).handle;
    const spy = vi.spyOn(fake, 'write').mockImplementation(() => undefined);

    await expect(manager.request({ command: 'ping' }, 50)).rejects.toSatisfy(
      (error) => errorCode(error) === 'PROCESS_TIMEOUT'
    );
    spy.mockRestore();
  });

  it('rejects a request when not ready', async () => {
    const manager = makeManager(new FakeSpawner());
    await expect(manager.request({ command: 'ping' })).rejects.toSatisfy(
      (error) => errorCode(error) === 'WORKER_PROTOCOL_VIOLATION'
    );
  });
});

describe('ProcessManager unexpected exit', () => {
  it('detects an unexpected exit and emits process.exited', async () => {
    const { eventBus } = await import('./eventBus');
    const exits: unknown[] = [];
    const off = eventBus.on('process.exited', (event) => exits.push(event.payload));

    const spawner = new FakeSpawner();
    const manager = makeManager(spawner);
    await manager.start();

    spawner.lastProcess?.emitExit({ code: 1, signal: null });
    await Promise.resolve();

    expect(manager.getState()).toBe('failed');
    expect(manager.getLastError()?.code).toBe('PROCESS_EXITED_UNEXPECTEDLY');
    expect(exits).toHaveLength(1);
    off();
  });

  it('rejects in-flight requests on unexpected exit', async () => {
    const spawner = new FakeSpawner();
    const manager = makeManager(spawner);
    await manager.start();

    const fake = (manager as unknown as { handle: FakeProcess }).handle;
    vi.spyOn(fake, 'write').mockImplementation(() => undefined);
    const pending = manager.request({ command: 'ping' }, 500);

    fake.emitExit({ code: 137, signal: 9 });

    await expect(pending).rejects.toSatisfy(
      (error) => errorCode(error) === 'PROCESS_EXITED_UNEXPECTEDLY'
    );
  });
});

describe('ProcessManager invalid transitions', () => {
  it('throws on an illegal state transition', () => {
    const manager = makeManager(new FakeSpawner());
    const internal = manager as unknown as { transition: (state: string) => void };
    expect(() => internal.transition('ready')).toThrowError(/Invalid process state transition/);
  });

  it('refuses to start while stopping', async () => {
    const spawner = new FakeSpawner({ killHangs: true });
    const manager = makeManager(spawner);
    await manager.start();

    const stopPromise = manager.stop();
    await expect(manager.start()).rejects.toSatisfy(
      (error) => errorCode(error) === 'WORKER_PROTOCOL_VIOLATION'
    );
    // Let the grace period elapse so the stop promise settles.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await stopPromise;
  });
});

describe('ProcessManager cleanup after failure', () => {
  it('does not leak a process after a failed start', async () => {
    const spawner = new FakeSpawner({ behavior: 'no-handshake' });
    const manager = makeManager(spawner);

    await manager.start().catch(() => undefined);

    expect(manager.getState()).toBe('failed');
    expect(manager.getPid()).toBeNull();
    expect(spawner.lastProcess?.forceKilled).toBe(true);
  });

  it('resetForTests returns the manager to not_started', async () => {
    const manager = makeManager(new FakeSpawner());
    await manager.start();
    await manager.resetForTests();
    expect(manager.getState()).toBe('not_started');
    expect(manager.getPid()).toBeNull();
  });
});

describe('ProcessManager kill latency (TESTING.md Scenario 3)', () => {
  it('reaps a worker within 500ms of requesting a stop', async () => {
    const spawner = new FakeSpawner({ killDelayMs: 20 });
    const manager = makeManager(spawner);
    await manager.start();

    const started = Date.now();
    await manager.stop();
    const elapsed = Date.now() - started;

    expect(manager.getState()).toBe('stopped');
    expect(elapsed).toBeLessThan(500);
  });
});

describe('ProcessManager output buffering', () => {
  it('drops oversized frames without crashing', async () => {
    const spawner = new FakeSpawner();
    const manager = makeManager(spawner, { maxBufferBytes: 64 });
    await manager.start();

    // A frame larger than MAX_FRAME_BYTES (1 MiB) must be dropped.
    // `emitStdout` appends the terminating newline itself.
    const huge = 'x'.repeat(MAX_FRAME_BYTES + 10);
    spawner.lastProcess?.emitStdout(huge);

    // Still alive and usable.
    expect(manager.getState()).toBe('ready');
    await manager.stop();
  });
});
