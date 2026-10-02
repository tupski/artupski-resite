/**
 * Blueprint lifecycle + persistence wrapper - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 6, 8.1, 8.3, 9
 * and docs/architecture/EVENT-SYSTEM.md (`blueprint.*`).
 *
 * This is the thin, honest seam between the PURE synthesis entrypoint
 * (`runBlueprint`, which only reads storage and normalizes) and durable
 * persistence. It:
 *
 *   1. runs synthesis (injectable),
 *   2. writes the document bytes through the sandboxed `blueprint_write` seam
 *      (`<blueprints>/v1/<id>.json`),
 *   3. upserts the `blueprints` row (the repository owns all SQL), and
 *   4. emits the `blueprint.*` lifecycle events.
 *
 * Failure isolation (mandatory): this module NEVER throws. A synthesis, file,
 * or persistence failure is reported as an honest outcome so the caller (e.g.
 * `scanService.runScan`) can never let a Blueprint problem change the crawl's
 * terminal status. An invalid document is PERSISTED with `is_valid = false` +
 * bounded validation errors rather than discarded.
 *
 * No-orphan guarantee: the document is written before the row. If the row write
 * fails afterwards, the freshly written file is deleted so a file is never left
 * without its row. If the file write fails, no row is created.
 *
 * Regeneration: a new run for the same scan computes `version + 1` (respecting
 * the UNIQUE `(scan_id, version)` index) so history is preserved and re-runs
 * never collide.
 */
import { createEvent, eventBus, type AppEvent } from '../infra/eventBus';
import { logger } from '../infra/logger';
import { toStructuredError, type StructuredError } from '../infra/errors';
import { createStorageError } from '../storage/errors';
import { storageService } from '../storage';
import { isTauriRuntime } from '../ipc/tauri';
import {
  BLUEPRINT_SCHEMA_VERSION,
  type BlueprintRoot,
  type BlueprintValidationError
} from '../../types/blueprint';
import type { Blueprint as BlueprintRecord } from '../../types/models';
import type { UpsertBlueprintInput } from '../storage';
import { decodeUtf8, encodeUtf8, parseJson } from './util';
import { evidenceIdFromPath } from './evidence';
import {
  runBlueprint,
  type RunBlueprintDeps,
  type RunBlueprintOutcome,
  type RunBlueprintRequest,
  type RunBlueprintResult
} from './runBlueprint';

/** Maximum validation errors carried on an event (bounded; never document content). */
export const MAX_EVENT_VALIDATION_ERRORS = 20;

/* -------------------------------------------------------------------------- */
/* Injectable seams                                                           */
/* -------------------------------------------------------------------------- */

/** Sandboxed document file I/O. Implemented over the Rust `blueprint_*` commands. */
export interface BlueprintFilePort {
  /** Write `<blueprints>/v1/<id>.json`; returns the sandboxed relative path or null. */
  write(id: string, data: Uint8Array): Promise<string | null>;
  /** Read the document bytes, or null when absent/unavailable. */
  read(id: string): Promise<Uint8Array | null>;
  /** Delete the document. A missing file is not an error. */
  delete(id: string): Promise<void>;
}

/** Persistence port (implemented over `BlueprintRepository`). */
export interface BlueprintPersistencePort {
  listByScan(scanId: string): Promise<BlueprintRecord[]>;
  upsert(input: UpsertBlueprintInput): Promise<BlueprintRecord>;
  deleteById(id: string): Promise<boolean>;
}

/** Event sink; defaults to the shared `EventBus`. Injectable for tests. */
export interface BlueprintEventSink {
  emit(event: AppEvent): void;
}

/** Synthesis function seam; defaults to the pure `runBlueprint`. */
export type BlueprintRunFn = (
  request: RunBlueprintRequest,
  deps?: RunBlueprintDeps
) => Promise<RunBlueprintResult>;

export interface BlueprintLifecycleDeps {
  run?: BlueprintRunFn;
  runDeps?: RunBlueprintDeps;
  persistence?: BlueprintPersistencePort;
  fileIo?: BlueprintFilePort;
  events?: BlueprintEventSink;
}

