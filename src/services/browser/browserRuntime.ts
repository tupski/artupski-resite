/**
 * Browser runtime - Artupski ReSite
 * Source of truth: docs/architecture/ARCHITECTURE.md section 5 and
 * docs/architecture/TECH-STACK.md (Phase 3 browser foundation).
 *
 * Phase 3 delivers a *runtime boundary* only: detect whether a Playwright
 * browser is available, and (opt-in) launch/navigate/close a controlled
 * Chromium session through the worker. It performs NO crawling, DOM/CSS/JS
 * analysis, network analysis, technology detection, or screenshots - those are
 * later phases. The MVP engine is Chromium-only.
 *
 * The React UI never touches this module's process internals: it consumes the
 * `browser.*` events and the honest diagnostics state. The actual worker is
 * reached through the injectable `BrowserWorkerAdapter`, so production uses the
 * ProcessManager (Rust-spawned Node worker) while tests use an in-memory fake
 * and never need a browser download.
 *
 * Lifecycle mirrors `storageService`: `uninitialized | initializing | ready |
 * error`, idempotent init sharing one promise, and `resetForTests()`.
 */
import { createEvent, eventBus } from '../infra/eventBus';
import { toStructuredError, type StructuredError } from '../infra/errors';
import { logger } from '../infra/logger';
import type { ProcessManager } from '../infra/processManager';
import { createProcessError } from '../infra/processErrors';
import {
  type AuthStorageState,
  type BrowserAvailability,
  type BrowserEngine,
  type CaptureStateResultPayload,
  type CloseResultPayload,
  type DetectLoginResultPayload,
  type LaunchResultPayload,
  type NavigateResultPayload,
  type PingResultPayload,
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../infra/workerProtocol';

export type BrowserRuntimeState = 'uninitialized' | 'initializing' | 'ready' | 'error';

/** Result of a runtime probe. Never implies a download happened. */
export interface BrowserDiagnostics {
  engine: BrowserEngine;
  installed: boolean;
  executablePath?: string;
  version?: string;
  checkedAt: string;
}

export interface BrowserSession {
  sessionId: string;
  engine: BrowserEngine;
  version: string;
}

export type BrowserResult<T> = { ok: true; data: T } | { ok: false; error: StructuredError };

/** Upper bound on any browser navigation (AGENTS.md section 4). */
export const MAX_BROWSER_TIMEOUT_MS = 30_000;

/**
 * Injectable worker boundary. Production wraps `ProcessManager`; tests inject a
 * fake so no real child process or browser binary is required.
 */
export interface BrowserWorkerAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): string;
  request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload>;
}

/**
 * Production adapter: translates the browser runtime's operations into the
 * versioned worker protocol spoken by the ProcessManager.
 */
export class ProcessManagerBrowserWorker implements BrowserWorkerAdapter {
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

  async request(command: WorkerCommandPayload, timeoutMs?: number): Promise<WorkerResultPayload> {
    return this.manager.request(command, timeoutMs);
  }
}

function toDiagnostics(availability: BrowserAvailability): BrowserDiagnostics {
  return {
    engine: availability.engine,
    installed: availability.installed,
    executablePath: availability.executablePath,
    version: availability.version,
    checkedAt: new Date().toISOString()
  };
}

/**
 * Browser runtime boundary. Holds one worker adapter and exposes detection plus
 * an opt-in controlled session. No analysis is performed here.
 */
export class BrowserRuntime {
  private readonly adapter: BrowserWorkerAdapter;
  private readonly log: ReturnType<typeof logger.child>;

  private state: BrowserRuntimeState = 'uninitialized';
  private lastError: StructuredError | null = null;
  private diagnostics: BrowserDiagnostics | null = null;
  private initPromise: Promise<BrowserDiagnostics> | null = null;
  private session: BrowserSession | null = null;
  /**
   * The interactive capture session (AUTH-SCANNING.md section 2.1), tracked
   * SEPARATELY from `session` so a capture window can never be mistaken for the
   * active scan session and vice versa. At most one capture is open at a time.
   */
  private capture: { sessionId: string; scopeHost: string } | null = null;

  constructor(adapter: BrowserWorkerAdapter) {
    this.adapter = adapter;
    this.log = logger.child('browser');
  }

  getState(): BrowserRuntimeState {
    return this.state;
  }

  getLastError(): StructuredError | null {
    return this.lastError;
  }

  getDiagnostics(): BrowserDiagnostics | null {
    return this.diagnostics;
  }

  isInstalled(): boolean {
    return this.diagnostics?.installed === true;
  }

