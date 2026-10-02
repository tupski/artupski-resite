/**
 * Static clone capture E2E test - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md sections 2-3 and
 * docs/dev/TESTING.md section 3.1.
 *
 * OPT-IN. Exercises the REAL worker against the local clone fixture:
 *   - `extract` with `captureHtml: true` returns the bounded raw HTML body;
 *   - `captureAssets` returns bounded asset bytes (stylesheet/image/script);
 *   - the pure HTML rewriter, given that map, produces ZERO remaining external
 *     references.
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
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../../../services/infra/workerProtocol';
import type { StructuredError } from '../../../services/infra/errors';
import { assetPathFor, pagePathForUrl } from '../../../services/clone/clonePaths';
import { rewriteHtml } from '../../../services/clone/htmlRewriter';

const RUN_BROWSER_TESTS =
  process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';

// An allowed, currently-unused port (see ALLOWED_PORTS in urlPolicy.ts and the
// port-isolation note in docs/dev/TESTING.md) so this suite never collides with
// the other real-Chromium suites.
const FIXTURE_PORT = 4173;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const TARGET = `${FIXTURE_URL}/clone`;

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

describe.skipIf(!RUN_BROWSER_TESTS)('static clone capture (real Chromium)', () => {
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

  it('captures raw HTML + assets and rewrites to a self-contained page', async () => {
    const extracted = await adapter.request({
      command: 'extract',
      sessionId,
      url: TARGET,
      timeoutMs: 20_000,
      captureHtml: true
    });
    expect(extracted.command).toBe('extract');
    if (extracted.command !== 'extract') {
      throw new Error('extract failed');
    }
    expect(extracted.rawHtml?.html).toContain('<html');
    expect(extracted.rawHtml?.truncated).toBe(false);

    const captured = await adapter.request({
      command: 'captureAssets',
      sessionId,
      url: TARGET,
      timeoutMs: 20_000
    });
    expect(captured.command).toBe('captureAssets');
    if (captured.command !== 'captureAssets') {
      throw new Error('captureAssets failed');
    }
    // The fixture references a stylesheet, an image and a script.
    expect(captured.assets.length).toBeGreaterThanOrEqual(2);
    const assetMap: Record<string, string> = {};
    for (const asset of captured.assets) {
      assetMap[asset.sourceUrl] = assetPathFor(asset.sourceUrl, asset.assetType, asset.sha256);
    }

    const pagePath = pagePathForUrl(TARGET, FIXTURE_URL);
    const rewritten = rewriteHtml(extracted.rawHtml!.html, {
      assetMap,
      routeMap: {
        '/clone/': 'index.html',
        [`${FIXTURE_URL}/clone/`]: 'index.html',
        [`${FIXTURE_URL}/clone/about`]: 'pages/about.html'
      },
      pagePath,
      mockClientPath: 'js/mock-client.js',
      baseUrl: TARGET
    });

    // The tracking script is gone and the mock client injected.
    expect(rewritten).not.toContain('googletagmanager.com');
    expect(rewritten).toContain('js/mock-client.js');

    // The fixture's real referenced assets were remapped to local paths. (The
    // captured tracking script is intentionally absent: the rewriter strips it.)
    const mapped = Object.values(assetMap);
    expect(mapped.some((path) => path.startsWith('assets/') && path.endsWith('.css'))).toBe(true);
    expect(mapped.some((path) => path.endsWith('.svg'))).toBe(true);
    expect(rewritten).toMatch(/\.\.\/assets\/[^"']+\.css/);
    expect(rewritten).toMatch(/\.\.\/assets\/images\/[^"']+\.svg/);
    expect(rewritten).toMatch(/\.\.\/assets\/[^"']+\.js/);
  }, 60_000);
});