/* -------------------------------------------------------------------------- */
/* Default (live) seams                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Production file I/O. Outside the Tauri shell there is no sandbox, so writes
 * honestly report `null` (no file is claimed) and reads report `null`.
 */
export const defaultBlueprintFileIo: BlueprintFilePort = {
  async write(id, data) {
    if (!isTauriRuntime()) {
      return null;
    }
    const { blueprintWrite } = await import('../ipc');
    const result = await blueprintWrite(id, data);
    return result.ok ? result.data : null;
  },
  async read(id) {
    if (!isTauriRuntime()) {
      return null;
    }
    const { blueprintRead } = await import('../ipc');
    const result = await blueprintRead(id);
    return result.ok ? Uint8Array.from(result.data) : null;
  },
  async delete(id) {
    if (!isTauriRuntime()) {
      return;
    }
    const { blueprintDelete } = await import('../ipc');
    await blueprintDelete(id);
  }
};

function defaultPersistence(): BlueprintPersistencePort {
  return {
    listByScan: (scanId) => storageService.getRepositories().blueprints.listByScan(scanId),
    upsert: (input) => storageService.getRepositories().blueprints.upsert(input),
    deleteById: (id) => storageService.getRepositories().blueprints.deleteById(id)
  };
}

/* -------------------------------------------------------------------------- */
/* Outcome types                                                              */
/* -------------------------------------------------------------------------- */

/** Honest summary of one Blueprint lifecycle attempt. */
export interface BlueprintLifecycleOutcome {
  scanId: string;
  projectId: string;
  /** Null when nothing was persisted (synthesis or file write failed). */
  blueprintId: string | null;
  /** Document revision (0 when no document was persisted). */
  version: number;
  schemaVersion: number;
  isValid: boolean;
  validationErrors: BlueprintValidationError[];
  /** Sandboxed relative document path, or null when not persisted. */
  filePath: string | null;
  pageCount: number;
  componentCount: number;
  skippedPages: number;
  /** True when synthesis failed or evidence was skipped/unreadable. */
  partial: boolean;
  /** True when synthesis itself failed and no document exists. */
  failed: boolean;
  /** Structured error when `failed` is true, otherwise null. */
  error: StructuredError | null;
}

