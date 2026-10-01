import { describe, expect, it } from 'vitest';
import { BrowserRuntime, type BrowserWorkerAdapter } from './browserRuntime';
import type {
  AuthStorageState,
  WorkerCommandPayload,
  WorkerResultPayload
} from '../infra/workerProtocol';

const STATE: AuthStorageState = {
  cookies: [
    {
      name: 'sid',
      value: 'v',
      domain: 'app.example.com',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    }
  ],
  origins: [{ origin: 'https://app.example.com', localStorage: { a: 'b' } }]
};

class AuthFakeWorker implements BrowserWorkerAdapter {
  readonly commands: WorkerCommandPayload[] = [];
  private state = 'not_started';
  constructor(private readonly signal: { detected: boolean } = { detected: false }) {}

  start(): Promise<void> {
    this.state = 'ready';
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.state = 'stopped';
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
          workerVersion: '0.2.0',
          browser: { engine: 'chromium', installed: true, executablePath: '/fake/chromium' }
        };
      case 'launch':
        return {
          command: 'launch',
          sessionId: 'session-1',
          engine: 'chromium',
          version: '141.0.0'
        };
      case 'detectLogin':
        return {
          command: 'detectLogin',
          sessionId: command.sessionId,
          url: command.url,
          finalUrl: 'https://app.example.com/login',
          status: 200,
          signals: {
            redirectedToLogin: true,
            hasPasswordField: this.signal.detected,
            hasCaptcha: false,
            httpStatus: 200
          }
        };
      case 'abort':
        return { command: 'abort', sessionId: command.sessionId };
      case 'close':
        return { command: 'close', sessionId: command.sessionId };
      default:
        throw new Error(`unexpected command ${command.command}`);
    }
  }
}

describe('BrowserRuntime authenticated sessions', () => {
  it('passes the injected storage state to the worker launch command', async () => {
    const worker = new AuthFakeWorker();
    const runtime = new BrowserRuntime(worker);
    await runtime.initialize();

    const result = await runtime.launchSession({ headless: true, authState: STATE });
    expect(result.ok).toBe(true);
    const launch = worker.commands.find((c) => c.command === 'launch');
    expect(launch).toMatchObject({ command: 'launch', authState: STATE });
  });

  it('does not include authState for a plain launch', async () => {
    const worker = new AuthFakeWorker();
    const runtime = new BrowserRuntime(worker);
    await runtime.initialize();
    await runtime.launchSession({ headless: true });

    const launch = worker.commands.find((c) => c.command === 'launch');
    expect(launch).toBeDefined();
    expect((launch as { authState?: unknown }).authState).toBeUndefined();
  });

  it('detects a login wall through the session and returns only signals', async () => {
    const worker = new AuthFakeWorker({ detected: true });
    const runtime = new BrowserRuntime(worker);
    await runtime.initialize();
    await runtime.launchSession({ headless: true, authState: STATE });

    const result = await runtime.detectLogin('session-1', 'https://app.example.com/dashboard');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.signals.hasPasswordField).toBe(true);
    expect(result.data.signals.redirectedToLogin).toBe(true);
    // No cookie value or token is present in the detectLogin result.
    expect(JSON.stringify(result.data)).not.toContain('sid');
  });
});
