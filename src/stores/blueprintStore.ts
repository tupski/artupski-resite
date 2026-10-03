/**
 * Blueprint store - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 8.2 and
 * docs/design/UI-SPEC.md section 2.4.
 *
 * Honest, read-only UI state for the Phase 9 Blueprint. The database is the
 * source of truth (`blueprintGetLatest` reads `blueprints`; `blueprintExport`
 * reads the sandboxed document), and live `blueprint.*` events are mirrored for
 * immediate feedback. It NEVER fabricates a document or a "valid" badge: an
 * invalid or unreadable Blueprint is surfaced as `partial` with its real
 * validation errors, and a missing Blueprint is `empty` rather than invented.
 */
import { create } from 'zustand';
import type { Blueprint as BlueprintRecord } from '../types/models';
import type { BlueprintRoot, BlueprintValidationError } from '../types/blueprint';
import { eventBus } from '../services/infra/eventBus';
import { logger } from '../services/infra/logger';
import {
  blueprintGenerate,
  blueprintGenerateDocs,
  blueprintGetLatest,
  blueprintExport,
  type BlueprintDocsDocResult,
  type BlueprintDocsGenerateOptions,
  type BlueprintGenerateArgs
} from '../services/ipc';

/**
 * Honest lifecycle of the loaded Blueprint:
 *   idle     - nothing loaded yet
 *   loading  - a load/generate is in flight
 *   empty    - no Blueprint exists for the scan (never fabricated)
 *   ready    - a valid, readable document is loaded
 *   partial  - metadata exists but the document is invalid/unreadable
 *   error    - the load itself failed
 */
export type BlueprintStatus = 'idle' | 'loading' | 'empty' | 'ready' | 'partial' | 'error';

export interface BlueprintStoreError {
  code: string;
  message: string;
  suggestedAction: string;
}

export interface BlueprintState {
  scanId: string | null;
  status: BlueprintStatus;
  /** The persisted row (metadata + validation), or null. */
  record: BlueprintRecord | null;
  /** The parsed document, or null when unreadable/absent. */
  document: BlueprintRoot | null;
  /** Bounded validation errors (empty when valid). */
  validationErrors: BlueprintValidationError[];
  /** True only when the persisted document passed the full schema. */
  isValid: boolean;
  /** True when the document is invalid/unreadable or evidence was skipped. */
  partial: boolean;
  /** Honest reason the document body could not be read, or null. */
  readError: string | null;
  loading: boolean;
  generating: boolean;
  error: BlueprintStoreError | null;
  /** Generated documentation (empty until a docs run completes). */
  docs: BlueprintDocsDocResult[];
  /** Optional documents intentionally skipped in the last docs run. */
  docsSkipped: Array<{ name: string; title: string; required: boolean }>;
  /** Bounded warnings from the last docs run. */
  docsWarnings: Array<{ doc: string; code: string; message: string }>;
  /** True while a documentation run is in flight. */
  generatingDocs: boolean;
  /** Load the latest persisted Blueprint for a scan (source of truth). */
  loadForScan: (scanId: string | null) => Promise<void>;
  /** Generate (or regenerate) a Blueprint for a scan, then reload. */
  generate: (args: BlueprintGenerateArgs) => Promise<boolean>;
  /** Generate the AI-powered documentation set for the loaded Blueprint. */
  generateDocs: (options?: BlueprintDocsGenerateOptions) => Promise<boolean>;
  /** Export the loaded document as pretty JSON, or null when unreadable. */
  exportJson: () => Promise<string | null>;
  /** Mirror `blueprint.*` events for a scan; returns an unsubscribe. */
  watch: (scanId: string) => () => void;
  clear: () => void;
  reset: () => void;
}

const IDLE_STATE = {
  scanId: null as string | null,
  status: 'idle' as BlueprintStatus,
  record: null as BlueprintRecord | null,
  document: null as BlueprintRoot | null,
  validationErrors: [] as BlueprintValidationError[],
  isValid: false,
  partial: false,
  readError: null as string | null,
  loading: false,
  generating: false,
  error: null as BlueprintStoreError | null,
  docs: [] as BlueprintDocsDocResult[],
  docsSkipped: [] as Array<{ name: string; title: string; required: boolean }>,
  docsWarnings: [] as Array<{ doc: string; code: string; message: string }>,
  generatingDocs: false
};