  getSession(): BrowserSession | null {
    return this.session;
  }

  /**
   * Expose the worker adapter so a crawl can drive the *same* worker process
   * and session the runtime launched (Phase 4 UI wiring). This is service-to-
   * service only: the React UI still never touches process internals. The
   * adapter structurally satisfies `ScannerWorkerAdapter`.
   */
  getWorkerAdapter(): BrowserWorkerAdapter {
    return this.adapter;
  }

  /**
   * Start the worker and probe browser availability. Idempotent: concurrent or
   * repeated calls share one promise. Never throws - a missing browser becomes
   * an honest `error` state with `BROWSER_NOT_INSTALLED`.
   */
  initialize(): Promise<BrowserDiagnostics> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.runInitialize();
    return this.initPromise;
  }

  private async runInitialize(): Promise<BrowserDiagnostics> {
    this.state = 'initializing';
    eventBus.emit(
      createEvent('browser.detection_started', { engine: 'chromium', installed: false })
    );
    this.log.info('Browser runtime detection started');

    try {
      await this.adapter.start();
      const ping = await this.probe();
      this.diagnostics = toDiagnostics(ping);
      this.lastError = null;

      if (ping.installed) {
        this.state = 'ready';
        eventBus.emit(
          createEvent('browser.detected', {
            engine: ping.engine,
            installed: true,
            executablePath: ping.executablePath,
            version: ping.version
          })
        );
        this.log.info('Browser runtime ready', { engine: ping.engine, version: ping.version });
      } else {
        const error = createProcessError('BROWSER_NOT_INSTALLED', {
          message: 'No Playwright Chromium build was found.',
          details: { engine: ping.engine }
        });
        this.lastError = error;
        this.state = 'error';
        eventBus.emit(
          createEvent('browser.missing', {
            engine: ping.engine,
            code: error.code,
            message: error.message
          })
        );
        this.log.warn('Browser runtime unavailable', { code: error.code });
      }
      return this.diagnostics;
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PROCESS_SPAWN_FAILED',
        category: 'process',
        message: 'Browser runtime failed to initialize.'
      });
      this.lastError = structured;
      this.diagnostics = null;
      this.state = 'error';
      eventBus.emit(
        createEvent('browser.missing', {
          engine: 'chromium',
          code: structured.code,
          message: structured.message
        })
      );
      this.log.error('Browser runtime initialization failed', structured);
      return {
        engine: 'chromium',
        installed: false,
        checkedAt: new Date().toISOString()
      };
    }
  }

  /** Probe browser availability through the worker handshake (no download). */
  private async probe(): Promise<BrowserAvailability> {
    const result = await this.adapter.request({ command: 'ping' });
    const payload = result as PingResultPayload;
    if (payload.command !== 'ping') {
      throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
        message: 'Browser worker returned an unexpected result for ping.'
      });
    }
    return payload.browser ?? { engine: 'chromium', installed: false };
  }

  /**
   * Launch a controlled Chromium session. Opt-in: callers must have run the
   * smoke setup (`npx playwright install chromium`). Returns a typed result.
   */
  async launchSession(
    options: {
      headless?: boolean;
      executablePath?: string;
      /**
       * Optional captured storage state to isolate into the session context.
       * Callers pass it only for authenticated runs; it is never echoed back.
       */
      authState?: AuthStorageState;
    } = {}
  ): Promise<BrowserResult<BrowserSession>> {
    if (this.state !== 'ready') {
      return {
        ok: false,
        error:
          this.lastError ??
          createProcessError('BROWSER_NOT_INSTALLED', {
            message: 'Browser runtime is not ready. Initialize it first.'
          })
      };
    }

    try {
      const result = await this.adapter.request({
        command: 'launch',
        engine: 'chromium',
        headless: options.headless ?? true,
        executablePath: options.executablePath,
        ...(options.authState ? { authState: options.authState } : {})
      });
      const payload = result as LaunchResultPayload;
      if (payload.command !== 'launch') {
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'Browser worker returned an unexpected result for launch.'
        });
      }
      this.session = {
        sessionId: payload.sessionId,
        engine: payload.engine,
        version: payload.version
      };
      eventBus.emit(
        createEvent('browser.session_started', {
          engine: payload.engine,
          sessionId: payload.sessionId
        })
      );
      this.log.info('Browser session started', {
        sessionId: payload.sessionId,
        version: payload.version
      });
      return { ok: true, data: this.session };
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PLAYWRIGHT_CRASHED',
        category: 'browser',
        message: 'Failed to launch the browser session.'
      });
      this.lastError = structured;
      return { ok: false, error: structured };
    }
  }

  /**
   * Inspect `url` for login-wall indicators using the session's injected state,
   * without extracting page data. Used to verify a stored session still holds
   * before relying on it for an authenticated crawl. Returns only non-secret
   * signals.
   */
  async detectLogin(
    sessionId: string,
    url: string,
    timeoutMs = MAX_BROWSER_TIMEOUT_MS
  ): Promise<BrowserResult<DetectLoginResultPayload>> {
    try {
      const result = await this.adapter.request({
        command: 'detectLogin',
        sessionId,
        url,
        timeoutMs: Math.min(timeoutMs, MAX_BROWSER_TIMEOUT_MS)
      });
      const payload = result as DetectLoginResultPayload;
      if (payload.command !== 'detectLogin') {
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'Browser worker returned an unexpected result for detectLogin.'
        });
      }
      return { ok: true, data: payload };
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PLAYWRIGHT_CRASHED',
        category: 'browser',
        message: 'Failed to inspect the login state.'
      });
      this.lastError = structured;
      return { ok: false, error: structured };
    }
  }

  /** Navigate the active session to `url` (timeout capped at 30s). */
  async navigate(
    sessionId: string,
    url: string,
    timeoutMs = MAX_BROWSER_TIMEOUT_MS
  ): Promise<BrowserResult<NavigateResultPayload>> {
    try {
      const result = await this.adapter.request({
        command: 'navigate',
        sessionId,
        url,
        timeoutMs: Math.min(timeoutMs, MAX_BROWSER_TIMEOUT_MS)
      });
      const payload = result as NavigateResultPayload;
      if (payload.command !== 'navigate') {
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'Browser worker returned an unexpected result for navigate.'
        });
      }
      return { ok: true, data: payload };
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PLAYWRIGHT_CRASHED',
        category: 'browser',
        message: `Failed to navigate to ${url}.`
      });
      this.lastError = structured;
      return { ok: false, error: structured };
    }
  }

  /** Close a controlled session. Idempotent. */
  async closeSession(sessionId: string): Promise<BrowserResult<true>> {
    try {
      const result = await this.adapter.request({ command: 'close', sessionId });
      const payload = result as CloseResultPayload;
      if (payload.command !== 'close') {
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'Browser worker returned an unexpected result for close.'
        });
      }
      if (this.session?.sessionId === sessionId) {
        this.session = null;
      }
      eventBus.emit(createEvent('browser.session_closed', { engine: 'chromium', sessionId }));
      this.log.info('Browser session closed', { sessionId });
      return { ok: true, data: true };
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PLAYWRIGHT_CRASHED',
        category: 'browser',
        message: 'Failed to close the browser session.'
      });
      this.lastError = structured;
      return { ok: false, error: structured };
    }
  }

  /** The interactive capture window currently open, if any. */
  getCaptureSession(): { sessionId: string; scopeHost: string } | null {
    return this.capture;
  }

  /**
   * Open a headed, user-in-the-loop interactive capture window for `targetUrl`
   * (AUTH-SCANNING.md section 2.1). The session carries NO injected state and is
   * headed; the user completes login manually. The host only learns the scope
   * host here - no secret is returned until `captureSessionState()` is called.
   */
  async launchCaptureSession(targetUrl: string): Promise<BrowserResult<BrowserSession>> {
    let scopeHost: string;
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('non-http(s)');
      }
      scopeHost = parsed.hostname.toLowerCase();
    } catch {
      return {
        ok: false,
        error: createProcessError('CAPTURE_URL_INVALID', {
          message: 'The capture target is not a valid http(s) URL.',
          details: { url: targetUrl }
        })
      };
    }
    if (this.capture) {
      return {
        ok: false,
        error: createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'A capture window is already open.'
        })
      };
    }

    try {
      const result = await this.adapter.request({
        command: 'launch',
        engine: 'chromium',
        headless: false,
        capture: true
      });
      const payload = result as LaunchResultPayload;
      if (payload.command !== 'launch') {
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'Browser worker returned an unexpected result for launch.'
        });
      }
      this.capture = { sessionId: payload.sessionId, scopeHost };
      eventBus.emit(
        createEvent('browser.capture_opened', { engine: 'chromium', sessionId: payload.sessionId })
      );
      this.log.info('Interactive capture window opened', {
        sessionId: payload.sessionId,
        scopeHost
      });
      return {
        ok: true,
        data: { sessionId: payload.sessionId, engine: 'chromium', version: payload.version }
      };
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PLAYWRIGHT_CRASHED',
        category: 'browser',
        message: 'Failed to open the interactive capture window.'
      });
      this.lastError = structured;
      return { ok: false, error: structured };
    }
  }

  /**
   * Capture the (host-scoped) storage state from the open interactive window
   * after the user has logged in. The plaintext state is returned to the caller
   * only; it is never logged, emitted, or written to disk here.
   */
  async captureSessionState(): Promise<BrowserResult<CaptureStateResultPayload>> {
    if (!this.capture) {
      return {
        ok: false,
        error: createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'No interactive capture window is open.'
        })
      };
    }
    const { sessionId, scopeHost } = this.capture;
    try {
      const result = await this.adapter.request({
        command: 'captureState',
        sessionId,
        scopeHost
      });
      const payload = result as CaptureStateResultPayload;
      if (payload.command !== 'captureState') {
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', {
          message: 'Browser worker returned an unexpected result for captureState.'
        });
      }
      // Non-secret telemetry only; the storage state itself is never logged.
      this.log.info('Interactive capture state retrieved', {
        sessionId,
        scopeHost,
        cookieCount: payload.cookieCount,
        originCount: payload.originCount
      });
      return { ok: true, data: payload };
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PLAYWRIGHT_CRASHED',
        category: 'browser',
        message: 'Failed to capture the session state.'
      });
      this.lastError = structured;
      return { ok: false, error: structured };
    }
  }

  /**
   * Close and discard the interactive capture window. Idempotent: safe to call
   * on cancellation, timeout, failure, or shutdown, and a no-op when no window
   * is open. The captured state (if any) is never retained by this runtime.
   */
  async cancelCapture(): Promise<BrowserResult<true>> {
    const open = this.capture;
    if (!open) {
      return { ok: true, data: true };
    }
    this.capture = null;
    try {
      await this.adapter.request({ command: 'close', sessionId: open.sessionId });
      eventBus.emit(
        createEvent('browser.capture_closed', { engine: 'chromium', sessionId: open.sessionId })
      );
      this.log.info('Interactive capture window closed', { sessionId: open.sessionId });
      return { ok: true, data: true };
    } catch (error) {
      const structured = toStructuredError(error, {
        code: 'PLAYWRIGHT_CRASHED',
        category: 'browser',
        message: 'Failed to close the interactive capture window.'
      });
      this.lastError = structured;
      return { ok: false, error: structured };
    }
  }

  /** Shut the worker down. Idempotent and safe from any state. */
  async shutdown(): Promise<void> {
    try {
      await this.adapter.stop();
    } catch (error) {
      this.log.warn('Browser worker shutdown failed', { error: String(error) });
    } finally {
      this.session = null;
      this.state = 'uninitialized';
    }
  }

  /** Test-only: fully reset the runtime between cases. */
  async resetForTests(): Promise<void> {
    await this.shutdown();
    this.initPromise = null;
    this.lastError = null;
    this.diagnostics = null;
  }
}

