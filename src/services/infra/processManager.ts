/**
 * ProcessManager - Artupski ReSite
 * Source of truth: docs/architecture/ARCHITECTURE.md section 3.6 and
 * docs/architecture/WORKER-PROTOCOL.md.
 *
 * Owns the lifecycle of a single long-running worker child process and speaks
 * the versioned newline-delimited JSON protocol defined in `workerProtocol.ts`.
 * It is the ONLY module allowed to know about child processes: React, stores,
 * and feature services go through it (or a service that wraps it) and never
 * touch a process handle directly (AGENTS.md section 8).
 *
 * Responsibilities:
 * - a small, guarded state machine (`not_started -> starting -> ready <-> busy
 *   -> stopping -> stopped`, plus `failed`) that rejects invalid transitions;
 * - duplicate-start prevention (concurrent `start()` calls share one promise);
 * - a bounded startup handshake and per-request communication timeout;
 * - graceful shutdown followed by forced termination after a bounded grace period;
 * - unexpected-exit detection and observable `process.*` failures;
 * - deterministic listener/resource cleanup so no process or timer leaks;
 * - bounded stdout/stderr buffering (`workerProtocol.decodeFrames`).
 *
 * The actual spawn/kill primitive is injected through `ProcessSpawner`, so
 * production uses the sandboxed Rust commands while tests use an in-memory fake
 * (mirroring the `StorageFile` swap/injection pattern).
 */
import { createEvent, eventBus } from './eventBus';
import type { StructuredError } from './errors';
import { logger } from './logger';
import { createProcessError } from './processErrors';
import {
  MAX_FRAME_BYTES,
  createCommandMessage,
  decodeFrames,
  isEventMessage,
  isLogMessage,
  isResultMessage,
  parseMessage,
  serializeMessage,
  type WorkerCommandPayload,
  type WorkerEventPayload,
  type WorkerLogPayload,
  type WorkerResultPayload
} from './workerProtocol';

export type ProcessState =
  | 'not_started'
  | 'starting'
  | 'restarting'
  | 'ready'
  | 'busy'
  | 'stopping'
  | 'stopped'
  | 'failed';

/** Exit descriptor delivered by a spawned process. */
export interface ProcessExitInfo {
  code: number | null;
  /** Numeric signal number on Unix; always `null` on Windows. */
  signal: number | null;
}

/** Options passed to the spawner. Arguments are always an array (never a shell string). */
export interface SpawnOptions {
  /** Executable name; the native layer enforces an allowlist (e.g. `node`). */
  command: string;
  args: string[];
  cwd?: string;
  /** Extra environment entries; the native layer sanitizes the base environment. */
  env?: Record<string, string>;
}

/** A live child process handle as seen by TypeScript. */
export interface SpawnedProcess {
  readonly pid: number;
  /** Write raw bytes to the child's stdin. */
  write(data: string): void;
  /** Request graceful termination. */
  kill(): Promise<void>;
  /** Force termination (SIGKILL / `taskkill /F`). */
  forceKill(): Promise<void>;
  onStdout(listener: (chunk: string) => void): () => void;
  onStderr(listener: (chunk: string) => void): () => void;
  onExit(listener: (info: ProcessExitInfo) => void): () => void;
}

/** Injectable spawn primitive: Rust IPC in production, a fake in tests. */
export interface ProcessSpawner {
  spawn(options: SpawnOptions): Promise<SpawnedProcess>;
}

