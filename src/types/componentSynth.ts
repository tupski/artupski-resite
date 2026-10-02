/**
 * Component synthesis type contracts - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 11) and
 * docs/impl-plan/phase-11-impl-plan.md sections 3-8. The AI engine contracts
 * themselves live in `src/types/ai.ts` (Phase 10) and are reused unchanged.
 *
 * These are the ONLY public Phase 11 shapes a caller sees. They are deliberately
 * small: a request (Blueprint evidence in, options), an honest per-component
 * outcome, and an aggregate result that always carries both successes and
 * bounded failures. No persistence or UI shape is declared here.
 */
import type { BlueprintComponent, BlueprintDesignSystem } from './blueprint';

/** Hard cap on how many components a single synthesis run will attempt. */
export const MAX_SYNTHESIS_COMPONENTS = 50;
/** Hard cap on generated code length per component (chars); oversized → failure. */
export const MAX_COMPONENT_CODE_CHARS = 20_000;
/** Hard cap on bounded repair passes issued per component by the pipeline. */
export const MAX_COMPONENT_REPAIR_ATTEMPTS = 1;
/** Hard cap on balanced-brace nesting accepted in generated code. */
export const MAX_TSX_BRACE_DEPTH = 40;

/** A caller-provided observed markup fragment to ground a component's JSX. */
export interface ComponentFragment {
  /** The Blueprint component id this fragment belongs to. */
  componentId: string;
  /** Observed HTML/JSX source for the component (untrusted; wrapped as data). */
  html: string;
}

/**
 * Options for a component synthesis run. Every field is optional so the default
 * behavior is deterministic; the caller opts into non-defaults explicitly.
 */
export interface ComponentSynthesisOptions {
  /** Bounded repair passes per component (default `MAX_COMPONENT_REPAIR_ATTEMPTS`). */
  maxRepairAttempts?: number;
  /** Cap on attempted components this run (default `MAX_SYNTHESIS_COMPONENTS`). */
  maxComponents?: number;
  /**
   * Restrict synthesis to these component ids (order-insensitive). When omitted,
   * every Blueprint component is eligible, in Blueprint order.
   */
  componentIds?: readonly string[];
  /** Abort the remaining components once this signal is aborted. */
  signal?: AbortSignal;
}

/** The untrusted, already-validated Blueprint evidence a run consumes. */
export interface ComponentSynthesisRequest {
  components: readonly BlueprintComponent[];
  designSystem: BlueprintDesignSystem;
  /** Optional observed markup fragments, matched by `componentId`. */
  fragments?: readonly ComponentFragment[];
  /** The Blueprint `source_url`, echoed into artifacts for traceability. */
  sourceUrl?: string;
  options?: ComponentSynthesisOptions;
  /** Optional project id for event correlation only; never persisted. */
  projectId?: string;
}

/** A successfully synthesized, cleaned component artifact. */
export interface SynthesizedComponent {
  /** The source Blueprint component id (traceability to evidence). */
  componentId: string;
  /** PascalCase React identifier for the generated component. */
  name: string;
  /** Logical target file name (e.g. `Button.tsx`) - not a filesystem path. */
  fileName: string;
  /** Cleaned TSX source. Never executed by Phase 11. */
  code: string;
  /** The source component's Blueprint category (observed/inferred preserved upstream). */
  category: BlueprintComponent['category'];
  /** Variant keys carried verbatim from the Blueprint (evidence-grounded). */
  variantKeys: string[];
  /** The Blueprint `source_url` when provided. */
  sourceUrl?: string;
  /** Optional inferred-classification confidence from the Blueprint (C8). */
  confidence?: number;
}

/** An honest, non-fatal per-component failure. */
export interface SynthesizedComponentFailure {
  componentId: string;
  name: string;
  /** Structured code (AI/blueprint category), never containing secrets or code. */
  code: string;
  message: string;
}

export interface ComponentSynthesisSummary {
  requested: number;
  succeeded: number;
  failed: number;
  /** True when the run stopped early (cap, abort, or engine session end). */
  partial: boolean;
  /** True when the caller's abort signal ended the run. */
  aborted: boolean;
}

export interface ComponentSynthesisResult {
  components: SynthesizedComponent[];
  failures: SynthesizedComponentFailure[];
  summary: ComponentSynthesisSummary;
}
