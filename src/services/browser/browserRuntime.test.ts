import { describe, expect, it, vi } from 'vitest';
import { BrowserRuntime, type BrowserWorkerAdapter } from './browserRuntime';
import {
  createResultMessage,
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../infra/workerProtocol';
import { createProcessError } from '../infra/processErrors';
import type { StructuredError } from '../infra/errors';

interface FakeConfig {
  installed?: boolean;
  executablePath?: string;
  launchThrows?: boolean;
  startThrows?: boolean;
  navigateStatus?: number | null;
  navigateTitle?: string;
}

/** In-memory browser worker used by every default-suite test (no real browser). */
class FakeBrowserWorker implements BrowserWorkerAdapter {
  startCount = 0;
  stopCount = 0;
  readonly commands: WorkerCommandPayload[] = [];
  private state = 'not_started';
  private readonly sessions = new Map<string, string>();

  constructor(private readonly config: FakeConfig = {}) {}

  start(): Promise<void> {
    this.startCount += 1;
    if (this.config.startThrows) {
      return Promise.reject(createProcessError('PROCESS_SPAWN_FAILED', { message: 'no node' }));
    }
    this.state = 'ready';
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopCount += 1;
    this.state = 'stopped';
    this.sessions.clear();
    return Promise.resolve();
  }

  getState(): string {
    return this.state;
  }

  async request(command: WorkerCommandPayload): Promise<WorkerResultPayload> {
    this.commands.push(command);
    switch (command.command) {
      case 'ping':
        return {
          command: 'ping',
          pong: true,
          workerVersion: '0.1.0',
          browser: {
            engine: 'chromium',
            installed: this.config.installed ?? true,
            executablePath: this.config.executablePath ?? '/fake/chromium'
          }
        };
      case 'launch': {
        if (this.config.launchThrows) {
          throw createProcessError('BROWSER_NOT_INSTALLED', { message: 'chromium missing' });
        }
        const sessionId = 'session-1';
        this.sessions.set(sessionId, '141.0.0');
        return { command: 'launch', sessionId, engine: 'chromium', version: '141.0.0' };
      }
      case 'navigate':
        return {
          command: 'navigate',
          sessionId: command.sessionId,
          url: command.url,
          status: this.config.navigateStatus ?? 200,
          title: this.config.navigateTitle ?? 'Artupski ReSite - Simple Fixture'
        };
      case 'close':
        this.sessions.delete(command.sessionId);
        return { command: 'close', sessionId: command.sessionId };
      default:
        throw createProcessError('WORKER_PROTOCOL_VIOLATION', { message: 'unexpected' });
    }
  }
}

function codeOf(error: unknown): string | undefined {
  return (error as StructuredError | undefined)?.code;
}

describe('BrowserRuntime detection', () => {
  it('reports ready and installed when the worker finds Chromium', async () => {
    const worker = new FakeBrowserWorker({ installed: true, executablePath: '/fake/chromium' });
    const runtime = new BrowserRuntime(worker);

    const diagnostics = await runtime.initialize();

    expect(runtime.getState()).toBe('ready');
    expect(runtime.isInstalled()).toBe(true);
    expect(diagnostics.installed).toBe(true);
    expect(diagnostics.executablePath).toBe('/fake/chromium');
    expect(worker.startCount).toBe(1);
    await runtime.shutdown();
  });

  it('is idempotent (one worker start for many initialize calls)', async () => {
    const worker = new FakeBrowserWorker();
    const runtime = new BrowserRuntime(worker);

    await Promise.all([runtime.initialize(), runtime.initialize(), runtime.initialize()]);

    expect(worker.startCount).toBe(1);
    await runtime.shutdown();
  });

  it('emits browser.detection_started and browser.detected', async () => {
    const { eventBus } = await import('../infra/eventBus');
    const seen: string[] = [];
    const off1 = eventBus.on('browser.detection_started', () => seen.push('started'));
    const off2 = eventBus.on('browser.detected', () => seen.push('detected'));

    const runtime = new BrowserRuntime(new FakeBrowserWorker());
    await runtime.initialize();

    expect(seen).toEqual(['started', 'detected']);
    off1();
    off2();
    await runtime.shutdown();
  });
});

describe('BrowserRuntime missing executable', () => {
  it('reports BROWSER_NOT_INSTALLED without throwing', async () => {
    const runtime = new BrowserRuntime(new FakeBrowserWorker({ installed: false }));

    const diagnostics = await runtime.initialize();

    expect(diagnostics.installed).toBe(false);
    expect(runtime.getState()).toBe('error');
    expect(runtime.isInstalled()).toBe(false);
    expect(runtime.getLastError()?.code).toBe('BROWSER_NOT_INSTALLED');
    await runtime.shutdown();
  });

  it('emits browser.missing when no browser is found', async () => {
    const { eventBus } = await import('../infra/eventBus');
    const missing: unknown[] = [];
    const off = eventBus.on('browser.missing', (event) => missing.push(event.payload));

    const runtime = new BrowserRuntime(new FakeBrowserWorker({ installed: false }));
    await runtime.initialize();

    expect(missing).toHaveLength(1);
    off();
    await runtime.shutdown();
  });

  it('reports failure when the worker cannot start', async () => {
    const runtime = new BrowserRuntime(new FakeBrowserWorker({ startThrows: true }));

    await runtime.initialize();

    expect(runtime.getState()).toBe('error');
    expect(codeOf(runtime.getLastError())).toBe('PROCESS_SPAWN_FAILED');
    await runtime.shutdown();
  });
});

describe('BrowserRuntime launch failure', () => {
  it('returns a typed error when launch fails', async () => {
    const runtime = new BrowserRuntime(new FakeBrowserWorker({ launchThrows: true }));
    await runtime.initialize();

    const result = await runtime.launchSession();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BROWSER_NOT_INSTALLED');
    }
    expect(runtime.getSession()).toBeNull();
    await runtime.shutdown();
  });

  it('refuses to launch before initialization', async () => {
    const runtime = new BrowserRuntime(new FakeBrowserWorker());

    const result = await runtime.launchSession();

    expect(result.ok).toBe(false);
  });
});

