/**
 * Blueprint lifecycle + persistence tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 6, 8.3, 9, 11.
 *
 * Exercises the thin persistence wrapper over the REAL `BlueprintRepository`
 * (in-memory sql.js storage) with an in-memory sandbox file port: round-trip,
 * regeneration (version increment), invalid-document persistence, no-orphan on
 * row failure, and the `blueprint.*` event sequence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestStorage, type TestStorage } from '../../storage/__tests__/helpers';
import type { AppEvent } from '../../infra/eventBus';
import type { UpsertBlueprintInput } from '../../storage';
import type { Blueprint as BlueprintRecord } from '../../../types/models';
import { validateBlueprint } from '../../../types/blueprint';
import { synthesizeBlueprint } from '../blueprintService';
import type { EvidenceIo } from '../evidence';
import { encodeUtf8 } from '../util';
import { fixtureEvidence } from './fixtures';
import {
  runBlueprintLifecycle,
  loadBlueprintDocument,
  nextBlueprintVersion,
  blueprintDocumentId,
  blueprintIdFromPath,
  type BlueprintFilePort,
  type BlueprintPersistencePort,
  type BlueprintRunFn
} from '../blueprintLifecycle';
import type { ScanPage } from '../../../types/models';

const GENERATED_AT = '2026-10-01T00:00:00.000Z';

function scanPage(overrides: Partial<ScanPage> = {}): ScanPage {
  return {
    id: 'p1',
    scanId: 's1',
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    path: '/',
    depth: 0,
    httpStatus: 200,
    title: 'Blueprint Fixture Home',
    metaDescription: 'A controlled fixture.',
    canonicalUrl: 'https://example.com/',
    robotsMeta: 'index, follow',
    status: 'completed',
    authStatus: 'public',
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 10,
    domContentLoadedTimeMs: 5,
    domNodeCount: 30,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawHtmlPath: null,
    blueprintEvidencePath: 'v1/evidence-p1.json',
    ...overrides
  };
}

function evidenceIoFor(map: Record<string, unknown>): EvidenceIo {
  return {
    async read(path) {
      const key = path.split('/').pop() ?? '';
      const value = map[key];
      return value === undefined ? null : encodeUtf8(JSON.stringify(value));
    }
  };
}

/** A synthesis function that returns a deterministic valid document. */
function validRun(): BlueprintRunFn {
  return async (request, deps) => {
    const result = await synthesizeBlueprint(
      {
        scanId: request.scanId,
        projectId: request.projectId,
        sourceUrl: 'https://example.com/',
        pages: [scanPage()],
        assets: [],
        technologies: [],
        responsiveCaptures: [],
        generatedAt: GENERATED_AT
      },
      {
        evidenceIo: deps?.evidenceIo ?? evidenceIoFor({ 'evidence-p1.json': fixtureEvidence() })
      }
    );
    return { ok: true, data: result };
  };
}

/** An in-memory sandbox file port that records every write/delete. */
function memoryFileIo(): BlueprintFilePort & {
  files: Map<string, Uint8Array>;
  writes: string[];
  deletes: string[];
} {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const deletes: string[] = [];
  return {
    files,
    writes,
    deletes,
    async write(id, data) {
      files.set(id, data);
      writes.push(id);
      return `v1/${id}.json`;
    },
    async read(id) {
      return files.get(id) ?? null;
    },
    async delete(id) {
      deletes.push(id);
      files.delete(id);
    }
  };
}

function persistenceFrom(storage: TestStorage): BlueprintPersistencePort {
  return {
    listByScan: (scanId) => storage.blueprints.listByScan(scanId),
    upsert: (input: UpsertBlueprintInput) => storage.blueprints.upsert(input),
    deleteById: (id) => storage.blueprints.deleteById(id)
  };
}

