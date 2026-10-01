/**
 * Worker smoke test - Artupski ReSite
 * Source of truth: docs/dev/TESTING.md section 3.1 (Playwright crawler sandbox).
 *
 * OPT-IN. This is the ONLY test that launches a real Chromium and therefore the
 * only one that can require a browser download. It is skipped by default so the
 * normal `npm run test` / CI never needs a browser binary or an external site.
 *
 * Enable it with:
 *   npx playwright install chromium
 *   npm run test:browser            # or: RUN_BROWSER_TESTS=1 vitest run ...
 *
 * It starts the real fixture server (`scripts/fixtureServer.mjs`) as a child
 * process, spawns the real worker through Node's type stripping, drives the
 * shared protocol over stdio, navigates to the local fixture on 127.0.0.1:9099,
 * and asserts a clean exit.
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
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../../../services/infra/workerProtocol';

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';

const FIXTURE_URL = 'http://127.0.0.1:9099';

interface Harness {
  child: ChildProcessWithoutNullStreams;
  send: (command: WorkerCommandPayload) => Promise<WorkerResultPayload>;
  stdout: string[];
  stderr: string[];
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function startWorker(): Harness {
  const entry = resolveWorkerEntrypoint();
  const child = spawn(entry.command, entry.args, { cwd: entry.cwd, stdio: ['pipe', 'pipe', 'pipe'] });

  const stdout: string[] = [];
  const stderr: string[] = [];
  const pending = new Map<string, (payload: WorkerResultPayload) => void>();
  let buffer = '';

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const decoded = decodeFrames(buffer);
    buffer = decoded.remainder;
    for (const frame of decoded.frames) {
      stdout.push(frame);
      const parsed = parseMessage(frame);
      if (parsed.ok && parsed.message.type === 'result') {
        const resolver = pending.get(parsed.message.id);
        if (resolver) {
          pending.delete(parsed.message.id);
          resolver(parsed.message.payload);
        }
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString('utf8'));
  });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  function send(command: WorkerCommandPayload): Promise<WorkerResultPayload> {
    const message = createCommandMessage(command);
    return new Promise<WorkerResultPayload>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${command.command}"`)), 30_000);
      pending.set(message.id, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      child.stdin.write(serializeMessage(message));
    });
  }

  return { child, send, stdout, stderr, exit };
}

/** Start the real fixture server script and wait until it accepts connections. */
async function startFixtureServerProcess(): Promise<ChildProcess> {
  const script = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/fixtureServer.mjs');
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${FIXTURE_URL}/simple-page`);
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

describe.skipIf(!RUN_BROWSER_TESTS)('crawler worker browser smoke', () => {
  let serverProcess: ChildProcess;
  let harness: Harness;

  beforeAll(async () => {
    serverProcess = await startFixtureServerProcess();
    harness = startWorker();
  });

  afterAll(async () => {
    if (harness?.child && !harness.child.killed) {
      harness.child.kill();
    }
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  });

  it('responds to a ping handshake', async () => {
    const result = await harness.send({ command: 'ping' });
    expect(result.command).toBe('ping');
    if (result.command === 'ping') {
      expect(result.pong).toBe(true);
      expect(result.workerVersion).toBeTruthy();
    }
  });

  it('launches Chromium, navigates to the local fixture, and closes cleanly', async () => {
    const launched = await harness.send({ command: 'launch', engine: 'chromium', headless: true });
    expect(launched.command).toBe('launch');
    if (launched.command !== 'launch') {
      return;
    }
    expect(launched.sessionId).toBeTruthy();

    const navigated = await harness.send({
      command: 'navigate',
      sessionId: launched.sessionId,
      url: `${FIXTURE_URL}/simple-page`,
      timeoutMs: 30_000
    });
    expect(navigated.command).toBe('navigate');
    if (navigated.command === 'navigate') {
      expect(navigated.status).toBe(200);
      expect(navigated.title).toMatch(/Artupski ReSite/i);
    }

    const closed = await harness.send({ command: 'close', sessionId: launched.sessionId });
    expect(closed.command).toBe('close');
  }, 60_000);

  it('exits cleanly when stdin closes', async () => {
    harness.child.stdin.end();
    const { code } = await harness.exit;
    expect(code).toBe(0);
  });
});