describe('BrowserRuntime cleanup after launch', () => {
  it('launches, navigates, and closes a controlled session', async () => {
    const worker = new FakeBrowserWorker();
    const runtime = new BrowserRuntime(worker);
    await runtime.initialize();

    const launched = await runtime.launchSession();
    expect(launched.ok).toBe(true);
    if (!launched.ok) {
      return;
    }

    const navigated = await runtime.navigate(launched.data.sessionId, 'http://127.0.0.1:9099/simple-page');
    expect(navigated.ok).toBe(true);
    if (navigated.ok) {
      expect(navigated.data.status).toBe(200);
      expect(navigated.data.title).toMatch(/fixture/i);
    }

    const closed = await runtime.closeSession(launched.data.sessionId);
    expect(closed.ok).toBe(true);
    expect(runtime.getSession()).toBeNull();

    await runtime.shutdown();
    expect(worker.stopCount).toBe(1);
  });

  it('caps navigation timeouts at 30s', async () => {
    const worker = new FakeBrowserWorker();
    const runtime = new BrowserRuntime(worker);
    await runtime.initialize();
    const launched = await runtime.launchSession();
    if (!launched.ok) {
      return;
    }

    await runtime.navigate(launched.data.sessionId, 'http://x', 999_999);

    const navigateCommand = worker.commands.find((command) => command.command === 'navigate');
    expect(navigateCommand).toBeDefined();
    if (navigateCommand && navigateCommand.command === 'navigate') {
      expect(navigateCommand.timeoutMs).toBeLessThanOrEqual(30_000);
    }
    await runtime.shutdown();
  });

  it('emits browser.session_started and browser.session_closed', async () => {
    const { eventBus } = await import('../infra/eventBus');
    const seen: string[] = [];
    const off1 = eventBus.on('browser.session_started', () => seen.push('started'));
    const off2 = eventBus.on('browser.session_closed', () => seen.push('closed'));

    const runtime = new BrowserRuntime(new FakeBrowserWorker());
    await runtime.initialize();
    const launched = await runtime.launchSession();
    if (launched.ok) {
      await runtime.closeSession(launched.data.sessionId);
    }

    expect(seen).toEqual(['started', 'closed']);
    off1();
    off2();
    await runtime.shutdown();
  });

  it('shuts the worker down even after a launch failure', async () => {
    const worker = new FakeBrowserWorker({ launchThrows: true });
    const runtime = new BrowserRuntime(worker);
    await runtime.initialize();
    await runtime.launchSession();

    await runtime.shutdown();

    expect(worker.stopCount).toBe(1);
    expect(runtime.getState()).toBe('uninitialized');
  });
});

describe('BrowserRuntime resetForTests', () => {
  it('returns to uninitialized', async () => {
    const runtime = new BrowserRuntime(new FakeBrowserWorker());
    await runtime.initialize();
    await runtime.resetForTests();
    expect(runtime.getState()).toBe('uninitialized');
    expect(runtime.getDiagnostics()).toBeNull();
  });
});

describe('createResultMessage helper is exercised', () => {
  it('serializes a result frame used by the fake worker contract', () => {
    const frame = createResultMessage('id-1', { command: 'ping', pong: true, workerVersion: '0.1.0' });
    expect(frame.type).toBe('result');
    expect(frame.id).toBe('id-1');
  });

  it('spies on a worker request to prove no real process is spawned', async () => {
    const worker = new FakeBrowserWorker();
    const spy = vi.spyOn(worker, 'request');
    const runtime = new BrowserRuntime(worker);
    await runtime.initialize();
    expect(spy).toHaveBeenCalled();
    await runtime.shutdown();
  });
});