export const useBlueprintStore = create<BlueprintState>((set, get) => ({
  ...IDLE_STATE,

  loadForScan: async (scanId) => {
    if (!scanId) {
      set({ ...IDLE_STATE, scanId: null });
      return;
    }
    set({ scanId, loading: true, error: null, status: 'loading' });

    const latest = await blueprintGetLatest(scanId);
    // Ignore a late response for a scan the store has already moved past.
    if (get().scanId !== scanId) {
      return;
    }
    if (!latest.ok) {
      logger
        .child('blueprint')
        .warn('Failed to load Blueprint metadata', { scanId, code: latest.error.code });
      set({
        loading: false,
        status: 'error',
        record: null,
        document: null,
        validationErrors: [],
        isValid: false,
        partial: false,
        readError: null,
        error: {
          code: latest.error.code,
          message: latest.error.message,
          suggestedAction: latest.error.suggestedAction
        }
      });
      return;
    }

    if (!latest.data) {
      set({
        loading: false,
        status: 'empty',
        record: null,
        document: null,
        validationErrors: [],
        isValid: false,
        partial: false,
        readError: null,
        error: null
      });
      return;
    }

    const record = latest.data;
    const exported = await blueprintExport(scanId);
    if (get().scanId !== scanId) {
      return;
    }

    const readError = exported.ok
      ? (exported.data?.readError ?? null)
      : 'The Blueprint could not be read.';
    const document = exported.ok ? (exported.data?.document ?? null) : null;
    // A persisted document is only `ready` when it is valid AND readable; an
    // invalid or unreadable one is honestly `partial`, never a false "ready".
    const partial = !record.isValid || readError !== null;

    set({
      loading: false,
      status: partial ? 'partial' : 'ready',
      record,
      document,
      validationErrors: record.validationErrors,
      isValid: record.isValid,
      partial,
      readError,
      error: exported.ok
        ? null
        : {
            code: exported.error.code,
            message: exported.error.message,
            suggestedAction: exported.error.suggestedAction
          }
    });
  },

  generate: async (args) => {
    set({ generating: true, error: null });
    const result = await blueprintGenerate(args);
    if (!result.ok) {
      set({
        generating: false,
        error: {
          code: result.error.code,
          message: result.error.message,
          suggestedAction: result.error.suggestedAction
        }
      });
      return false;
    }
    // Reload from the database so the store reflects exactly what was persisted
    // (never an event-only or in-memory view).
    await get().loadForScan(args.scanId);
    set({ generating: false });
    return true;
  },

  generateDocs: async (options) => {
    const scanId = get().scanId;
    if (!scanId) {
      return false;
    }
    set({ generatingDocs: true, docsWarnings: [], error: null });
    const result = await blueprintGenerateDocs(scanId, options);
    if (!result.ok) {
      set({
        generatingDocs: false,
        error: {
          code: result.error.code,
          message: result.error.message,
          suggestedAction: result.error.suggestedAction
        }
      });
      return false;
    }
    set({
      generatingDocs: false,
      docs: result.data.docs,
      docsSkipped: result.data.skipped,
      docsWarnings: result.data.warnings
    });
    return true;
  },

  exportJson: async () => {
    const scanId = get().scanId;
    if (!scanId) {
      return null;
    }
    // Prefer the already-loaded document (no second disk read when available).
    const loaded = get().document;
    if (loaded) {
      return JSON.stringify(loaded, null, 2);
    }
    const exported = await blueprintExport(scanId);
    if (!exported.ok || !exported.data) {
      return null;
    }
    return exported.data.json;
  },

  watch: (scanId) => {
    const refresh = (): void => {
      if (get().scanId === scanId) {
        void get().loadForScan(scanId);
      }
    };
    const unsubscribers = [
      eventBus.on('blueprint.started', (event) => {
        if ((event.payload as { scanId?: string }).scanId === scanId) {
          set({ status: 'loading', loading: true });
        }
      }),
      eventBus.on('blueprint.generated', refresh),
      eventBus.on('blueprint.validation_failed', refresh),
      eventBus.on('blueprint.completed', refresh)
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  },

  clear: () => set({ ...IDLE_STATE }),

  reset: () => set({ ...IDLE_STATE })
}));
