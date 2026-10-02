/**
 * Blueprint evidence capture service tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.1.
 *
 * These tests use fake worker/IO seams and a real in-memory storage instance to
 * prove: evidence is written + its path round-trips through the page repository,
 * a failed capture is recorded as a skip (never a throw), and the sandboxed id
 * is filesystem-safe.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storageService } from '../../storage';
import {
  blueprintEvidenceId,
  runBlueprintEvidenceCapture,
  type BlueprintEvidenceIo,
  type BlueprintEvidenceWorker
} from '../blueprintEvidenceCapture';
import type { BlueprintEvidence } from '../../infra/workerProtocol';

function sampleEvidence(url: string): BlueprintEvidence {
  return {
    url,
    status: 200,
    capturedAt: '2026-01-01T00:00:00.000Z',
    nodes: [],
    cssVariables: { '--primary': '#0ea5e9' },
    fontFaces: [],
    forms: [],
    nav: [],
    headings: [],
    links: [],
    images: [],
    truncated: false,
    nodeCount: 0,
    byteLength: 2,
    limits: { maxNodes: 5000, maxBytes: 4194304, maxTextChars: 200, maxForms: 50, maxCssVars: 500 }
  };
}

describe('blueprintEvidenceId', () => {
  it('produces a single, filesystem-safe path segment', () => {
    const id = blueprintEvidenceId('a/../b c');
    expect(id).not.toContain('/');
    expect(id).not.toContain('..');
    expect(id).not.toContain(' ');
    expect(id.startsWith('evidence-')).toBe(true);
  });
});

describe('runBlueprintEvidenceCapture', () => {
  beforeEach(async () => {
    await storageService.initialize();
  });

  afterEach(async () => {
    await storageService.resetForTests();
  });

  async function seedPage() {
    const project = await storageService.getRepositories().projects.create({
      name: 'Blueprint',
      targetUrl: 'http://127.0.0.1:5173/blueprint',
      storagePath: '/p'
    });
    const scan = await storageService.getRepositories().scans.create({
      projectId: project.id,
      status: 'completed',
      depthLimit: 1,
      pageLimit: 10
    });
    await storageService.getRepositories().pages.upsert({
      scanId: scan.id,
      url: 'http://127.0.0.1:5173/blueprint',
      finalUrl: 'http://127.0.0.1:5173/blueprint',
      path: '/blueprint',
      depth: 0,
      httpStatus: 200,
      title: 'Blueprint',
      metaDescription: null,
      canonicalUrl: null,
      robotsMeta: null,
      status: 'completed',
      authStatus: 'public',
      errorCode: null,
      errorMessage: null,
      loadTimeMs: 1,
      domContentLoadedTimeMs: 1,
      domNodeCount: 10,
      headings: [],
      internalLinks: [],
      externalLinks: [],
      images: [],
      warnings: [],
      capturedAt: '2026-01-01T00:00:00.000Z'
    });
    const pages = await storageService.getRepositories().pages.listByScan(scan.id);
    return { project, scan, page: pages[0]! };
  }

  it('writes evidence and round-trips the path through the page repository', async () => {
    const { project, scan, page } = await seedPage();
    const writes: Array<{ id: string; bytes: number }> = [];
    const io: BlueprintEvidenceIo = {
      async write(id, data) {
        writes.push({ id, bytes: data.length });
        return `v1/${id}.json`;
      }
    };
    const worker: BlueprintEvidenceWorker = {
      async captureBlueprint(_sessionId, url) {
        return { ok: true, data: { evidence: sampleEvidence(url) } };
      }
    };

    const outcome = await runBlueprintEvidenceCapture(
      {
        scanId: scan.id,
        projectId: project.id,
        sessionId: 'session-1',
        pages: [{ id: page.id, url: page.url }]
      },
      { worker, io }
    );

    expect(outcome.captured).toBe(1);
    expect(outcome.skipped).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.bytes).toBeGreaterThan(0);

    const stored = await storageService.getRepositories().pages.getById(page.id);
    expect(stored?.blueprintEvidencePath).toBe(`v1/${blueprintEvidenceId(page.id)}.json`);
  });

  it('records a skip (never a throw) when the worker fails', async () => {
    const { project, scan, page } = await seedPage();
    const worker: BlueprintEvidenceWorker = {
      async captureBlueprint() {
        return {
          ok: false,
          error: {
            code: 'PLAYWRIGHT_CRASHED',
            category: 'browser',
            message: 'boom',
            severity: 'error',
            recoverable: true,
            retryable: false,
            suggestedAction: 'retry',
            timestamp: '2026-01-01T00:00:00.000Z'
          }
        };
      }
    };
    const io: BlueprintEvidenceIo = {
      async write() {
        return 'v1/x.json';
      }
    };

    const outcome = await runBlueprintEvidenceCapture(
      {
        scanId: scan.id,
        projectId: project.id,
        sessionId: 's',
        pages: [{ id: page.id, url: page.url }]
      },
      { worker, io }
    );
    expect(outcome.captured).toBe(0);
    expect(outcome.skipped).toBe(1);
    const stored = await storageService.getRepositories().pages.getById(page.id);
    expect(stored?.blueprintEvidencePath).toBeNull();
  });

  it('skips when the sandboxed write is unavailable (browser preview)', async () => {
    const { project, scan, page } = await seedPage();
    const worker: BlueprintEvidenceWorker = {
      async captureBlueprint(_sessionId, url) {
        return { ok: true, data: { evidence: sampleEvidence(url) } };
      }
    };
    const io: BlueprintEvidenceIo = {
      async write() {
        return null;
      }
    };

    const outcome = await runBlueprintEvidenceCapture(
      {
        scanId: scan.id,
        projectId: project.id,
        sessionId: 's',
        pages: [{ id: page.id, url: page.url }]
      },
      { worker, io }
    );
    expect(outcome.captured).toBe(0);
    expect(outcome.skipped).toBe(1);
  });
});
