/**
 * Composed post-crawl pipeline harness - Artupski ReSite (Phase 16 E2E)
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 8.1 and 9.1.
 *
 * This harness composes the REAL Phase 9-14 services with NO browser and NO
 * network, driving the exact production entrypoints:
 *
 *   real in-memory SQLite (createTestStorage)
 *     -> real `runBlueprintLifecycle` (real `runBlueprint` synthesis + real
 *        Blueprint persistence + sandboxed file-write seam)
 *     -> real `synthesizeComponents` (scripted engine; the only AI seam)
 *     -> real `generateProject` (writes a buildable project to disk)
 *     -> real `exportProject` ZIP + `readZip` verification
 *
 * The evidence documents are the deterministic Phase 9 fixtures; no public
 * website is contacted. The harness returns an honest, fully-typed result so the
 * test asserts the wiring rather than re-implementing it.
 */
import { promises as fs } from 'node:fs';
import { createTestStorage, type TestStorage } from '../../src/services/storage/__tests__/helpers';
import type { UpsertBlueprintInput, UpsertScanPageInput } from '../../src/services/storage';
import type { ScanPage } from '../../src/types/models';
import type { Blueprint } from '../../src/types/blueprint';
import type { BlueprintReadStore, RunBlueprintDeps } from '../../src/services/blueprint/runBlueprint';
import {
  loadBlueprintDocument,
  runBlueprintLifecycle,
  type BlueprintFilePort,
  type BlueprintLifecycleOutcome,
  type BlueprintPersistencePort
} from '../../src/services/blueprint/blueprintLifecycle';
import type { EvidenceIo } from '../../src/services/blueprint/evidence';
import { fixtureEvidence } from '../../src/services/blueprint/__tests__/fixtures';
import {
  synthesizeComponents,
  type ComponentSynthesisEngine
} from '../../src/services/generator/componentSynthesizer';
import type { ComponentSynthesisResult } from '../../src/types/componentSynth';
import { generateProject } from '../../src/services/generator/projectGenerator';
import type { ProjectGenerationReport } from '../../src/types/projectGen';
import { createNodeExportIo, exportProject } from '../../src/services/exporter/zipExporter';
import { readZip, type ZipArchive } from '../../src/services/exporter/zip';
import type { ExportProjectReport } from '../../src/types/export';
import type { ErrorCategory, ErrorCode, StructuredError } from '../../src/services/infra/errors';
import type { AppEvent } from '../../src/services/infra/eventBus';

/** Build a bounded, honest structured error for a harness-reported failure. */
function err(code: ErrorCode, category: ErrorCategory, message: string): StructuredError {
  return {
    code,
    category,
    message,
    severity: 'error',
    recoverable: true,
    retryable: false,
    suggestedAction: 'Inspect the pipeline harness result.',
    timestamp: new Date().toISOString()
  };
}

/** Timings (milliseconds) for each real stage of the offline pipeline. */
export interface PipelineTimingsMs {
  blueprint: number;
  synthesis: number;
  generate: number;
  export: number;
  total: number;
}

/** The fully-typed result of one offline pipeline run. */
export interface PipelineRunResult {
  ok: boolean;
  scanId: string;
  projectId: string;
  blueprint?: Blueprint;
  lifecycle?: BlueprintLifecycleOutcome;
  synthesis?: ComponentSynthesisResult;
  project?: ProjectGenerationReport;
  export?: ExportProjectReport;
  /** The produced archive, verified by `readZip`, when the export succeeded. */
  archive?: ZipArchive;
  events: AppEvent[];
  timingsMs: PipelineTimingsMs;
  error?: StructuredError;
}

/** Inputs the offline pipeline needs to run. */
export interface OfflinePipelineInput {
  /** Absolute directory the generated project is written beneath. */
  targetRoot: string;
  /** Absolute directory the export artifact is written beneath. */
  destinationRoot: string;
  /** Optional per-run page count (default 2). Bounded 1..6. */
  pageCount?: number;
  /** Optional generated `package.json` name. */
  projectName?: string;
}

