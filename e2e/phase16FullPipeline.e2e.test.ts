/**
 * Phase 16 real-browser full pipeline E2E - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 8.1, 9.2 (C2).
 *
 * OPT-IN (`RUN_BROWSER_TESTS=1`). This is the R4/R5 authoritative test: it drives
 * the WHOLE pipeline against the deterministic LOCAL fixture server (never a
 * public website, per `TESTING.md` §2.1/§3.1):
 *
 *   fixture server (127.0.0.1:8100, dedicated port)
 *     -> real Chromium crawl (real worker over stdio + real CrawlerService)
 *     -> real Blueprint lifecycle (real evidence capture + runBlueprint + persistence)
 *     -> real component synthesis (scripted engine; the only AI seam)
 *     -> real project generation
 *     -> real `npm install && npm run build` (gated on RUN_PROJECT_BUILD=1)
 *     -> assert `dist/index.html`
 *
 * If npm or Chromium is unavailable the test reports BLOCKED (skips) rather than
 * a false PASS. Enable it with:
 *   npx playwright install chromium
 *   RUN_BROWSER_TESTS=1 RUN_PROJECT_BUILD=1 npx vitest run e2e
 */
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWorkerEntrypoint } from '../src/workers/crawler/workerPaths';
import {
  createCommandMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  type WorkerCommandPayload,
  type WorkerResultPayload
} from '../src/services/infra/workerProtocol';
import type { StructuredError } from '../src/services/infra/errors';
import { Logger } from '../src/services/infra/logger';
import {
  ScannerWorkerClient,
  type ScannerWorkerAdapter
} from '../src/services/scanner/scannerWorkerClient';
import { CrawlerService, type CrawlPersistence } from '../src/services/scanner/crawlerService';
import { runBlueprint } from '../src/services/blueprint/runBlueprint';
import type { EvidenceIo } from '../src/services/blueprint/evidence';
import { synthesizeComponents } from '../src/services/generator/componentSynthesizer';
import { generateProject } from '../src/services/generator/projectGenerator';
import { createScriptedEngine } from './harness/scriptedEngine';
import {
  createTestStorage,
  makeTempRoot,
  storeFrom
} from './harness/pipeline';
import { hasCommand, hasDistIndexHtml, installAndBuild, npmCommand } from './harness/buildRunner';

const RUN_BROWSER_TESTS =
  process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';
const RUN_PROJECT_BUILD = process.env.RUN_PROJECT_BUILD === '1';
const KEEP = process.env.KEEP_PHASE16_E2E === '1';

// Dedicated port so this file never contends with the other real-Chromium suites
// (3000/3001/4000/4173/5173/8000/9099).
//
// DEVIATION C8 (impl-plan §14): the plan §9.2 named port 8100, but 8100 is NOT
// on the crawler's SSRF port allowlist (`ALLOWED_PORTS` in
// `src/services/scanner/security/urlPolicy.ts`). Widening that security control
// for a test is out of scope ("add no new product feature"), so this suite uses
// 8080 — an allowlisted port not used by any other suite. Recorded, not silent.
const FIXTURE_PORT = 8080;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const SEED = `${FIXTURE_URL}/blueprint`;

interface CommandOutcome {
  payload: WorkerResultPayload;
  error?: StructuredError;
}

