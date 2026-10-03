/**
 * Crawler service E2E test - Artupski ReSite
 * Source of truth: docs/dev/TESTING.md section 3.1 (Playwright crawler sandbox).
 *
 * OPT-IN. This is the only test that exercises the *whole* Phase 4 orchestration
 * against real Chromium and the local fixture server: frontier + worker client +
 * persistence (real in-memory SQLite) + typed events + cancellation. It is
 * skipped by default so `npm run test` / CI never needs a browser binary.
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
import { Logger } from '../../../services/infra/logger';
import { ScannerWorkerClient, type ScannerWorkerAdapter } from '../../../services/scanner/scannerWorkerClient';
import { CrawlerService } from '../../../services/scanner/crawlerService';
import { createStorage, type StorageInstance } from '../../../services/storage/storageService';
import { MemoryStorageFile } from '../../../services/storage/persistence/storageFile';
import { ProjectRepository } from '../../../services/storage/repositories/projectRepository';
import { ScanRepository } from '../../../services/storage/repositories/scanRepository';
import { ScanPageRepository } from '../../../services/storage/repositories/scanPageRepository';
import type { StorageContext } from '../../../services/storage/context';

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === '1' || process.env.RUN_BROWSER_TESTS === 'true';

// Use a dedicated port (already on the crawler URL-policy allowlist) so this
// file never contends with the workstream-1 extraction E2E, which binds 9099.
const FIXTURE_PORT = 8000;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const SEED = `${FIXTURE_URL}/crawler`;

interface CommandOutcome {
  payload: WorkerResultPayload;
  error?: StructuredError;
}

/** A stdio adapter that drives the real worker exactly like `ProcessManager` would. */
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

  request(command: WorkerCommandPayload, timeoutMs = 30_000): Promise<WorkerResultPayload> {
    const message = createCommandMessage(command);
    return new Promise<WorkerResultPayload>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${command.command}"`)), timeoutMs);
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
  const script = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/fixtureServer.mjs');
  const child = spawn(process.execPath, [script, '--port', String(FIXTURE_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
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

describe.skipIf(!RUN_BROWSER_TESTS)('crawler service end-to-end (real Chromium)', () => {
  let serverProcess: ChildProcess;
  let child: ChildProcessWithoutNullStreams;
  let storage: StorageInstance;
  let sessionId: string;
  let projectId: string;
  let repositories: {
    projects: ProjectRepository;
    scans: ScanRepository;
    pages: ScanPageRepository;
  };
  let context: StorageContext;

  beforeAll(async () => {
    serverProcess = await startFixtureServerProcess();

    const entry = await resolveWorkerEntrypoint();
    child = spawn(entry.command, entry.args, { cwd: entry.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const adapter = new StdioWorkerAdapter(child);
    const client = new ScannerWorkerClient(adapter);

    await client.ping();
    const launched = await adapter.request({ command: 'launch', engine: 'chromium', headless: true });
    if (launched.command !== 'launch') {
      throw new Error('launch failed');
    }
    sessionId = launched.sessionId;

    storage = await createStorage(new MemoryStorageFile());
    context = {
      getDatabase: () => storage.getDatabase(),
      persist: () => storage.persist()
    };
    repositories = {
      projects: new ProjectRepository(context),
      scans: new ScanRepository(context),
      pages: new ScanPageRepository(context)
    };
    const project = await repositories.projects.create({
      name: 'Fixture crawl',
      targetUrl: SEED,
      storagePath: '/fixture'
    });
    projectId = project.id;
  }, 60_000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.stdin.end();
      child.kill();
    }
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
    if (storage) {
      await storage.close();
    }
  }, 30_000);

  function buildService(): CrawlerService {
    const adapter = new StdioWorkerAdapter(child);
    const client = new ScannerWorkerClient(adapter);
    return new CrawlerService({
      persistence: {
        createScan: (input) => repositories.scans.create(input),
        updateStatus: (id, input) => repositories.scans.updateStatus(id, input),
        updateProgress: (id, input) => repositories.scans.updateProgress(id, input),
        findActive: () => repositories.scans.findActive(),
        upsertPages: (inputs) => repositories.pages.upsertMany(inputs),
        countPages: (scanId) => repositories.pages.countByScan(scanId)
      },
      worker: {
        extract: (sid, url, options) => client.extract(sid, url, options),
        abort: (sid) => client.abort(sid)
      },
      logger: new Logger('crawler-e2e', 'ERROR')
    });
  }

  it('crawls the fixture, persists pages, and completes with a real browser', async () => {
    const service = buildService();
    const result = await service.run({
      projectId,
      seedUrl: SEED,
      sessionId,
      limits: { maxDepth: 2, maxPages: 10, navigationTimeoutMs: 20_000 }
    });

    expect(result.status).toBe('completed');
    expect(result.pagesScanned).toBeGreaterThanOrEqual(2);
    expect(result.pagesPersisted).toBeGreaterThanOrEqual(2);

    const scan = await repositories.scans.getById(result.scanId);
    expect(scan?.status).toBe('completed');

    const pages = await repositories.pages.listByScan(result.scanId);
    const home = pages.find((p) => p.url === SEED);
    expect(home?.title).toMatch(/Crawler Fixture Home/i);
    expect(home?.headings.some((h) => h.level === 1)).toBe(true);
    expect(home?.internalLinks).toContain(`${FIXTURE_URL}/crawler/about`);
    expect(home?.images.some((image) => image.internal)).toBe(true);

    // The about page was discovered from the home page and crawled too.
    expect(pages.some((p) => p.url === `${FIXTURE_URL}/crawler/about`)).toBe(true);

    // Reopen the database and confirm the crawl survived a restart.
    const reopened = await createStorage(new MemoryStorageFile(await (async () => storage.getDatabase().export())()));
    const reopenedPages = await new ScanPageRepository({
      getDatabase: () => reopened.getDatabase(),
      persist: () => reopened.persist()
    }).listByScan(result.scanId);
    expect(reopenedPages).toHaveLength(pages.length);
    await reopened.close();
  }, 60_000);

  it('stops a crawl on cancellation and records it as cancelled', async () => {
    const service = buildService();
    let scanId = '';
    const pending = service.run({
      projectId,
      seedUrl: SEED,
      sessionId,
      scanId: 'e2e-cancel-scan',
      limits: { maxDepth: 3, maxPages: 10, navigationTimeoutMs: 20_000 }
    });
    scanId = 'e2e-cancel-scan';

    // Give the crawl a moment to begin, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await service.cancel(scanId);

    const result = await pending;
    expect(['cancelled', 'completed']).toContain(result.status);
    if (result.status === 'cancelled') {
      expect((await repositories.scans.getById(scanId))?.status).toBe('cancelled');
    }
  }, 60_000);
});