/** An in-memory sandboxed blueprint file port that records every write. */
export function memoryBlueprintFileIo(): BlueprintFilePort & {
  files: Map<string, Uint8Array>;
} {
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

/** A store adapter over the real repositories. */
export function storeFrom(storage: TestStorage): BlueprintReadStore {
  return {
    listPages: (scanId) => storage.pages.listByScan(scanId),
    listAssets: (scanId) => storage.assets.listByScan(scanId),
    listTechnologies: (scanId) => storage.technologies.listByScan(scanId),
    listResponsive: (scanId) => storage.responsiveCaptures.listByScan(scanId)
  };
}

/** A persistence port over the real Blueprint repository. */
export function persistenceFrom(storage: TestStorage): BlueprintPersistencePort {
  return {
    listByScan: (scanId) => storage.blueprints.listByScan(scanId),
    upsert: (input: UpsertBlueprintInput) => storage.blueprints.upsert(input),
    deleteById: (id) => storage.blueprints.deleteById(id)
  };
}

/** Build a deterministic evidence IO keyed by the last path segment. */
export function evidenceIoFor(map: Record<string, unknown>): EvidenceIo {
  return {
    async read(path) {
      const key = path.split('/').pop() ?? '';
      const value = map[key];
      return value === undefined ? null : new TextEncoder().encode(JSON.stringify(value));
    }
  };
}

function pageInput(
  scanId: string,
  index: number,
  url: string,
  evidenceId: string
): UpsertScanPageInput {
  return {
    scanId,
    url,
    finalUrl: url,
    path: index === 0 ? '/' : `/page-${index}`,
    depth: index === 0 ? 0 : 1,
    httpStatus: 200,
    title: index === 0 ? 'Fixture Home' : `Fixture Page ${index}`,
    metaDescription: 'A controlled local fixture.',
    canonicalUrl: url,
    robotsMeta: 'index, follow',
    status: 'completed',
    authStatus: 'public',
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 12,
    domContentLoadedTimeMs: 6,
    domNodeCount: 120,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    warnings: [],
    capturedAt: '2026-10-01T00:00:00.000Z',
    blueprintEvidencePath: `v1/${evidenceId}`
  };
}

/** Seed a completed scan with N completed pages + readable evidence. */
export async function seedOfflineScan(
  storage: TestStorage,
  pageCount = 2
): Promise<{ projectId: string; scanId: string; pages: ScanPage[] }> {
  const project = await storage.projects.create({
    name: 'Phase 16 E2E',
    targetUrl: 'http://127.0.0.1:8100/blueprint',
    storagePath: '/e2e'
  });
  const scan = await storage.scans.create({ projectId: project.id, status: 'completed' });

  const bounded = Math.min(Math.max(Math.floor(pageCount), 1), 6);
  const inputs: UpsertScanPageInput[] = [];
  for (let index = 0; index < bounded; index += 1) {
    const url =
      index === 0
        ? 'http://127.0.0.1:8100/blueprint'
        : `http://127.0.0.1:8100/blueprint/page-${index}`;
    inputs.push(pageInput(scan.id, index, url, `evidence-p${index}.json`));
  }
  await storage.pages.upsertMany(inputs);
  const pages = await storage.pages.listByScan(scan.id);
  return { projectId: project.id, scanId: scan.id, pages };
}

/** Build the evidence map matching `seedOfflineScan`'s page evidence paths. */
export function evidenceMapFor(pages: readonly ScanPage[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const page of pages) {
    const key = page.blueprintEvidencePath?.split('/').pop();
    if (key) {
      map[key] = fixtureEvidence(page.url);
    }
  }
  return map;
}

/**
 * Run the full offline composed pipeline. Never throws: an unexpected failure is
 * reported as `ok: false` with a structured error and whatever partial result was
 * produced, so the caller never mistakes a broken run for a passing one.
 */
export async function runOfflinePipeline(
  input: OfflinePipelineInput,
  deps: { storage: TestStorage; engine: ComponentSynthesisEngine }
): Promise<PipelineRunResult> {
  const { storage, engine } = deps;
  const events: AppEvent[] = [];
  const timingsMs: PipelineTimingsMs = { blueprint: 0, synthesis: 0, generate: 0, export: 0, total: 0 };
  const startedAt = Date.now();

  const result: PipelineRunResult = { ok: false, scanId: '', projectId: '', events, timingsMs };

  try {
    const seeded = await seedOfflineScan(storage, input.pageCount ?? 2);
    result.scanId = seeded.scanId;
    result.projectId = seeded.projectId;

    const fileIo = memoryBlueprintFileIo();
    const runDeps: RunBlueprintDeps = {
      store: storeFrom(storage),
      evidenceIo: evidenceIoFor(evidenceMapFor(seeded.pages))
    };

    // --- 1. Real Blueprint lifecycle (real runBlueprint + persistence). -------
    const blueprintStart = Date.now();
    const lifecycle = await runBlueprintLifecycle(
      {
        scanId: seeded.scanId,
        projectId: seeded.projectId,
        sourceUrl: 'http://127.0.0.1:8100/blueprint',
        generatedAt: '2026-10-01T00:00:00.000Z'
      },
      {
        runDeps,
        persistence: persistenceFrom(storage),
        fileIo,
        events: { emit: (event) => events.push(event) }
      }
    );
    timingsMs.blueprint = Date.now() - blueprintStart;
    result.lifecycle = lifecycle;

    if (lifecycle.failed || !lifecycle.blueprintId) {
      result.error =
        lifecycle.error ??
        err('BLUEPRINT_VALIDATION_FAILED', 'blueprint', 'The Blueprint lifecycle produced no document.');
      return result;
    }

    // Read the persisted document back through the sandboxed read seam.
    const record = await storage.blueprints.getLatestByScan(seeded.scanId);
    if (!record) {
      result.error = err(
        'STORAGE_READ_FAILED',
        'database',
        'The persisted Blueprint row could not be read back.'
      );
      return result;
    }
    const view = await loadBlueprintDocument(record, { fileIo });
    if (!view.document) {
      result.error = err(
        'STORAGE_READ_FAILED',
        'database',
        view.readError ?? 'The Blueprint document could not be read.'
      );
      return result;
    }
    const blueprint: Blueprint = view.document;
    result.blueprint = blueprint;

    // --- 2. Real component synthesis over the scripted engine. ----------------
    const synthesisStart = Date.now();
    const synthesis = await synthesizeComponents(
      { engine, events: { emit: (event) => events.push(event) } },
      { blueprint, options: {} }
    );
    timingsMs.synthesis = Date.now() - synthesisStart;
    result.synthesis = synthesis;

    // --- 3. Real project generation. ------------------------------------------
    const generateStart = Date.now();
    const project = await generateProject(
      { events: { emit: (event) => events.push(event) } },
      {
        blueprint,
        components: synthesis.components,
        targetRoot: input.targetRoot,
        options: { projectName: input.projectName ?? 'resite-generated-app' }
      }
    );
    timingsMs.generate = Date.now() - generateStart;
    result.project = project;
    if (!project.ok) {
      result.error = err(
        'STORAGE_WRITE_FAILED',
        'io',
        project.error?.message ?? 'Project generation failed.'
      );
      return result;
    }

    // --- 4. Real export (ZIP) + independent unzip verification. ---------------
    const exportStart = Date.now();
    const io = createNodeExportIo();
    const exported = await exportProject(
      { reader: io.reader, writer: io.writer, events: { emit: (event) => events.push(event) } },
      {
        projectRoot: input.targetRoot,
        report: project,
        projectName: 'Resite Generated App',
        targetFramework: 'Vite + React + TypeScript + Tailwind',
        targetUrl: 'http://127.0.0.1:8100/blueprint',
        description: 'Produced by the Phase 16 end-to-end pipeline.',
        mode: 'zip',
        destinationRoot: input.destinationRoot
      }
    );
    timingsMs.export = Date.now() - exportStart;
    result.export = exported;
    if (!exported.ok) {
      result.error = err('EXPORT_WRITE_FAILED', 'io', exported.error?.message ?? 'Export failed.');
      return result;
    }

    const archiveBytes = new Uint8Array(await fs.readFile(`${input.destinationRoot}/${exported.artifactPath}`));
    result.archive = readZip(archiveBytes);
    result.ok = true;
    return result;
  } catch (thrown) {
    result.error = {
      ...err(
        'BLUEPRINT_VALIDATION_FAILED',
        'blueprint',
        thrown instanceof Error ? thrown.message : 'The pipeline failed unexpectedly.'
      ),
      recoverable: false
    };
    return result;
  } finally {
    timingsMs.total = Date.now() - startedAt;
  }
}

/** Create an isolated temp root for a pipeline run. */
export async function makeTempRoot(prefix: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return mkdtemp(join(tmpdir(), prefix));
}

export { createTestStorage };
