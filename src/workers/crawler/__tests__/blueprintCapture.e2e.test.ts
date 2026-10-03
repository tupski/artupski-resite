/**
 * Blueprint evidence capture E2E test - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 11 and
 * docs/dev/TESTING.md section 3.1.
 *
 * OPT-IN. Exercises the REAL worker `captureBlueprint` command against the local
 * blueprint fixture. It asserts the evidence is BOUNDED, contains the expected
 * landmarks/headings/tokens/form/nav, that a page with a huge DOM is flagged
 * `truncated`, and - critically - that no planted secret (localStorage token,
 * input `value`, hidden field) leaks into the evidence.
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

const RUN_BROWSER_TESTS =
  process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';

// Dedicated, allowlisted port so this suite never contends with the other
// real-Chromium suites (9099/8000/4173/5173).
const FIXTURE_PORT = 3000;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const TARGET = `${FIXTURE_URL}/blueprint`;

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

describe.skipIf(!RUN_BROWSER_TESTS)('blueprint evidence capture (real Chromium)', () => {
  let serverProcess: ChildProcess;
  let child: ChildProcessWithoutNullStreams;
  let adapter: StdioWorkerAdapter;
  let sessionId: string;

  beforeAll(async () => {
    serverProcess = await startFixtureServerProcess();
    const entry = await resolveWorkerEntrypoint();
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

  it('captures bounded landmark/token/form evidence and never leaks secrets', async () => {
    const result = await adapter.request({
      command: 'captureBlueprint',
      sessionId,
      url: TARGET,
      timeoutMs: 20_000
    });
    expect(result.command).toBe('captureBlueprint');
    if (result.command !== 'captureBlueprint') {
      throw new Error('captureBlueprint failed');
    }

    const evidence = result.evidence;
    expect(evidence.url).toContain('/blueprint');
    expect(evidence.status).toBe(200);
    expect(evidence.truncated).toBe(false);
    expect(evidence.nodes.length).toBeGreaterThan(5);
    expect(evidence.nodes.length).toBeLessThanOrEqual(evidence.limits.maxNodes);

    // Landmarks are captured with semantic hints.
    const tags = evidence.nodes.map((node) => node.tag);
    expect(tags).toContain('header');
    expect(tags).toContain('nav');
    expect(tags).toContain('main');
    expect(tags).toContain('footer');
    expect(tags).toContain('form');

    // Headings + links + images.
    expect(evidence.headings.some((heading) => heading.level === 1)).toBe(true);
    expect(evidence.links.some((link) => link.href.includes('/pricing'))).toBe(true);
    expect(evidence.images.some((image) => image.src.includes('logo.svg'))).toBe(true);

    // Navigation regions (header nav + footer nav).
    expect(evidence.nav.length).toBeGreaterThanOrEqual(1);
    expect(evidence.nav.some((region) => region.items.length >= 2)).toBe(true);

    // Forms: fields + labels + required + options, but NEVER values.
    const form = evidence.forms.find((entry) => entry.id === 'contact-form');
    expect(form).toBeDefined();
    const email = form?.fields.find((field) => field.name === 'email');
    expect(email?.type).toBe('email');
    expect(email?.required).toBe(true);
    expect(email?.label).toBe('Work Email');
    const select = form?.fields.find((field) => field.name === 'company_size');
    expect(select?.options.length).toBeGreaterThanOrEqual(2);

    // Design-token evidence: CSS variables + computed colors/fonts.
    expect(Object.keys(evidence.cssVariables).length).toBeGreaterThan(0);
    expect(evidence.cssVariables['--primary']).toBeTruthy();
    const anyColor = evidence.nodes.some((node) => node.styles.color.length > 0);
    expect(anyColor).toBe(true);
    expect(evidence.nodes.some((node) => node.styles.fontFamily.includes('Inter'))).toBe(true);

    // SECURITY: planted secret-like values must never appear anywhere.
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('LOCAL_SECRET_TOKEN_XYZ');
    expect(serialized).not.toContain('SESSION_SECRET_TOKEN_XYZ');
    expect(serialized).not.toContain('INPUT_SECRET_VALUE_XYZ');
    // No input VALUE attribute is captured at all.
    for (const node of evidence.nodes) {
      expect(node.attrs.value).toBeUndefined();
    }
  }, 90_000);

  it('flags truncation when the node cap is exceeded', async () => {
    const result = await adapter.request({
      command: 'captureBlueprint',
      sessionId,
      url: TARGET,
      timeoutMs: 20_000,
      maxNodes: 3
    });
    expect(result.command).toBe('captureBlueprint');
    if (result.command !== 'captureBlueprint') {
      throw new Error('captureBlueprint failed');
    }
    expect(result.evidence.nodes.length).toBeLessThanOrEqual(3);
    expect(result.evidence.truncated).toBe(true);
    expect(result.evidence.limits.maxNodes).toBe(3);
  }, 60_000);
});