describe('blueprintLifecycle - persistence round trip', () => {
  let storage: TestStorage;
  let projectId: string;
  let scanId: string;

  beforeEach(async () => {
    storage = await createTestStorage();
    const project = await storage.projects.create({
      name: 'Blueprint',
      targetUrl: 'https://example.com',
      storagePath: '/bp'
    });
    projectId = project.id;
    const scan = await storage.scans.create({ projectId, status: 'completed' });
    scanId = scan.id;
  });

  afterEach(async () => {
    await storage.close();
  });

  it('writes the document, upserts the row, and reads it back', async () => {
    const fileIo = memoryFileIo();
    const events: AppEvent[] = [];
    const outcome = await runBlueprintLifecycle(
      { scanId, projectId, sourceUrl: 'https://example.com/', generatedAt: GENERATED_AT },
      {
        run: validRun(),
        persistence: persistenceFrom(storage),
        fileIo,
        events: { emit: (event) => events.push(event) }
      }
    );

    expect(outcome.failed).toBe(false);
    expect(outcome.isValid).toBe(true);
    expect(outcome.version).toBe(1);
    expect(outcome.blueprintId).not.toBeNull();
    expect(outcome.filePath).toBe(`v1/${blueprintDocumentId(scanId, 1)}.json`);

    // The row is persisted and points at the written file.
    const record = await storage.blueprints.getLatestByScan(scanId);
    expect(record?.isValid).toBe(true);
    expect(record?.version).toBe(1);
    expect(record?.filePath).toBe(outcome.filePath);
    expect(record?.validationErrors).toEqual([]);

    // The written document round-trips through the schema validator.
    const view = await loadBlueprintDocument(record as BlueprintRecord, { fileIo });
    expect(view.readError).toBeNull();
    expect(view.document).not.toBeNull();
    expect(validateBlueprint(view.document).success).toBe(true);
  });

  it('emits started -> generated -> completed for a valid document', async () => {
    const events: AppEvent[] = [];
    await runBlueprintLifecycle(
      { scanId, projectId, generatedAt: GENERATED_AT },
      {
        run: validRun(),
        persistence: persistenceFrom(storage),
        fileIo: memoryFileIo(),
        events: { emit: (event) => events.push(event) }
      }
    );
    expect(events.map((event) => event.type)).toEqual([
      'blueprint.started',
      'blueprint.generated',
      'blueprint.completed'
    ]);
    const generated = events.find((event) => event.type === 'blueprint.generated');
    expect((generated?.payload as { blueprintId?: string }).blueprintId).toBeTruthy();
  });

  it('increments the version on regeneration and never duplicates (scan_id, version)', async () => {
    const persistence = persistenceFrom(storage);
    const first = await runBlueprintLifecycle(
      { scanId, projectId, generatedAt: GENERATED_AT },
      { run: validRun(), persistence, fileIo: memoryFileIo() }
    );
    const second = await runBlueprintLifecycle(
      { scanId, projectId, generatedAt: GENERATED_AT },
      { run: validRun(), persistence, fileIo: memoryFileIo() }
    );

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    const revisions = await storage.blueprints.listByScan(scanId);
    expect(revisions.map((entry) => entry.version)).toEqual([2, 1]);
  });

  it('persists an invalid document with is_valid = false instead of discarding it', async () => {
    const fileIo = memoryFileIo();
    const events: AppEvent[] = [];
    // A synthesis that returns a structurally-valid outcome but an INVALID document.
    const invalidRun: BlueprintRunFn = async () => {
      const valid = await validRun()(
        { scanId, projectId },
        { evidenceIo: evidenceIoFor({ 'evidence-p1.json': fixtureEvidence() }) }
      );
      if (!valid.ok) {
        throw new Error('unexpected');
      }
      const broken = {
        ...valid.data.blueprint,
        blueprint_version: 99
      } as unknown as typeof valid.data.blueprint;
      const validation = {
        valid: false,
        errors: [
          {
            code: 'BLUEPRINT_VALIDATION_FAILED' as const,
            path: 'blueprint_version',
            message: 'unsupported'
          }
        ],
        truncated: false,
        data: null
      };
      return { ok: true, data: { ...valid.data, blueprint: broken, validation } };
    };

    const outcome = await runBlueprintLifecycle(
      { scanId, projectId, generatedAt: GENERATED_AT },
      {
        run: invalidRun,
        persistence: persistenceFrom(storage),
        fileIo,
        events: { emit: (event) => events.push(event) }
      }
    );

    expect(outcome.failed).toBe(false);
    expect(outcome.isValid).toBe(false);
    // `partial` reflects incomplete evidence (none skipped here); the document
    // is still persisted and surfaced as invalid via `isValid`.
    expect(outcome.partial).toBe(false);
    expect(outcome.validationErrors).toHaveLength(1);

    const record = await storage.blueprints.getLatestByScan(scanId);
    expect(record?.isValid).toBe(false);
    expect(record?.validationErrors[0]?.path).toBe('blueprint_version');

    // The invalid document was still written, and validation_failed was emitted.
    expect(fileIo.writes).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      'blueprint.started',
      'blueprint.validation_failed',
      'blueprint.completed'
    ]);
  });

  it('does not leave an orphan file when the row write fails', async () => {
    const fileIo = memoryFileIo();
    const failingPersistence: BlueprintPersistencePort = {
      listByScan: async () => [],
      upsert: async () => {
        throw new Error('db write failed');
      },
      deleteById: async () => false
    };

    const outcome = await runBlueprintLifecycle(
      { scanId, projectId, generatedAt: GENERATED_AT },
      {
        run: validRun(),
        persistence: failingPersistence,
        fileIo,
        events: { emit: () => undefined }
      }
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.blueprintId).toBeNull();
    // The file was written and then rolled back, so no orphan remains.
    expect(fileIo.writes).toHaveLength(1);
    expect(fileIo.deletes).toEqual(fileIo.writes);
    expect(fileIo.files.size).toBe(0);
    expect(await storage.blueprints.countByScan(scanId)).toBe(0);
  });

  it('reports a synthesis failure honestly without persisting anything', async () => {
    const fileIo = memoryFileIo();
    const events: AppEvent[] = [];
    const failingRun: BlueprintRunFn = async () => ({
      ok: false,
      error: {
        code: 'BLUEPRINT_VALIDATION_FAILED',
        category: 'blueprint',
        message: 'no pages',
        severity: 'error',
        recoverable: true,
        retryable: false,
        suggestedAction: 'retry',
        timestamp: new Date().toISOString()
      }
    });

    const outcome = await runBlueprintLifecycle(
      { scanId, projectId },
      {
        run: failingRun,
        persistence: persistenceFrom(storage),
        fileIo,
        events: { emit: (event) => events.push(event) }
      }
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.error?.category).toBe('blueprint');
    expect(fileIo.writes).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual([
      'blueprint.started',
      'blueprint.validation_failed',
      'blueprint.completed'
    ]);
  });

  it('never throws when storage is not ready and no persistence is injected', async () => {
    // `vi` is unused otherwise; keep the import meaningful by asserting the call
    // resolves rather than rejecting.
    const outcome = await runBlueprintLifecycle({ scanId, projectId });
    expect(outcome.failed).toBe(true);
    expect(outcome.error?.code).toBe('STORAGE_NOT_READY');
    void vi;
  });
});

describe('blueprintLifecycle helpers', () => {
  it('computes the next version from existing revisions', () => {
    expect(nextBlueprintVersion([])).toBe(1);
    expect(
      nextBlueprintVersion([{ version: 1 }, { version: 3 }] as unknown as BlueprintRecord[])
    ).toBe(4);
  });

  it('builds a filesystem-safe document id and derives it back from a path', () => {
    const id = blueprintDocumentId('scan/../1', 2);
    expect(id).not.toContain('/');
    expect(id).not.toContain('..');
    expect(blueprintIdFromPath(`v1/${id}.json`)).toBe(id);
    expect(blueprintIdFromPath('v1/../escape.json')).toBeNull();
  });
});
