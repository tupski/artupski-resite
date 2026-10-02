/**
 * Blueprint evidence capture service - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.1 (decision
 * C12) and docs/specs/BLUEPRINT-SPEC.md (the evidence the Blueprint needs).
 *
 * Orchestrates the bounded, read-only evidence capture step: for each completed
 * page it asks the worker (`captureBlueprint`) for the semantic DOM tree plus the
 * computed-style subset, writes the bounded JSON document through the sandboxed
 * `blueprint_write` command, and records the on-disk path on the page row via
 * `ScanPageRepository.updateBlueprintEvidencePath` (migration 008).
 *
 * Boundaries / honesty:
 *   - The React UI never calls this directly; `scanService` runs it after a
 *     completed crawl, gated by the opt-in `blueprint` flag.
 *   - Evidence JSON is written through the existing sandboxed blueprint file I/O
 *     (no second persistence abstraction, no bytes in SQLite).
 *   - A capture failure for one page is recorded as a skip and does NOT fail the
 *     crawl; the outcome reports partial coverage honestly.
 *   - No secret (cookie/storage/input value/header) is ever captured: the worker
 *     returns structure + computed styles only.
 */
import { logger } from '../infra/logger';
import type { StructuredError } from '../infra/errors';
import { createStructuredError } from '../infra/errors';
import { storageService } from '../storage';
import { blueprintWrite } from '../ipc';
import { isTauriRuntime } from '../ipc/tauri';
import type { BlueprintEvidence } from '../infra/workerProtocol';

/** The worker/runtime seam this service depends on (injectable for tests). */
export interface BlueprintEvidenceWorker {
  captureBlueprint(
    sessionId: string,
    url: string,
    options?: { timeoutMs?: number; maxNodes?: number; maxBytes?: number }
  ): Promise<
    { ok: true; data: { evidence: BlueprintEvidence } } | { ok: false; error: StructuredError }
  >;
}

/**
 * Sandboxed evidence-file I/O seam (implemented over the Rust `blueprint_write`
 * command). `write` returns the sandboxed relative path on success, or null.
 */
export interface BlueprintEvidenceIo {
  write(id: string, data: Uint8Array): Promise<string | null>;
}

/** Persistence seam (implemented over `ScanPageRepository`). */
export interface BlueprintEvidencePersistence {
  updateBlueprintEvidencePath(pageId: string, path: string | null): Promise<number>;
}

export interface BlueprintEvidenceRequest {
  scanId: string;
  projectId: string;
  sessionId: string;
  /** Pages to capture (already persisted `scan_pages` rows: { id, url }). */
  pages: Array<{ id: string; url: string }>;
  /** Navigation timeout per capture (worker clamps to <= 30s). */
  timeoutMs?: number;
  /** Optional node cap (worker clamps to `MAX_BLUEPRINT_NODES`). */
  maxNodes?: number;
  /** Optional byte cap (worker clamps to `MAX_BLUEPRINT_BYTES`). */
  maxBytes?: number;
}

export interface BlueprintEvidenceOutcome {
  scanId: string;
  captured: number;
  skipped: number;
}

export interface BlueprintEvidenceDeps {
  worker: BlueprintEvidenceWorker;
  io?: BlueprintEvidenceIo;
  persistence?: BlueprintEvidencePersistence;
}

/**
 * Deterministic, filesystem-safe evidence id for a page. Uses only
 * `[a-zA-Z0-9_-]` so a `..` or separator can never form; the Rust command
 * re-validates it and writes `<blueprints>/v1/<id>.json`.
 */
export function blueprintEvidenceId(pageId: string): string {
  const safe = pageId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `evidence-${safe}`;
}

/** Encode a UTF-8 string without a Node-only dependency. */
function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  return new Uint8Array(bufferCtor.from(text, 'utf8'));
}

/** Production IO: write through the sandboxed Rust `blueprint_write` command. */
export const defaultBlueprintEvidenceIo: BlueprintEvidenceIo = {
  async write(id, data) {
    if (!isTauriRuntime()) {
      return null;
    }
    const result = await blueprintWrite(id, data);
    return result.ok ? result.data : null;
  }
};

/**
 * Capture evidence for every page, writing one bounded JSON document per page
 * and recording its path on the page row. Never throws: a per-page failure is
 * recorded as a skip so the crawl's terminal status is unaffected.
 */
export async function runBlueprintEvidenceCapture(
  request: BlueprintEvidenceRequest,
  deps: BlueprintEvidenceDeps
): Promise<BlueprintEvidenceOutcome> {
  const log = logger.child('blueprint-evidence');
  const io = deps.io ?? defaultBlueprintEvidenceIo;

  let captured = 0;
  let skipped = 0;

  if (storageService.getState() !== 'ready' || request.pages.length === 0) {
    return {
      scanId: request.scanId,
      captured: 0,
      skipped: request.pages.length
    };
  }
  const persistence = deps.persistence ?? {
    updateBlueprintEvidencePath: (pageId: string, path: string | null) =>
      storageService.getRepositories().pages.updateBlueprintEvidencePath(pageId, path)
  };

  for (const page of request.pages) {
    try {
      const result = await deps.worker.captureBlueprint(request.sessionId, page.url, {
        timeoutMs: request.timeoutMs,
        maxNodes: request.maxNodes,
        maxBytes: request.maxBytes
      });
      if (!result.ok) {
        skipped += 1;
        log.debug('Blueprint evidence skipped', {
          url: page.url,
          code: result.error.code
        });
        continue;
      }

      const json = JSON.stringify(result.data.evidence);
      const path = await io.write(blueprintEvidenceId(page.id), encodeUtf8(json));
      if (!path) {
        // No sandbox (browser preview) or the write failed: record the skip
        // rather than claiming evidence exists.
        skipped += 1;
        log.debug('Blueprint evidence not persisted', { url: page.url });
        continue;
      }

      await persistence.updateBlueprintEvidencePath(page.id, path);
      captured += 1;
    } catch (error) {
      skipped += 1;
      log.warn('Blueprint evidence capture failed', { url: page.url, error: String(error) });
    }
  }

  // NOTE: evidence capture is a prerequisite for Blueprint synthesis, not
  // synthesis itself. The `blueprint.*` lifecycle events are emitted by the
  // synthesis service (a later Phase 9 subtask); this step only logs.
  log.info('Blueprint evidence capture complete', { scanId: request.scanId, captured, skipped });
  return { scanId: request.scanId, captured, skipped };
}

/** A structured error for callers that need one (never thrown internally). */
export function createBlueprintEvidenceError(
  message: string,
  suggestedAction: string
): StructuredError {
  return createStructuredError({
    code: 'BLUEPRINT_VALIDATION_FAILED',
    category: 'blueprint',
    message,
    severity: 'warning',
    recoverable: true,
    retryable: true,
    suggestedAction
  });
}
