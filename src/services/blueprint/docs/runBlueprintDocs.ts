/**
 * Blueprint documentation service entrypoint - Artupski ReSite
 *
 * Resolves the latest persisted Blueprint for a scan (the database is the source
 * of truth), reads its sandboxed document, and runs the AI-powered documentation
 * generator. Mirrors `runBlueprint`: it never throws and reports every failure as
 * a structured error so a docs problem can never change a scan's terminal status.
 *
 * It performs NO persistence of its own; the returned documents are for the UI
 * and for downstream project generation / export, which write them to disk.
 */
import type { Blueprint as BlueprintRecord } from '../../../types/models';
import type { BlueprintDocsOptions, BlueprintDocsResult } from '../../../types/blueprintDocs';
import type { BlueprintRoot } from '../../../types/blueprint';
import { toStructuredError, type StructuredError } from '../../infra/errors';
import { createStorageError } from '../../storage/errors';
import { storageService } from '../../storage';
import { loadBlueprintDocument } from '../blueprintLifecycle';
import { generateBlueprintDocs, type BlueprintDocsDeps } from './generate';

export interface RunBlueprintDocsRequest {
  scanId: string;
  options?: BlueprintDocsOptions;
}

export type RunBlueprintDocsResult =
  | { ok: true; data: BlueprintDocsResult }
  | { ok: false; error: StructuredError };

/** Persisted-row access (injectable for tests). */
export interface BlueprintDocsReadStore {
  getLatestByScan(scanId: string): Promise<BlueprintRecord | null>;
}

export interface RunBlueprintDocsDeps extends BlueprintDocsDeps {
  store?: BlueprintDocsReadStore;
  /** Document reader override (tests). Defaults to the sandboxed reader. */
  loadDocument?: (record: BlueprintRecord) => Promise<BlueprintRoot | null>;
}

function defaultStore(): BlueprintDocsReadStore {
  return {
    getLatestByScan: (scanId) => storageService.getRepositories().blueprints.getLatestByScan(scanId)
  };
}

async function defaultLoadDocument(record: BlueprintRecord): Promise<BlueprintRoot | null> {
  const view = await loadBlueprintDocument(record);
  return view.document;
}

/**
 * Generate the documentation set for the latest persisted Blueprint of a scan.
 * Never throws; a missing/unreadable Blueprint is reported as a structured error.
 */
export async function runBlueprintDocs(
  request: RunBlueprintDocsRequest,
  deps: RunBlueprintDocsDeps = {}
): Promise<RunBlueprintDocsResult> {
  if (!deps.store && storageService.getState() !== 'ready') {
    return {
      ok: false,
      error: createStorageError('STORAGE_NOT_READY', {
        message: 'Cannot generate documentation: local storage is not ready.'
      })
    };
  }

  try {
    const store = deps.store ?? defaultStore();
    const record = await store.getLatestByScan(request.scanId);
    if (!record) {
      return {
        ok: false,
        error: {
          ...createStorageError('STORAGE_READ_FAILED', {
            message: 'No Blueprint exists for this scan; generate the Blueprint first.'
          }),
          category: 'blueprint'
        }
      };
    }

    const load = deps.loadDocument ?? defaultLoadDocument;
    const document = await load(record);
    if (!document) {
      return {
        ok: false,
        error: {
          ...createStorageError('STORAGE_READ_FAILED', {
            message: 'The Blueprint document could not be read; documentation was not generated.'
          }),
          category: 'blueprint'
        }
      };
    }

    const result = await generateBlueprintDocs(document, request.options ?? {}, {
      ...(deps.engine ? { engine: deps.engine } : {}),
      ...(deps.events ? { events: deps.events } : {})
    });
    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: 'BLUEPRINT_VALIDATION_FAILED',
        category: 'blueprint',
        message: 'Documentation generation failed unexpectedly.',
        suggestedAction: 'Re-run the scan and regenerate the Blueprint, then try again.'
      })
    };
  }
}