/** A persisted row plus its (optionally) parsed document. */
export interface BlueprintDocumentView {
  record: BlueprintRecord;
  document: BlueprintRoot | null;
  /** Raw JSON text when it could be read, else null. */
  json: string | null;
  /** Honest reason the document body could not be read, or null. */
  readError: string | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Derive the sandboxed document id from a stored `v1/<id>.json` path. */
export function blueprintIdFromPath(path: string): string | null {
  return evidenceIdFromPath(path);
}

/** Deterministic, filesystem-safe document id for a scan revision. */
export function blueprintDocumentId(scanId: string, version: number): string {
  const safe = scanId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `bp-${safe}-v${version}`;
}

/** Next document revision for a scan (max existing + 1; 1 when none exist). */
export function nextBlueprintVersion(existing: readonly BlueprintRecord[]): number {
  return existing.reduce((max, record) => Math.max(max, record.version), 0) + 1;
}

function boundErrors(errors: readonly BlueprintValidationError[]): string[] {
  return errors
    .slice(0, MAX_EVENT_VALIDATION_ERRORS)
    .map((error) => `${error.path}: ${error.message}`);
}

function failedOutcome(
  request: RunBlueprintRequest,
  error: StructuredError,
  skippedPages = 0
): BlueprintLifecycleOutcome {
  return {
    scanId: request.scanId,
    projectId: request.projectId,
    blueprintId: null,
    version: 0,
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    isValid: false,
    validationErrors: [],
    filePath: null,
    pageCount: 0,
    componentCount: 0,
    skippedPages,
    partial: true,
    failed: true,
    error
  };
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

interface PersistArgs {
  scanId: string;
  projectId: string;
  outcome: RunBlueprintOutcome;
  persistence: BlueprintPersistencePort;
  fileIo: BlueprintFilePort;
}

/**
 * Write the document bytes then upsert the row, rolling the file back when the
 * row write fails. Returns the persisted record plus the file path, or throws
 * so the caller can emit an honest failure (the caller never lets it escape).
 */
async function persistDocument(
  args: PersistArgs
): Promise<{ record: BlueprintRecord; filePath: string }> {
  const { scanId, projectId, outcome, persistence, fileIo } = args;
  const existing = await persistence.listByScan(scanId);
  const version = nextBlueprintVersion(existing);
  const id = blueprintDocumentId(scanId, version);
  const json = JSON.stringify(outcome.blueprint);

  const filePath = await fileIo.write(id, encodeUtf8(json));
  if (!filePath) {
    throw createStorageError('STORAGE_WRITE_FAILED', {
      message: 'The Blueprint document could not be written to the sandboxed blueprint tree.'
    });
  }

  try {
    const record = await persistence.upsert({
      projectId,
      scanId,
      version,
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      filePath,
      isValid: outcome.validation.valid,
      validationErrors: outcome.validation.errors
    });
    return { record, filePath };
  } catch (error) {
    // Never leave a file without its row.
    try {
      await fileIo.delete(id);
    } catch {
      // Best-effort cleanup; the original persistence failure is reported.
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Synthesize, persist, and emit the `blueprint.*` lifecycle for one scan.
 *
 * Event order (existing reserved keys; no new conflicting names):
 *   `blueprint.started`
 *     -> `blueprint.generated` (valid) | `blueprint.validation_failed` (invalid)
 *     -> `blueprint.completed`
 *
 * Never throws; every failure is an honest outcome with `failed: true`.
 */
export async function runBlueprintLifecycle(
  request: RunBlueprintRequest,
  deps: BlueprintLifecycleDeps = {}
): Promise<BlueprintLifecycleOutcome> {
  const log = logger.child('blueprint');
  const run = deps.run ?? runBlueprint;
  const events = deps.events ?? { emit: (event) => eventBus.emit(event) };
  const fileIo = deps.fileIo ?? defaultBlueprintFileIo;

  events.emit(
    createEvent('blueprint.started', {
      scanId: request.scanId,
      projectId: request.projectId,
      ...(request.sourceUrl ? { sourceUrl: request.sourceUrl } : {})
    })
  );

  // Persistence requires a ready storage layer (unless injected for tests).
  if (!deps.persistence && storageService.getState() !== 'ready') {
    const error = createStorageError('STORAGE_NOT_READY', {
      message: 'Cannot generate the Blueprint: local storage is not ready.'
    });
    events.emit(
      createEvent('blueprint.validation_failed', {
        scanId: request.scanId,
        schemaVersion: BLUEPRINT_SCHEMA_VERSION,
        errorCount: 1,
        errors: [`${error.code}: ${error.message}`]
      })
    );
    events.emit(
      createEvent('blueprint.completed', {
        scanId: request.scanId,
        version: 0,
        isValid: false,
        partial: true,
        skippedPages: 0
      })
    );
    return failedOutcome(request, error);
  }

  let synthesis: RunBlueprintResult;
  try {
    synthesis = await run(request, deps.runDeps);
  } catch (thrown) {
    synthesis = {
      ok: false,
      error: toStructuredError(thrown, {
        code: 'BLUEPRINT_VALIDATION_FAILED',
        category: 'blueprint',
        message: 'Blueprint synthesis failed unexpectedly.'
      })
    };
  }

  if (!synthesis.ok) {
    log.warn('Blueprint synthesis failed', {
      scanId: request.scanId,
      code: synthesis.error.code
    });
    events.emit(
      createEvent('blueprint.validation_failed', {
        scanId: request.scanId,
        schemaVersion: BLUEPRINT_SCHEMA_VERSION,
        errorCount: 1,
        errors: [`${synthesis.error.code}: ${synthesis.error.message}`]
      })
    );
    events.emit(
      createEvent('blueprint.completed', {
        scanId: request.scanId,
        version: 0,
        isValid: false,
        partial: true,
        skippedPages: 0
      })
    );
    return failedOutcome(request, synthesis.error);
  }

  const outcome = synthesis.data;
  const persistence = deps.persistence ?? defaultPersistence();

  let persisted: { record: BlueprintRecord; filePath: string };
  try {
    persisted = await persistDocument({
      scanId: request.scanId,
      projectId: request.projectId,
      outcome,
      persistence,
      fileIo
    });
  } catch (thrown) {
    const error = toStructuredError(thrown, {
      code: 'STORAGE_WRITE_FAILED',
      category: 'blueprint',
      message: 'The Blueprint could not be persisted.',
      suggestedAction: 'Re-run the scan to regenerate the Blueprint.'
    });
    log.warn('Blueprint persistence failed', {
      scanId: request.scanId,
      code: error.code
    });
    events.emit(
      createEvent('blueprint.validation_failed', {
        scanId: request.scanId,
        schemaVersion: BLUEPRINT_SCHEMA_VERSION,
        errorCount: 1,
        errors: [`${error.code}: ${error.message}`]
      })
    );
    events.emit(
      createEvent('blueprint.completed', {
        scanId: request.scanId,
        version: 0,
        isValid: false,
        partial: true,
        skippedPages: outcome.skippedPages.length
      })
    );
    return failedOutcome(request, error, outcome.skippedPages.length);
  }

  const { record, filePath } = persisted;
  const pageCount = outcome.blueprint.pages.length;
  const componentCount = outcome.blueprint.components.length;
  const partial = outcome.skippedPages.length > 0 || outcome.provenanceSummary.nodesTruncated > 0;

  if (record.isValid) {
    events.emit(
      createEvent('blueprint.generated', {
        scanId: request.scanId,
        blueprintId: record.id,
        version: record.version,
        schemaVersion: record.schemaVersion,
        isValid: true,
        pageCount,
        componentCount
      })
    );
  } else {
    events.emit(
      createEvent('blueprint.validation_failed', {
        scanId: request.scanId,
        blueprintId: record.id,
        schemaVersion: record.schemaVersion,
        errorCount: record.validationErrors.length,
        errors: boundErrors(record.validationErrors)
      })
    );
  }

  events.emit(
    createEvent('blueprint.completed', {
      scanId: request.scanId,
      blueprintId: record.id,
      version: record.version,
      isValid: record.isValid,
      partial,
      skippedPages: outcome.skippedPages.length
    })
  );

  log.info('Blueprint persisted', {
    scanId: request.scanId,
    version: record.version,
    valid: record.isValid,
    skippedPages: outcome.skippedPages.length
  });

  return {
    scanId: request.scanId,
    projectId: request.projectId,
    blueprintId: record.id,
    version: record.version,
    schemaVersion: record.schemaVersion,
    isValid: record.isValid,
    validationErrors: record.validationErrors,
    filePath,
    pageCount,
    componentCount,
    skippedPages: outcome.skippedPages.length,
    partial,
    failed: false,
    error: null
  };
}

/* -------------------------------------------------------------------------- */
/* Document reads (for the store / export)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Load a persisted Blueprint document through the sandboxed read seam. Never
 * throws: an unreadable/invalid document is reported honestly (`document: null`,
 * `readError` set) rather than fabricated.
 */
export async function loadBlueprintDocument(
  record: BlueprintRecord,
  deps: { fileIo?: BlueprintFilePort } = {}
): Promise<BlueprintDocumentView> {
  const fileIo = deps.fileIo ?? defaultBlueprintFileIo;
  const id = blueprintIdFromPath(record.filePath);
  if (!id) {
    return {
      record,
      document: null,
      json: null,
      readError: 'The stored Blueprint file path is invalid.'
    };
  }

  let bytes: Uint8Array | null = null;
  try {
    bytes = await fileIo.read(id);
  } catch {
    bytes = null;
  }
  if (!bytes) {
    return {
      record,
      document: null,
      json: null,
      readError: 'The Blueprint document could not be read from disk.'
    };
  }

  const json = decodeUtf8(bytes);
  const parsed = parseJson(json);
  if (parsed === null || typeof parsed !== 'object') {
    return {
      record,
      document: null,
      json,
      readError: 'The stored Blueprint document is not valid JSON.'
    };
  }

  return { record, document: parsed as BlueprintRoot, json, readError: null };
}