/**
 * Build the default browser runtime for the current environment.
 *
 * The worker process is only meaningful inside the Tauri runtime (the Rust
 * spawner is required). Outside it (browser preview, unit tests) this returns
 * `null` so the application simply skips browser initialization.
 */
export async function createDefaultBrowserRuntime(): Promise<BrowserRuntime | null> {
  const { isTauriRuntime } = await import('../ipc/tauri');
  if (!isTauriRuntime()) {
    logger.child('browser').debug('Skipping browser runtime outside the Tauri shell.');
    return null;
  }

  const { ProcessManager } = await import('../infra/processManager');
  const { TauriProcessSpawner } = await import('../infra/tauriProcessSpawner');
  // `@vite-ignore`: this module uses Node builtins and must never enter the
  // browser bundle. The import only runs inside the Tauri shell, where the
  // worker script is resolved from source. Packaging the worker for a release
  // build is a documented Phase 3 limitation (see docs/architecture/ARCHITECTURE.md).
  const workerPathsModule = '../../workers/crawler/workerPaths';
  const { resolveWorkerEntrypoint } = (await import(/* @vite-ignore */ workerPathsModule)) as {
    resolveWorkerEntrypoint: () => { command: string; args: string[]; cwd: string };
  };

  const entry = resolveWorkerEntrypoint();
  const manager = new ProcessManager({
    name: 'crawler',
    spawner: new TauriProcessSpawner(),
    spawn: {
      command: entry.command,
      args: entry.args,
      cwd: entry.cwd
    }
  });

  return new BrowserRuntime(new ProcessManagerBrowserWorker(manager));
}