export interface ProcessManagerOptions {
  /** Logical name used in events/logs, e.g. `crawler`. */
  name: string;
  spawner: ProcessSpawner;
  spawn: SpawnOptions;
  /** Max time for spawn + handshake. Defaults to and is capped at 30s (AGENTS.md section 4). */
  startupTimeoutMs?: number;
  /**
   * Max time to await a correlated result. Defaults to `MAX_COMMUNICATION_TIMEOUT_MS`
   * (10 minutes). A worker reply is bounded by the *worker's* own navigation clamp
   * (<=30s per navigation), but a single `captureViewport`/`captureBlueprint`
   * request also carries a screenshot/DOM payload over stdio, so the host ceiling
   * is deliberately larger than the 30s navigation clamp; the worker always posts
   * a terminal reply (success or error) well within it.
   */
  communicationTimeoutMs?: number;
  /** Grace period before force-kill during shutdown. Default 500ms. */
  shutdownGraceMs?: number;
  /**
   * Upper bound for the accumulated stdout remainder. Defaults to `MAX_FRAME_BYTES`
   * so a legitimate large result frame (e.g. a base64 screenshot) is never sliced
   * mid-JSON (which would surface as a "malformed message").
   */
  maxBufferBytes?: number;
}

export type ProcessStateListener = (state: ProcessState) => void;

/**
 * Absolute ceiling for a single `request()` await (and startup). 30s is too short
 * for a `captureViewport` round-trip because the result frame carries a full-page
 * PNG; a premature host timeout reaps a worker that was about to reply, which the
 * user then sees as the failed-state lockout. Ten minutes is a safe upper bound:
 * every worker command is itself bounded by the worker's 30s navigation clamp, so
 * a reply is never legitimately absent for longer.
 */
const MAX_COMMUNICATION_TIMEOUT_MS = 10 * 60 * 1000;
const HARD_TIMEOUT_CEILING_MS = 30_000;

const VALID_TRANSITIONS: Record<ProcessState, readonly ProcessState[]> = {
  not_started: ['starting'],
  starting: ['ready', 'failed', 'stopping'],
  // Explicit recovery path: `failed`/`stopped` -> `restarting` -> `starting`.
  restarting: ['starting', 'failed', 'stopping'],
  ready: ['busy', 'stopping', 'failed'],
  busy: ['ready', 'stopping', 'failed'],
  stopping: ['stopped', 'failed'],
  stopped: ['starting', 'restarting'],
  failed: ['starting', 'restarting', 'stopping']
};

interface PendingRequest {
  resolve: (result: WorkerResultPayload) => void;
  reject: (error: StructuredError) => void;
  timer: ReturnType<typeof setTimeout>;
  command: string;
}

function clampTimeout(value: number | undefined, fallback: number, ceiling: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, ceiling);
}

/**
 * Manages one worker process. Instances are cheap; the application keeps a
 * singleton per worker kind (see `browserRuntime`).
 */
export class ProcessManager {
  private readonly name: string;
  private readonly spawner: ProcessSpawner;
  private readonly spawnOptions: SpawnOptions;
  private readonly startupTimeoutMs: number;
  private readonly communicationTimeoutMs: number;
  private readonly shutdownGraceMs: number;
  private readonly maxBufferBytes: number;
  private readonly log: ReturnType<typeof logger.child>;

  private state: ProcessState = 'not_started';
  private lastError: StructuredError | null = null;
  private handle: SpawnedProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private restartPromise: Promise<void> | null = null;
  private stopRequested = false;

  private stdoutBuffer = '';
  private stderrBuffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly stateListeners = new Set<ProcessStateListener>();
  private readonly eventListeners = new Set<(payload: WorkerEventPayload) => void>();
  private readonly logListeners = new Set<(payload: WorkerLogPayload) => void>();
  private readonly disposers: Array<() => void> = [];
  private exitWaiter: ((info: ProcessExitInfo) => void) | null = null;

  constructor(options: ProcessManagerOptions) {
    this.name = options.name;
    this.spawner = options.spawner;
    this.spawnOptions = options.spawn;
    this.startupTimeoutMs = clampTimeout(
      options.startupTimeoutMs,
      HARD_TIMEOUT_CEILING_MS,
      HARD_TIMEOUT_CEILING_MS
    );
    this.communicationTimeoutMs = clampTimeout(
      options.communicationTimeoutMs,
      MAX_COMMUNICATION_TIMEOUT_MS,
      MAX_COMMUNICATION_TIMEOUT_MS
    );
    this.shutdownGraceMs = options.shutdownGraceMs ?? 500;
    this.maxBufferBytes = options.maxBufferBytes ?? MAX_FRAME_BYTES;
    this.log = logger.child(`process:${this.name}`);
  }

