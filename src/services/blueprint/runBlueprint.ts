/**
 * Blueprint synthesis entrypoint - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 8.1/9.
 *
 * The service-layer entrypoint the (future) store/UI seam calls: it resolves a
 * completed scan and its persisted pages/assets/technologies/responsive
 * captures from storage, runs `synthesizeBlueprint` through the sandboxed
 * evidence-read seam, and returns the assembled + validated document with its
 * provenance summary.
 *
 * SCOPE: this subtask deliberately does NOT persist the Blueprint row, emit
 * `blueprint.*` events, or touch the UI - those are later Phase 9 subtasks. This
 * function only reads storage and normalizes. It never throws: a missing scan or
 * unavailable storage is reported as a structured error.
 */
import { storageService } from '../storage';
import { createStorageError } from '../storage/errors';
import { toStructuredError, type StructuredError } from '../infra/errors';
import type { CloneAsset, ResponsiveCapture, ScanPage, ScanTechnology } from '../../types/models';
import {
  eligiblePages,
  synthesizeBlueprint,
  type BlueprintProvenanceSummary,
  type BlueprintSynthesisRequest
} from './blueprintService';
import { defaultEvidenceIo } from './blueprintFactory';
import type { EvidenceIo, SkippedPageEvidence } from './evidence';
import type { ValidationOutcome } from './validate';
import type { Blueprint } from '../../types/blueprint';

export interface RunBlueprintRequest {
  scanId: string;
  projectId: string;
  /** Optional seed URL override; otherwise derived from the scan's pages. */
  sourceUrl?: string;
  /** Deterministic output override (tests). Defaults to the current time. */
  generatedAt?: string;
}

export interface RunBlueprintOutcome {
  blueprint: Blueprint;
  validation: ValidationOutcome;
  provenanceSummary: BlueprintProvenanceSummary;
  skippedPages: SkippedPageEvidence[];
}

export type RunBlueprintResult =
  { ok: true; data: RunBlueprintOutcome } | { ok: false; error: StructuredError };

/** Persisted rows the entrypoint reads (injectable for tests). */
export interface BlueprintReadStore {
  listPages(scanId: string): Promise<ScanPage[]>;
  listAssets(scanId: string): Promise<CloneAsset[]>;
  listTechnologies(scanId: string): Promise<ScanTechnology[]>;
  listResponsive(scanId: string): Promise<ResponsiveCapture[]>;
}

/** The injectable seams (storage reads + sandboxed evidence reads). */
export interface RunBlueprintDeps {
  store?: BlueprintReadStore;
  evidenceIo?: EvidenceIo;
}

function defaultStore(): BlueprintReadStore {
  const repositories = storageService.getRepositories();
  return {
    listPages: (scanId) => repositories.pages.listByScan(scanId),
    listAssets: (scanId) => repositories.assets.listByScan(scanId),
    listTechnologies: (scanId) => repositories.technologies.listByScan(scanId),
    listResponsive: (scanId) => repositories.responsiveCaptures.listByScan(scanId)
  };
}

/** Derive a source URL from the shallowest completed page (or the first page). */
function deriveSourceUrl(pages: readonly ScanPage[], override?: string): string {
  if (override && override.length > 0) {
    return override;
  }
  const ordered = [...pages].sort(
    (a, b) => a.depth - b.depth || a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
  );
  return ordered[0]?.url ?? '';
}

/**
 * Run Blueprint synthesis for a scan. Never throws; every failure is returned as
 * a `StructuredError` (category `blueprint`).
 */
export async function runBlueprint(
  request: RunBlueprintRequest,
  deps: RunBlueprintDeps = {}
): Promise<RunBlueprintResult> {
  if (!deps.store && storageService.getState() !== 'ready') {
    return {
      ok: false,
      error: createStorageError('STORAGE_NOT_READY', {
        message: 'Cannot generate the Blueprint: local storage is not ready.'
      })
    };
  }

  try {
    const store = deps.store ?? defaultStore();
    const [allPages, assets, technologies, responsiveCaptures] = await Promise.all([
      store.listPages(request.scanId),
      store.listAssets(request.scanId),
      store.listTechnologies(request.scanId),
      store.listResponsive(request.scanId)
    ]);

    const pages = eligiblePages(allPages);
    const sourceUrl = deriveSourceUrl(pages.length > 0 ? pages : allPages, request.sourceUrl);
    if (sourceUrl.length === 0) {
      return {
        ok: false,
        error: {
          ...createStorageError('STORAGE_READ_FAILED', {
            message: 'The scan has no pages to derive a Blueprint source URL from.'
          }),
          category: 'blueprint'
        }
      };
    }

    const synthesisRequest: BlueprintSynthesisRequest = {
      scanId: request.scanId,
      projectId: request.projectId,
      sourceUrl,
      pages,
      assets,
      technologies,
      responsiveCaptures,
      ...(request.generatedAt ? { generatedAt: request.generatedAt } : {})
    };

    const result = await synthesizeBlueprint(synthesisRequest, {
      evidenceIo: deps.evidenceIo ?? defaultEvidenceIo
    });

    return {
      ok: true,
      data: {
        blueprint: result.blueprint,
        validation: result.validation,
        provenanceSummary: result.provenanceSummary,
        skippedPages: result.skippedPages
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: 'BLUEPRINT_VALIDATION_FAILED',
        category: 'blueprint',
        message: 'Blueprint synthesis failed unexpectedly.',
        suggestedAction: 'Re-run the scan and try again.'
      })
    };
  }
}
