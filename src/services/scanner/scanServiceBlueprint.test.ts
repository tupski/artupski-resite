/**
 * scanService Blueprint lifecycle integration - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 8.3, 9, 11.
 *
 * Proves the Phase 9 integration point: with `blueprint: true` the lifecycle
 * runs AFTER a completed crawl, persists a document + row, and a Blueprint
 * failure NEVER changes the crawl's terminal status (mirroring responsive
 * capture). With the flag absent the lifecycle never runs (unchanged behavior).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storageService } from '../storage';
import { projectService } from '../projects/projectService';
import type { BrowserRuntime } from '../browser';
import type {
  NormalizedPage,
  WorkerCommandPayload,
  WorkerResultPayload
} from '../infra/workerProtocol';
import {
  resetScanServiceForTests,
  runScan,
  setBlueprintLifecycleDepsForTests,
  setScanRuntimeProviderForTests
} from './scanService';
import { synthesizeBlueprint } from '../blueprint/blueprintService';
import type { BlueprintFilePort, BlueprintPersistencePort } from '../blueprint/blueprintLifecycle';
import { fixtureEvidence } from '../blueprint/__tests__/fixtures';
import { encodeUtf8 } from '../blueprint/util';
import type { ScanPage } from '../../types/models';

const SEED = 'http://127.0.0.1:9099';

function page(url: string): NormalizedPage {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    title: `Title ${url}`,
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    metrics: { loadTimeMs: 1, domContentLoadedTimeMs: 1, domNodeCount: 5 },
    authStatus: 'public',
    loginSignals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: false },
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z'
  };
}

function fakeAdapter(): {
  request: (command: WorkerCommandPayload) => Promise<WorkerResultPayload>;
} {
  return {
    async request(command: WorkerCommandPayload): Promise<WorkerResultPayload> {
      if (command.command === 'extract') {
        return { command: 'extract', sessionId: command.sessionId, page: page(command.url) };
      }
      if (command.command === 'abort') {
        return { command: 'abort', sessionId: command.sessionId };
      }
      // Blueprint evidence capture (unexpected command) -> honest skip.
      return { command: 'ping', pong: true, workerVersion: 'test' };
    }
  };
}

function fakeRuntime(): BrowserRuntime {
  const adapter = fakeAdapter();
  return {
    getState: () => 'ready',
    getLastError: () => null,
    launchSession: async () => ({
      ok: true,
      data: { sessionId: 'sess-1', engine: 'chromium', version: '1' }
    }),
    closeSession: async () => ({ ok: true, data: true }),
    getWorkerAdapter: () => adapter
  } as unknown as BrowserRuntime;
}

function memoryFileIo(): BlueprintFilePort & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async write(id, data) {
      files.set(id, data);
      return `v1/${id}.json`;
    },
    async read(id) {
      return files.get(id) ?? null;
    },
    async delete(id) {
      files.delete(id);
    }
  };
}

function livePersistence(): BlueprintPersistencePort {
  return {
    listByScan: (scanId) => storageService.getRepositories().blueprints.listByScan(scanId),
    upsert: (input) => storageService.getRepositories().blueprints.upsert(input),
    deleteById: (id) => storageService.getRepositories().blueprints.deleteById(id)
  };
}

describe('scanService Blueprint lifecycle integration', () => {
  let projectId: string;

  beforeEach(async () => {
    await storageService.resetForTests();
    await storageService.initialize();
    const created = await projectService.createProject({ name: 'Fixture', targetUrl: SEED });
    if (!created.ok) {
      throw new Error('failed to create project');
    }
    projectId = created.data.id;
    setScanRuntimeProviderForTests(fakeRuntime);
  });

  afterEach(async () => {
    resetScanServiceForTests();
    setScanRuntimeProviderForTests(null);
    await storageService.resetForTests();
  });

  it('runs the Blueprint lifecycle after a completed crawl and persists a row', async () => {
    const fileIo = memoryFileIo();
    setBlueprintLifecycleDepsForTests({
      run: async (request, deps) => {
        const pages = (await storageService.getRepositories().pages.listByScan(request.scanId)).map(
          (entry): ScanPage => entry
        );
        const result = await synthesizeBlueprint(
          {
            scanId: request.scanId,
            projectId: request.projectId,
            sourceUrl: SEED,
            pages,
            assets: [],
            technologies: [],
            responsiveCaptures: [],
            generatedAt: '2026-10-01T00:00:00.000Z'
          },
          {
            evidenceIo: deps?.evidenceIo ?? {
              async read() {
                return encodeUtf8(JSON.stringify(fixtureEvidence()));
              }
            }
          }
        );
        return { ok: true, data: result };
      },
      persistence: livePersistence(),
      fileIo
    });

    const result = await runScan({ scanId: 'scan-bp', projectId, seedUrl: SEED, blueprint: true });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // The crawl still completes and the Blueprint outcome is attached honestly.
    expect(result.data.status).toBe('completed');
    expect(result.data.blueprint).toBeDefined();
    expect(result.data.blueprint?.failed).toBe(false);
    expect(result.data.blueprint?.blueprintId).not.toBeNull();

    const record = await storageService.getRepositories().blueprints.getLatestByScan('scan-bp');
    expect(record).not.toBeNull();
    expect(record?.version).toBe(1);
  });

  it('never changes the crawl terminal status when Blueprint synthesis fails', async () => {
    setBlueprintLifecycleDepsForTests({
      run: async () => {
        throw new Error('synthesis exploded');
      },
      persistence: livePersistence(),
      fileIo: memoryFileIo()
    });

    const result = await runScan({
      scanId: 'scan-bp-fail',
      projectId,
      seedUrl: SEED,
      blueprint: true
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // The crawl is still `completed`; the failure is isolated and honest.
    expect(result.data.status).toBe('completed');
    expect(result.data.blueprint?.failed).toBe(true);
    expect(result.data.blueprint?.partial).toBe(true);
    // Nothing was persisted for a synthesis failure.
    expect(await storageService.getRepositories().blueprints.countByScan('scan-bp-fail')).toBe(0);
  });

  it('does not run the Blueprint lifecycle when the flag is absent', async () => {
    let called = false;
    setBlueprintLifecycleDepsForTests({
      run: async () => {
        called = true;
        throw new Error('should not run');
      }
    });

    const result = await runScan({ scanId: 'scan-no-bp', projectId, seedUrl: SEED });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.status).toBe('completed');
    expect(called).toBe(false);
    expect(result.data.blueprint).toBeUndefined();
  });
});