  getState(): ProcessState {
    return this.state;
  }

  getLastError(): StructuredError | null {
    return this.lastError;
  }

  getPid(): number | null {
    return this.handle?.pid ?? null;
  }

  onStateChange(listener: ProcessStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Subscribe to worker `event` frames (e.g. `browser.launched`). */
  onWorkerEvent(listener: (payload: WorkerEventPayload) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Subscribe to worker `log` frames. */
  onWorkerLog(listener: (payload: WorkerLogPayload) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  private transition(next: ProcessState): void {
    if (next === this.state) {
      return;
    }
    if (!VALID_TRANSITIONS[this.state].includes(next)) {
      throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
        message: `Invalid process state transition: ${this.state} -> ${next}.`,
        details: { processName: this.name, from: this.state, to: next }
      });
    }
    this.applyState(next);
  }

  /** Set state and notify listeners without transition validation (teardown only). */
  private applyState(next: ProcessState): void {
    this.state = next;
    for (const listener of [...this.stateListeners]) {
      listener(next);
    }
  }

  /**
   * Start the worker and complete the protocol handshake. Idempotent: repeated
   * or concurrent calls share one promise. Starting from `failed`/`stopped` goes
   * through `restarting` so a crashed worker can be recovered explicitly.
   */
  start(): Promise<void> {
    if (this.state === 'ready' || this.state === 'busy') {
      return Promise.resolve();
    }
    if ((this.state === 'starting' || this.state === 'restarting') && this.startPromise) {
      return this.startPromise;
    }
    if (this.state === 'stopping') {
      return Promise.reject(
        createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: `Cannot start "${this.name}" while it is stopping.`
        })
      );
    }
    this.startPromise = this.runStart();
    return this.startPromise;
  }

  /**
   * Recover a failed/stopped worker and return it to `ready`. This is the
   * documented recovery path for the failed-state lockout: it tears down any
   * surviving handle, transitions `failed -> restarting -> starting`, then
   * re-runs the spawn + handshake. Concurrent calls share one promise. Calling it
   * on a healthy worker is a no-op.
   */
  restart(): Promise<void> {
    if (this.state === 'ready' || this.state === 'busy' || this.state === 'starting') {
      return this.start();
    }
    if (this.restartPromise) {
      return this.restartPromise;
    }
    if (this.state === 'stopping') {
      return Promise.reject(
        createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: `Cannot restart "${this.name}" while it is stopping.`
        })
      );
    }
    this.restartPromise = this.runRestart();
    return this.restartPromise;
  }

  private async runRestart(): Promise<void> {
    this.stopRequested = false;
    this.stopPromise = null;
    eventBus.emit(createEvent('process.restarting', { processName: this.name }));
    this.log.info('Restarting worker process');
    // Enter `restarting` and publish the recovery chain as `startPromise`
    // SYNCHRONOUSLY (before any await), so a concurrent `start()`/`ensureReady()`
    // arriving mid-restart shares this promise instead of spawning a second
    // process. `runStart` later performs `restarting -> starting`.
    try {
      this.transition('restarting');
    } catch {
      // `restarting` may be illegal from an exotic state; the spawn below still
      // performs the real transition.
    }
    this.startPromise = this.performRestart();
    try {
      await this.startPromise;
    } finally {
      this.restartPromise = null;
    }
  }

  private async performRestart(): Promise<void> {
    // Release any surviving handle from the previous (failed) generation so a
    // fresh process is always spawned and no stale listeners linger.
    await this.cleanupHandle();
    await this.runStart();
  }

  /**
   * Ensure the worker is usable before a command. Returns immediately when it is
   * `ready`/`busy`; transparently restarts a `failed`/`stopped` worker; and
   * shares the in-flight startup when one is already running. This is the
   * single call site a service uses so a transient crash never permanently
   * locks it out.
   */
  async ensureReady(): Promise<void> {
    if (this.state === 'ready' || this.state === 'busy') {
      return;
    }
    if (this.state === 'stopping') {
      throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
        message: `Cannot use "${this.name}" while it is stopping.`
      });
    }
    // `start()` shares the in-flight startup/restart promise (see `start`).
    return this.start();
  }

  private async runStart(): Promise<void> {
    this.stopRequested = false;
    this.lastError = null;
    this.transition('starting');
    eventBus.emit(createEvent('process.spawning', { processName: this.name }));
    this.log.info('Starting worker process', { command: this.spawnOptions.command });

    try {
      const handle = await this.withTimeout(
        this.spawner.spawn(this.spawnOptions),
        this.startupTimeoutMs,
        'PROCESS_TIMEOUT',
        `Spawning "${this.name}" timed out.`
      );
      this.handle = handle;
      this.attachHandle(handle);

      // Handshake: a ping result proves the worker is alive and protocol-compatible.
      const pong = await this.request({ command: 'ping' }, this.startupTimeoutMs);
      if (pong.command !== 'ping') {
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: `Handshake for "${this.name}" returned an unexpected result.`
        });
      }

      this.transition('ready');
      eventBus.emit(createEvent('process.ready', { processName: this.name, pid: handle.pid }));
      this.log.info('Worker ready', { pid: handle.pid, workerVersion: pong.workerVersion });
    } catch (error) {
      const structured = this.normalizeError(error, 'PROCESS_SPAWN_FAILED', `Failed to start "${this.name}".`);
      this.lastError = structured;
      this.failWith(structured);
      await this.cleanupHandle();
      throw structured;
    }
  }

  /**
   * Send a command and await its correlated result. Rejects with
   * `PROCESS_TIMEOUT` when no result arrives within the communication timeout.
   */
  request(command: WorkerCommandPayload, timeoutOverrideMs?: number): Promise<WorkerResultPayload> {
    // `starting` is permitted so the internal handshake (and any request racing
    // startup) can be sent; the response is still correlated by id.
    if (this.state !== 'ready' && this.state !== 'busy' && this.state !== 'starting') {
      return Promise.reject(
        createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: `Cannot send a command to "${this.name}" while it is ${this.state}.`
        })
      );
    }
    const handle = this.handle;
    if (!handle) {
      return Promise.reject(
        createProcessError('PROCESS_EXITED_UNEXPECTEDLY', {
          message: `"${this.name}" has no live process handle.`
        })
      );
    }

    const message = createCommandMessage(command);
    const timeoutMs = clampTimeout(
      timeoutOverrideMs,
      this.communicationTimeoutMs,
      MAX_COMMUNICATION_TIMEOUT_MS
    );

    return new Promise<WorkerResultPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        const structured = createProcessError('PROCESS_TIMEOUT', {
          message: `Command "${command.command}" on "${this.name}" timed out after ${timeoutMs}ms.`,
          details: { processName: this.name, command: command.command, timeoutMs }
        });
        this.lastError = structured;
        reject(structured);
        // A worker that stops responding cannot be trusted: fail and reap it.
        this.failWith(structured);
        void this.cleanupHandle();
      }, timeoutMs);

      this.pending.set(message.id, {
        resolve,
        reject,
        timer,
        command: command.command
      });

      this.refreshBusyState();
      try {
        handle.write(serializeMessage(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(message.id);
        this.refreshBusyState();
        reject(this.normalizeError(error, 'WORKER_PROTOCOL_VIOLATION', `Failed to write to "${this.name}".`));
      }
    });
  }

  /**
   * Gracefully stop the worker, then force-terminate if it does not exit within
   * the grace period. Idempotent and safe to call from any state.
   */
  stop(): Promise<void> {
    if (this.state === 'not_started' || this.state === 'stopped') {
      return Promise.resolve();
    }
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.runStop();
    return this.stopPromise;
  }

  private async runStop(): Promise<void> {
    this.stopRequested = true;
    const handle = this.handle;
    if (!handle) {
      // No live handle (e.g. a failed start already reaped it): settle cleanly.
      this.applyState('stopped');
      return;
    }

    this.transition('stopping');
    eventBus.emit(createEvent('process.stopping', { processName: this.name, pid: handle.pid }));
    this.log.info('Stopping worker process', { pid: handle.pid });

    // Fail any in-flight requests promptly.
    for (const [id, pending] of [...this.pending]) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(
        createProcessError('USER_CANCELLED', {
          message: `Command "${pending.command}" was cancelled by shutdown.`
        })
      );
    }

    const exit = this.waitForExit(this.shutdownGraceMs);
    try {
      await handle.kill();
      const info = await exit;
      this.log.info('Worker exited gracefully', { code: info.code, signal: info.signal });
    } catch {
      // Grace elapsed: force terminate.
      this.log.warn('Worker did not exit within grace period; forcing termination', {
        graceMs: this.shutdownGraceMs
      });
      await handle.forceKill().catch(() => undefined);
      // Give the exit event a brief chance to land; otherwise proceed.
      await this.waitForExit(this.shutdownGraceMs).catch(() => undefined);
    } finally {
      this.detachHandle();
      this.handle = null;
      this.transition('stopped');
      eventBus.emit(createEvent('process.stopped', { processName: this.name }));
      this.log.info('Worker stopped');
    }
  }

  private attachHandle(handle: SpawnedProcess): void {
    this.disposers.push(
      handle.onStdout((chunk) => this.consumeChunk('stdout', chunk)),
      handle.onStderr((chunk) => this.consumeChunk('stderr', chunk)),
      handle.onExit((info) => this.onExit(info))
    );
  }

  private detachHandle(): void {
    while (this.disposers.length > 0) {
      const dispose = this.disposers.pop();
      try {
        dispose?.();
      } catch {
        // Disposal must never throw during teardown.
      }
    }
  }

  private consumeChunk(stream: 'stdout' | 'stderr', chunk: string): void {
    const key = stream;
    const current = (key === 'stdout' ? this.stdoutBuffer : this.stderrBuffer) + chunk;
    const decoded = decodeFrames(current);
    const remainder = decoded.remainder.slice(0, this.maxBufferBytes);

    if (key === 'stdout') {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }

    if (decoded.oversize > 0) {
      this.log.warn('Dropped oversized worker output frame(s)', { stream, count: decoded.oversize });
    }

    for (const frame of decoded.frames) {
      if (key === 'stderr') {
        this.log.debug('Worker stderr', { data: frame.slice(0, 2000) });
        continue;
      }
      this.handleFrame(frame);
    }
  }

  private handleFrame(frame: string): void {
    const parsed = parseMessage(frame);
    if (!parsed.ok) {
      this.lastError = parsed.error;
      this.log.error('Worker protocol violation', parsed.error);
      eventBus.emit(
        createEvent('process.failed', {
          processName: this.name,
          code: parsed.error.code,
          message: parsed.error.message
        })
      );
      // Fail in-flight work with the *protocol* error (not the generic exit
      // error) so the caller sees the real cause before the handle is reaped.
      this.rejectPending(parsed.error);
      this.failWith(parsed.error);
      void this.cleanupHandle();
      return;
    }

    const message = parsed.message;
    if (isResultMessage(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.log.warn('Received a result for an unknown correlation id', { id: message.id });
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(message.error);
      } else {
        pending.resolve(message.payload);
      }
      this.refreshBusyState();
      return;
    }

    if (isLogMessage(message)) {
      for (const listener of [...this.logListeners]) {
        listener(message.payload);
      }
      return;
    }

    if (isEventMessage(message)) {
      for (const listener of [...this.eventListeners]) {
        listener(message.payload);
      }
      return;
    }

    if (message.type === 'error') {
      this.lastError = createProcessError('PROCESS_EXITED_UNEXPECTEDLY', {
        message: message.payload.message,
        details: { processName: this.name, code: message.payload.code }
      });
      this.log.error('Worker reported an error frame', this.lastError);
    }
  }

  private onExit(info: ProcessExitInfo): void {
    const waiter = this.exitWaiter;
    this.exitWaiter = null;
    waiter?.(info);

    if (this.stopRequested || this.state === 'stopping') {
      return;
    }

    // Unexpected exit.
    const structured = createProcessError('PROCESS_EXITED_UNEXPECTEDLY', {
      message: `Worker "${this.name}" exited unexpectedly (code ${String(info.code)}, signal ${String(info.signal)}).`,
      details: { processName: this.name, code: info.code, signal: info.signal }
    });
    this.lastError = structured;
    eventBus.emit(
      createEvent('process.exited', {
        processName: this.name,
        pid: this.handle?.pid,
        code: info.code,
        signal: info.signal,
        unexpected: true
      })
    );
    this.log.error('Worker exited unexpectedly', structured);

    for (const [id, pending] of [...this.pending]) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(structured);
    }

    this.detachHandle();
    this.handle = null;
    this.failWith(structured);
  }

  private failWith(error: StructuredError): void {
    this.lastError = error;
    if (this.state !== 'failed' && this.state !== 'stopped') {
      try {
        this.transition('failed');
      } catch {
        // If the transition is illegal we still want the failure observable.
      }
    }
    eventBus.emit(
      createEvent('process.failed', {
        processName: this.name,
        code: error.code,
        message: error.message
      })
    );
  }

  /** Reject every in-flight request with `error` and clear their timers. */
  private rejectPending(error: StructuredError): void {
    for (const [id, pending] of [...this.pending]) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private refreshBusyState(): void {
    if (this.pending.size > 0 && this.state === 'ready') {
      this.transition('busy');
      eventBus.emit(createEvent('process.busy', { processName: this.name, pid: this.handle?.pid }));
    } else if (this.pending.size === 0 && this.state === 'busy') {
      this.transition('ready');
      eventBus.emit(createEvent('process.ready', { processName: this.name, pid: this.handle?.pid }));
    }
  }

  private waitForExit(timeoutMs: number): Promise<ProcessExitInfo> {
    return new Promise<ProcessExitInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.exitWaiter = null;
        reject(new Error('exit-timeout'));
      }, timeoutMs);
      this.exitWaiter = (info) => {
        clearTimeout(timer);
        resolve(info);
      };
    });
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    code: 'PROCESS_TIMEOUT',
    message: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(createProcessError(code, { message, details: { processName: this.name, timeoutMs } }));
      }, timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private normalizeError(
    error: unknown,
    code: 'PROCESS_SPAWN_FAILED' | 'WORKER_PROTOCOL_VIOLATION',
    message: string
  ): StructuredError {
    if (typeof error === 'object' && error !== null && 'code' in error && 'category' in error) {
      return error as StructuredError;
    }
    return createProcessError(code, { message, cause: error });
  }

  /** Release the current handle and any pending work without changing state. */
  private async cleanupHandle(): Promise<void> {
    const handle = this.handle;
    if (!handle) {
      this.detachHandle();
      return;
    }
    for (const [id, pending] of [...this.pending]) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(
        createProcessError('PROCESS_EXITED_UNEXPECTEDLY', {
          message: `Command "${pending.command}" was aborted because "${this.name}" stopped.`
        })
      );
    }
    try {
      await handle.forceKill();
    } catch {
      // Already dead.
    }
    this.detachHandle();
    this.handle = null;
  }

  /** Test-only: fully reset the manager between cases. */
  async resetForTests(): Promise<void> {
    this.stopRequested = true;
    await this.cleanupHandle();
    this.startPromise = null;
    this.stopPromise = null;
    this.restartPromise = null;
    this.stopRequested = false;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.lastError = null;
    this.state = 'not_started';
    this.stateListeners.clear();
    this.eventListeners.clear();
    this.logListeners.clear();
  }
}
