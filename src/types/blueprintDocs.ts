/**
 * AI-powered blueprint documentation contracts - Artupski ReSite
 * Source of truth: docs/specs/BLUEPRINT-SPEC.md (blueprint evidence) and
 * docs/specs/AI-SPEC.md (AI usage contract). No task explicitly reserved a
 * phase for this feature; the decisions taken here are documented in
 * `src/services/blueprint/docs/README-DECISIONS.md`.
 *
 * The blueprint documentation set has two tiers:
 *   - REQUIRED (always generated): AGENTS.md, PRD.md, ARCHITECTURE.md, PLAN.md,
 *     UI-SPEC.md, ASSETS.md, and (recommended, on by default) TESTING.md.
 *   - OPTIONAL (generated when the scan data indicates relevance and/or the user
 *     explicitly opts in): DATABASE.md, API.md, SECURITY.md, DEPLOYMENT.md.
 *
 * Every document is a deterministic, data-derived skeleton populated with real
 * Blueprint values. Narrative prose sections MAY be enriched by the configured
 * AI provider; when AI is unavailable the deterministic document is emitted
 * unchanged and a warning is surfaced (graceful degradation).
 */

/* -------------------------------------------------------------------------- */
/* Document identity                                                          */
/* -------------------------------------------------------------------------- */

/** Documents generated for every blueprint. */
export type RequiredDocName =
  | 'AGENTS.md'
  | 'PRD.md'
  | 'ARCHITECTURE.md'
  | 'PLAN.md'
  | 'UI-SPEC.md'
  | 'ASSETS.md'
  | 'TESTING.md';

/** Documents generated only when relevant and/or explicitly requested. */
export type OptionalDocName = 'DATABASE.md' | 'API.md' | 'SECURITY.md' | 'DEPLOYMENT.md';

export type BlueprintDocName = RequiredDocName | OptionalDocName;

/** Every required document, in deterministic generation order. */
export const REQUIRED_DOC_NAMES: readonly RequiredDocName[] = [
  'AGENTS.md',
  'PRD.md',
  'ARCHITECTURE.md',
  'PLAN.md',
  'UI-SPEC.md',
  'ASSETS.md',
  'TESTING.md'
];

/** Every optional document, in deterministic generation order. */
export const OPTIONAL_DOC_NAMES: readonly OptionalDocName[] = [
  'DATABASE.md',
  'API.md',
  'SECURITY.md',
  'DEPLOYMENT.md'
];

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

/** Why a document is part of the plan. */
export type DocSelectionReason = 'required' | 'relevant' | 'opted_in';

/** One planned document (no content; used by the UI to preview the set). */
export interface DocPlanEntry {
  name: BlueprintDocName;
  /** Human title (without the `.md` suffix). */
  title: string;
  required: boolean;
  reason: DocSelectionReason;
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

/** Whether a document's narrative sections came from AI or the local skeleton. */
export type DocContentSource = 'deterministic' | 'ai';

/** Narrative prose the AI may contribute to a document. */
export interface DocNarrative {
  /** A short, grounded summary paragraph. */
  summary: string;
  /** Bounded, grounded bullet notes. */
  notes: string[];
}

/** One generated document. */
export interface BlueprintDoc {
  name: BlueprintDocName;
  title: string;
  contents: string;
  /** UTF-8 byte length of `contents`. */
  bytes: number;
  /** `ai` when an AI narrative section was merged; otherwise `deterministic`. */
  source: DocContentSource;
  selectionReason: DocSelectionReason;
  /** Bounded, non-fatal warnings recorded while generating this document. */
  warnings: string[];
}

/** A bounded, honest warning about one document. */
export interface BlueprintDocsWarning {
  doc: BlueprintDocName;
  code: string;
  message: string;
}

/** Result of a blueprint documentation run. Always returned; never thrown. */
export interface BlueprintDocsResult {
  docs: BlueprintDoc[];
  warnings: BlueprintDocsWarning[];
  /** Optional documents intentionally not generated, with the plan reason. */
  skipped: DocPlanEntry[];
}

/**
 * Opt-in/opt-out toggles for optional documents plus AI controls. All fields
 * are optional so the default plan is deterministic and relevance-driven.
 */
export interface BlueprintDocsOptions {
  /**
   * Force-include (`true`) or suppress (`false`) an optional document regardless
   * of detected relevance.
   */
  include?: Partial<Record<OptionalDocName, boolean>>;
  /** Suppress an optional document even when relevance is detected. */
  exclude?: readonly OptionalDocName[];
  /** Include TESTING.md (recommended). Defaults to `true`. */
  includeTesting?: boolean;
  /** Use the configured AI provider for narrative sections. Defaults to `true`. */
  useAi?: boolean;
  /** Override the model used for the token-budget pre-check (tests). */
  model?: string;
  /** Abort the run before further documents are generated. */
  signal?: AbortSignal;
}