/** Drives the real worker exactly like `ProcessManager` would (stdio envelope). */
class StdioWorkerAdapter implements ScannerWorkerAdapter {
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
  const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/fixtureServer.mjs');
  const child = spawn(process.execPath, [script, '--port', String(FIXTURE_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(SEED);
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

describe.skipIf(!RUN_BROWSER_TESTS)('Phase 16 full pipeline (real Chromium, local fixture)', () => {
  it('crawls -> Blueprint -> synthesize -> generate -> build with no fabricated success', async (context) => {
    // Honest prerequisite checks: BLOCKED, never a false PASS.
    if (!(await hasCommand(npmCommand()))) {
      // eslint-disable-next-line no-console
      console.warn(`[phase16 full e2e] BLOCKED: ${npmCommand()} is unavailable.`);
      context.skip();
      return;
    }

    const storage = await createTestStorage();
    let serverProcess: ChildProcess | undefined;
    let child: ChildProcessWithoutNullStreams | undefined;
    const roots: string[] = [];

    try {
      // --- 1. Real fixture server + real Chromium worker. ---------------------
      serverProcess = await startFixtureServerProcess();
      const entry = await resolveWorkerEntrypoint();
      child = spawn(entry.command, entry.args, { cwd: entry.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const adapter = new StdioWorkerAdapter(child);
      const client = new ScannerWorkerClient(adapter);

      await client.ping();
      let sessionId: string;
      try {
        const launched = await adapter.request({ command: 'launch', engine: 'chromium', headless: true });
        if (launched.command !== 'launch') {
          throw new Error('launch did not return a session');
        }
        sessionId = launched.sessionId;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(`[phase16 full e2e] BLOCKED: Chromium unavailable (${String(error)}).`);
        context.skip();
        return;
      }

      // --- 2. Real crawl (real CrawlerService + real SQLite persistence). -----
      const project = await storage.projects.create({
        name: 'Phase 16 full E2E',
        targetUrl: SEED,
        storagePath: '/e2e-full'
      });
      const persistence: CrawlPersistence = {
        createScan: (input) => storage.scans.create(input),
        updateStatus: (id, input) => storage.scans.updateStatus(id, input),
        updateProgress: (id, input) => storage.scans.updateProgress(id, input),
        findActive: () => storage.scans.findActive(),
        upsertPages: (inputs) => storage.pages.upsertMany(inputs),
        countPages: (scanId) => storage.pages.countByScan(scanId)
      };
      const service = new CrawlerService({
        persistence,
        worker: client,
        logger: new Logger('phase16-full-e2e', 'ERROR')
      });
      const crawl = await service.run({
        projectId: project.id,
        seedUrl: SEED,
        sessionId,
        limits: { maxDepth: 1, maxPages: 3, navigationTimeoutMs: 20_000 }
      });
      expect(crawl.status).toBe('completed');
      expect(crawl.pagesPersisted).toBeGreaterThanOrEqual(1);

      // --- 3. Real Blueprint evidence capture for completed pages. ------------
      const pages = await storage.pages.listByScan(crawl.scanId);
      const completed = pages.filter((page) => page.status === 'completed');
      expect(completed.length).toBeGreaterThanOrEqual(1);

      const evidenceBytes = new Map<string, Uint8Array>();
      for (const page of completed) {
        const captured = await client.captureBlueprint(sessionId, page.url, { timeoutMs: 20_000 });
        if (!captured.ok) {
          continue;
        }
        const id = `evidence-${page.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const path = `v1/${id}.json`;
        evidenceBytes.set(path, new TextEncoder().encode(JSON.stringify(captured.data.evidence)));
        await storage.pages.updateBlueprintEvidencePath(page.id, path);
      }
      const evidenceIo: EvidenceIo = {
        async read(path) {
          return evidenceBytes.get(path) ?? null;
        }
      };

      // --- 4. Real Blueprint synthesis. ---------------------------------------
      const blueprintResult = await runBlueprint(
        { scanId: crawl.scanId, projectId: project.id, sourceUrl: SEED, generatedAt: '2026-10-01T00:00:00.000Z' },
        { store: storeFrom(storage), evidenceIo }
      );
      expect(blueprintResult.ok, JSON.stringify(blueprintResult.ok ? {} : blueprintResult.error)).toBe(true);
      if (!blueprintResult.ok) {
        return;
      }
      const blueprint = blueprintResult.data.blueprint;
      expect(blueprint.source_url).toBe(SEED);

      // --- 5. Real component synthesis (scripted engine) + generation. --------
      const synthesis = await synthesizeComponents(
        { engine: createScriptedEngine() },
        { blueprint, options: {} }
      );
      expect(synthesis.failures).toEqual([]);

      const targetRoot = await makeTempRoot('resite-p16-full-src-');
      roots.push(targetRoot);
      const report = await generateProject(
        {},
        {
          blueprint,
          components: synthesis.components,
          targetRoot,
          options: { projectName: 'resite-full-app' }
        }
      );
      expect(report.ok, JSON.stringify(report.error)).toBe(true);
      expect(report.files).toContain('index.html');

      // --- 6. Real build (opt-in). --------------------------------------------
      if (!RUN_PROJECT_BUILD) {
        // eslint-disable-next-line no-console
        console.warn('[phase16 full e2e] build half BLOCKED: set RUN_PROJECT_BUILD=1 to run it.');
        context.skip();
        return;
      }
      const build = await installAndBuild(targetRoot);
      expect(build.install.code, `npm install failed:\n${build.install.output}`).toBe(0);
      expect(build.build.code, `npm run build failed:\n${build.build.output}`).toBe(0);
      expect(await hasDistIndexHtml(targetRoot)).toBe(true);
    } finally {
      if (child && !child.killed) {
        child.stdin.end();
        child.kill();
      }
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill();
      }
      await storage.close();
      if (!KEEP) {
        await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
      }
    }
  }, 900_000);
});
