/**
 * Interactive auth capture E2E test - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md section 2.1 and
 * docs/dev/TESTING.md section 3.1.
 *
 * OPT-IN. This is the test that exercises the REAL headed capture window end to
 * end against the deterministic local fixture: open (headed, no injected state)
 * -> drive a simulated login (a GET link that issues a fixed cookie - never real
 * credentials) -> captureState -> encrypt/decrypt -> replay in a NEW headless
 * scan context -> confirm the protected fixture page is reachable.
 *
 * It is skipped by default so `npm run test` / CI never needs a browser binary.
 * Enable it with:
 *   npx playwright install chromium
 *   RUN_BROWSER_TESTS=1 npm run test:browser
 */
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveWorkerEntrypoint } from '../workerPaths';
import {
  createCommandMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  type AuthStorageState,
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../../../services/infra/workerProtocol';
import type { StructuredError } from '../../../services/infra/errors';
import {
  encryptSessionState,
  decryptSessionState,
  createSalt
} from '../../../services/auth/crypto';

const RUN_BROWSER_TESTS =
  process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';

const FIXTURE_PORT = 3001;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const SCOPE_HOST = '127.0.0.1';
const FIXTURE_COOKIE = 'fixture_session';

interface CommandOutcome {
  payload: WorkerResultPayload;
  error?: StructuredError;
}

/** A stdio adapter that drives the real worker exactly like `ProcessManager` would. */
class StdioWorkerAdapter {
  private readonly pending = new Map<string, (outcome: CommandOutcome) => void>();
  private buffer = '';
  private state = 'not_started';

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      const decoded = decodeFrames(this.buffer);
      this.buffer = decoded.remainder;
      for (const frame of decoded.frames) {
        const parsed = parseMessage(frame);
        if (parsed.ok && parsed.message.type === 'result') {
          const resolver = this.pending.get(parsed.message.id);
          if (resolver) {
            this.pending.delete(parsed.message.id);
            resolver({ payload: parsed.message.payload, error: parsed.message.error });
          }
        }
      }
    });
  }

  async start(): Promise<void> {
    this.state = 'ready';
  }
  async stop(): Promise<void> {
    this.state = 'stopped';
  }
  getState(): string {
    return this.state;
  }

  request(command: WorkerCommandPayload, timeoutMs = 30_000): Promise<WorkerResultPayload> {
    const message = createCommandMessage(command);
    return new Promise<WorkerResultPayload>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for "${command.command}"`)),
        timeoutMs
      );
      this.pending.set(message.id, (outcome) => {
        clearTimeout(timer);
        if (outcome.error) {
          reject(outcome.error);
        } else {
          resolve(outcome.payload);
        }
      });
      this.child.stdin.write(serializeMessage(message));
    });
  }
}

async function startFixtureServerProcess(): Promise<ChildProcess> {
  const script = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../scripts/fixtureServer.mjs'
  );
  const child = spawn(process.execPath, [script, '--port', String(FIXTURE_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${FIXTURE_URL}/auth/public`);
      if (response.ok) {
        return child;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('Fixture server did not start within 10s.');
}

