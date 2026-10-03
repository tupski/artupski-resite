/**
 * Crawler extraction E2E test - Artupski ReSite
 * Source of truth: docs/dev/TESTING.md section 3.1 (Playwright crawler sandbox).
 *
 * OPT-IN. This test launches a real Chromium and drives the real worker through
 * the shared protocol against the local fixture server (127.0.0.1:9099). It is
 * skipped by default so `npm run test` / CI never needs a browser binary or an
 * external website.
 *
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
  type NormalizedPage,
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../../../services/infra/workerProtocol';
import type { StructuredError } from '../../../services/infra/errors';

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';

// Dedicated port so this file never contends with the worker smoke test
// (which binds 9099) or the orchestration E2E (which binds 8000) when the
// opt-in browser tests run together in the same Vitest process pool.
const FIXTURE_PORT = 4000;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;

interface CommandOutcome {
  payload: WorkerResultPayload;
  error?: StructuredError;
}

interface Harness {
  child: ChildProcessWithoutNullStreams;
  send: (command: WorkerCommandPayload) => Promise<CommandOutcome>;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

async function startWorker(): Promise<Harness> {
  const entry = await resolveWorkerEntrypoint();
  const child = spawn(entry.command, entry.args, { cwd: entry.cwd, stdio: ['pipe', 'pipe', 'pipe'] });

  const pending = new Map<string, (outcome: CommandOutcome) => void>();
  let buffer = '';

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const decoded = decodeFrames(buffer);
    buffer = decoded.remainder;
    for (const frame of decoded.frames) {
      const parsed = parseMessage(frame);
      if (parsed.ok && parsed.message.type === 'result') {
        const resolver = pending.get(parsed.message.id);
        if (resolver) {
          pending.delete(parsed.message.id);
          resolver({ payload: parsed.message.payload, error: parsed.message.error });
        }
      }
    }
  });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  function send(command: WorkerCommandPayload): Promise<CommandOutcome> {
    const message = createCommandMessage(command);
    return new Promise<CommandOutcome>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${command.command}"`)), 30_000);
      pending.set(message.id, (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
      child.stdin.write(serializeMessage(message));
    });
  }

  return { child, send, exit };
}

async function startFixtureServerProcess(): Promise<ChildProcess> {
  const script = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/fixtureServer.mjs');
  const child = spawn(process.execPath, [script, '--port', String(FIXTURE_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${FIXTURE_URL}/crawler`);
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

describe.skipIf(!RUN_BROWSER_TESTS)('crawler extraction (real Chromium)', () => {
  let serverProcess: ChildProcess;
  let harness: Harness;
  let sessionId: string;

  beforeAll(async () => {
    serverProcess = await startFixtureServerProcess();
    harness = await startWorker();
    await harness.send({ command: 'ping' });
    const launched = await harness.send({ command: 'launch', engine: 'chromium', headless: true });
    if (launched.payload.command !== 'launch') {
      throw new Error('launch failed');
    }
    sessionId = launched.payload.sessionId;
  }, 60_000);

  afterAll(async () => {
    if (sessionId) {
      await harness.send({ command: 'close', sessionId }).catch(() => undefined);
    }
    if (harness?.child && !harness.child.killed) {
      harness.child.kill();
    }
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  }, 30_000);

  it('extracts title, headings, links, and images from the home fixture', async () => {
    const { payload, error } = await harness.send({
      command: 'extract',
      sessionId,
      url: `${FIXTURE_URL}/crawler`,
      timeoutMs: 30_000
    });
    expect(error).toBeUndefined();
    expect(payload.command).toBe('extract');
    if (payload.command === 'extract') {
      const page: NormalizedPage = payload.page;
      expect(page.httpStatus).toBe(200);
      expect(page.title).toMatch(/Crawler Fixture Home/i);
      expect(page.metaDescription).toMatch(/controlled multi-page fixture/i);
      expect(page.headings.some((h) => h.level === 1 && /Home/i.test(h.text))).toBe(true);
      expect(page.internalLinks).toContain(`${FIXTURE_URL}/crawler/about`);
      expect(page.externalLinks.some((url) => url.startsWith('https://external.example.com'))).toBe(true);
      expect(page.images.some((image) => image.internal && image.alt.length > 0)).toBe(true);
      expect(page.status).toBe('completed');
    }
  }, 30_000);

  it('extracts the second page and resolves the canonical link', async () => {
    const { payload } = await harness.send({
      command: 'extract',
      sessionId,
      url: `${FIXTURE_URL}/crawler/about`,
      timeoutMs: 30_000
    });
    expect(payload.command).toBe('extract');
    if (payload.command === 'extract') {
      expect(payload.page.title).toMatch(/About/i);
      expect(payload.page.internalLinks).toContain(`${FIXTURE_URL}/crawler`);
    }
  }, 30_000);

  it('follows a redirect to an in-scope page', async () => {
    const { payload } = await harness.send({
      command: 'extract',
      sessionId,
      url: `${FIXTURE_URL}/crawler/redirect`,
      timeoutMs: 30_000
    });
    if (payload.command === 'extract') {
      expect(payload.page.finalUrl).toContain('/crawler/about');
    }
  }, 30_000);

  it('skips a non-HTML content type', async () => {
    const { payload } = await harness.send({
      command: 'extract',
      sessionId,
      url: `${FIXTURE_URL}/crawler/json`,
      timeoutMs: 30_000
    });
    expect(payload.command).toBe('extract');
    if (payload.command === 'extract') {
      expect(payload.page.status).toBe('skipped');
      expect(payload.page.errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');
    }
  }, 30_000);

  it('extracts a 404 page rather than failing', async () => {
    const { payload } = await harness.send({
      command: 'extract',
      sessionId,
      url: `${FIXTURE_URL}/crawler/missing`,
      timeoutMs: 30_000
    });
    if (payload.command === 'extract') {
      expect(payload.page.httpStatus).toBe(404);
      expect(payload.page.title).toMatch(/Missing/i);
    }
  }, 30_000);

  it('reports a navigation timeout as a structured error', async () => {
    const { error } = await harness.send({
      command: 'extract',
      sessionId,
      url: `${FIXTURE_URL}/crawler/slow`,
      timeoutMs: 1200
    });
    expect(error?.code).toBe('CONNECTION_TIMED_OUT');
  }, 30_000);

  it('blocks a redirect to the cloud metadata address', async () => {
    const { error } = await harness.send({
      command: 'extract',
      sessionId,
      url: `${FIXTURE_URL}/crawler/redirect-metadata`,
      timeoutMs: 5_000
    });
    expect(error?.code).toBe('NAVIGATION_ABORTED');
  }, 30_000);

  it('returns an ok abort result for an unknown session', async () => {
    const { payload } = await harness.send({ command: 'abort', sessionId: 'no-such-session' });
    expect(payload.command).toBe('abort');
  }, 30_000);

  it('exits cleanly when stdin closes', async () => {
    harness.child.stdin.end();
    const { code } = await harness.exit;
    expect(code).toBe(0);
  }, 30_000);
});
