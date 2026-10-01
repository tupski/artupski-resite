/**
 * Responsive viewport capture E2E test - Artupski ReSite
 * Source of truth: docs/design/RESPONSIVE-SPEC.md sections 1-2 and
 * docs/dev/TESTING.md section 3.1.
 *
 * OPT-IN. Exercises the REAL worker `captureViewport` command against the local
 * responsive fixture: it renders the same page under desktop AND mobile, and
 * asserts the two captures are DISTINCT - different screenshot bytes, and a
 * different visible-element map (the fixture hides `nav`/`footer` on mobile via
 * a media query). It also asserts the media-query breakpoints are detected.
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
  RESPONSIVE_VIEWPORT_PROFILES,
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../../../services/infra/workerProtocol';
import type { StructuredError } from '../../../services/infra/errors';

const RUN_BROWSER_TESTS =
  process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';

const FIXTURE_PORT = 5173;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const TARGET = `${FIXTURE_URL}/responsive`;

interface CommandOutcome {
  payload: WorkerResultPayload;
  error?: StructuredError;
}

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

  request(command: WorkerCommandPayload, timeoutMs = 60_000): Promise<WorkerResultPayload> {
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
      const response = await fetch(TARGET);
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

describe.skipIf(!RUN_BROWSER_TESTS)('responsive viewport capture (real Chromium)', () => {
  let serverProcess: ChildProcess;
  let child: ChildProcessWithoutNullStreams;
  let adapter: StdioWorkerAdapter;
  let sessionId: string;

  beforeAll(async () => {
    serverProcess = await startFixtureServerProcess();
    const entry = resolveWorkerEntrypoint();
    child = spawn(entry.command, entry.args, { cwd: entry.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    adapter = new StdioWorkerAdapter(child);
    await adapter.request({ command: 'ping' });
    const launched = await adapter.request({
      command: 'launch',
      engine: 'chromium',
      headless: true
    });
    if (launched.command !== 'launch') {
      throw new Error('launch failed');
    }
    sessionId = launched.sessionId;
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

  it('captures distinct desktop and mobile screenshots with different element maps', async () => {
    const desktop = RESPONSIVE_VIEWPORT_PROFILES.find((profile) => profile.name === 'desktop')!;
    const mobile = RESPONSIVE_VIEWPORT_PROFILES.find((profile) => profile.name === 'mobile')!;

    const desktopResult = await adapter.request({
      command: 'captureViewport',
      sessionId,
      url: TARGET,
      timeoutMs: 20_000,
      profile: desktop
    });
    const mobileResult = await adapter.request({
      command: 'captureViewport',
      sessionId,
      url: TARGET,
      timeoutMs: 20_000,
      profile: mobile
    });

    expect(desktopResult.command).toBe('captureViewport');
    expect(mobileResult.command).toBe('captureViewport');
    if (desktopResult.command !== 'captureViewport' || mobileResult.command !== 'captureViewport') {
      throw new Error('captureViewport failed');
    }

    // Both captures produced a screenshot.
    expect(desktopResult.screenshotBase64).toBeTruthy();
    expect(mobileResult.screenshotBase64).toBeTruthy();

    // The screenshots are DISTINCT (different emulation => different pixels).
    expect(desktopResult.screenshotBase64).not.toBe(mobileResult.screenshotBase64);

    // Media-query breakpoints are detected (the fixture declares 480/768).
    expect(desktopResult.detectedBreakpoints.length).toBeGreaterThanOrEqual(1);

    // The visible-element map differs: the fixture hides nav/footer on mobile.
    const desktopVisibleNav = desktopResult.elements.some(
      (node) => node.tagName === 'nav' && node.visible
    );
    const mobileVisibleNav = mobileResult.elements.some(
      (node) => node.tagName === 'nav' && node.visible
    );
    expect(desktopVisibleNav).toBe(true);
    expect(mobileVisibleNav).toBe(false);

    // The desktop element map is wider at the widest anchor.
    const desktopMaxWidth = Math.max(...desktopResult.elements.map((node) => node.width), 0);
    const mobileMaxWidth = Math.max(...mobileResult.elements.map((node) => node.width), 0);
    expect(desktopMaxWidth).toBeGreaterThan(mobileMaxWidth);
  }, 90_000);
});