describe.skipIf(!RUN_BROWSER_TESTS)('interactive auth capture (real headed Chromium)', () => {
  let serverProcess: ChildProcess;
  let child: ChildProcessWithoutNullStreams;
  let adapter: StdioWorkerAdapter;

  beforeAll(async () => {
    serverProcess = await startFixtureServerProcess();
    const entry = await resolveWorkerEntrypoint();
    child = spawn(entry.command, entry.args, { cwd: entry.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    adapter = new StdioWorkerAdapter(child);
    await adapter.request({ command: 'ping' });
  }, 60_000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.stdin.end();
      child.kill();
    }
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  }, 30_000);

  it('opens a headed capture window, captures scoped state, and replays it', async () => {
    // 1. Open the interactive, headed capture window (no injected state).
    const launched = await adapter.request({
      command: 'launch',
      engine: 'chromium',
      headless: false,
      capture: true
    });
    if (launched.command !== 'launch') {
      throw new Error('capture launch failed');
    }
    const captureSessionId = launched.sessionId;

    // 2. Simulate the user completing login. The fixture link issues a fixed
    //    session cookie; no credential is entered or observed by the app.
    const driven = await adapter.request({
      command: 'navigate',
      sessionId: captureSessionId,
      url: `${FIXTURE_URL}/auth/login/complete`,
      timeoutMs: 20_000
    });
    expect(driven.command).toBe('navigate');

    // 3. Capture the scoped storage state.
    const captured = await adapter.request({
      command: 'captureState',
      sessionId: captureSessionId,
      scopeHost: SCOPE_HOST
    });
    expect(captured.command).toBe('captureState');
    if (captured.command !== 'captureState') {
      throw new Error('captureState failed');
    }
    expect(captured.scopeHost).toBe(SCOPE_HOST);
    expect(captured.cookieCount).toBeGreaterThanOrEqual(1);
    const cookieNames = captured.storageState.cookies.map((cookie) => cookie.name);
    expect(cookieNames).toContain(FIXTURE_COOKIE);
    // sessionStorage was read from the signed-in page (step 5 of the spec).
    const origin = captured.storageState.origins.find((entry) => entry.origin === FIXTURE_URL);
    expect(origin?.sessionStorage?.fixture_session).toBe('present');

    // 4. Close the capture window.
    await adapter.request({ command: 'close', sessionId: captureSessionId });

    // 5. Encrypt, then decrypt the captured state (host crypto boundary).
    const salt = createSalt();
    const encrypted = await encryptSessionState({
      plaintext: JSON.stringify(captured.storageState),
      installationSeed: 'e2e-seed',
      projectSalt: salt
    });
    const decrypted = await decryptSessionState({
      ...encrypted,
      installationSeed: 'e2e-seed',
      projectSalt: salt
    });
    const replayed = JSON.parse(decrypted) as AuthStorageState;
    expect(replayed.cookies.map((cookie) => cookie.name)).toContain(FIXTURE_COOKIE);

    // 6. Replay the decrypted state in a NEW headless scan context and confirm
    //    the protected fixture page is reachable (the crawl the session enables).
    const scan = await adapter.request({
      command: 'launch',
      engine: 'chromium',
      headless: true,
      authState: replayed
    });
    if (scan.command !== 'launch') {
      throw new Error('replay launch failed');
    }
    const protectedPage = await adapter.request({
      command: 'extract',
      sessionId: scan.sessionId,
      url: `${FIXTURE_URL}/auth/protected`,
      timeoutMs: 20_000
    });
    expect(protectedPage.command).toBe('extract');
    if (protectedPage.command !== 'extract') {
      throw new Error('protected extract failed');
    }
    expect(protectedPage.page.httpStatus).toBe(200);
    expect(protectedPage.page.authStatus).not.toBe('auth_required');

    // No secret value appears in the extracted page result.
    expect(JSON.stringify(protectedPage.page)).not.toContain('authenticated');

    await adapter.request({ command: 'close', sessionId: scan.sessionId });
  }, 90_000);

  it('reports a wall when the protected page is fetched without a session', async () => {
    const scan = await adapter.request({
      command: 'launch',
      engine: 'chromium',
      headless: true
    });
    if (scan.command !== 'launch') {
      throw new Error('plain launch failed');
    }
    const denied = await adapter.request({
      command: 'extract',
      sessionId: scan.sessionId,
      url: `${FIXTURE_URL}/auth/protected`,
      timeoutMs: 20_000
    });
    expect(denied.command).toBe('extract');
    if (denied.command !== 'extract') {
      throw new Error('extract failed');
    }
    // The worker reports raw signals; the host derives `auth_required` from the
    // 401 status. Assert the raw wall signal the worker is responsible for.
    expect(denied.page.httpStatus).toBe(401);
    await adapter.request({ command: 'close', sessionId: scan.sessionId });
  }, 60_000);
});
