/**
 * Component synthesis orchestrator - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 11) and
 * docs/impl-plan/phase-11-impl-plan.md sections 3-8, 11.
 *
 * Turns a validated Blueprint's component registry + design system into clean
 * React + Tailwind TSX artifacts. It NEITHER talks to a provider directly NOR
 * validates transports itself: it delegates schema-constrained generation to the
 * Phase 10 AI engine (`AiEngine.generate`) and layers Phase 11 concerns on top:
 *
 *   - deterministic, bounded per-component payload projection (chunking),
 *   - the defensive component authoring prompt,
 *   - a Zod output contract + a `componentId` echo cross-check,
 *   - deterministic TSX structure + AI-slop rejection (jsxCleanliness),
 *   - per-component failure isolation and an honest aggregate result.
 *
 * It NEVER throws past its boundary and NEVER executes generated code.
 */
import { z } from 'zod';
import { validateBlueprint } from '../../types/blueprint';
import type { Blueprint, BlueprintComponent } from '../../types/blueprint';
import {
  MAX_COMPONENT_REPAIR_ATTEMPTS,
  MAX_SYNTHESIS_COMPONENTS,
  type ComponentSynthesisOptions,
  type ComponentSynthesisRequest,
  type ComponentSynthesisResult,
  type SynthesizedComponent,
  type SynthesizedComponentFailure
} from '../../types/componentSynth';
import { createEvent, eventBus, type AppEvent } from '../infra/eventBus';
import type { StructuredError } from '../infra/errors';
import type { GenerationTask } from '../../types/ai';
import type { PipelineResult } from '../ai';
import { createAiError } from '../ai/errors';
import { buildComponentSystemPrompt } from '../ai/prompts/componentPrompt';
import { ComponentOutputSchema } from './componentSchema';
import {
  projectComponentPayload,
  toComponentIdentifier,
  type ComponentPayloadSources
} from './componentPayload';
import { evaluateGeneratedComponent } from './jsxCleanliness';

/**
 * The narrow engine seam this orchestrator depends on. `AiEngine` from Phase 10
 * structurally satisfies it; tests inject a scripted implementation. Consumers
 * never import a concrete provider.
 */
export interface ComponentSynthesisEngine {
  generate<T>(task: GenerationTask<T>): Promise<PipelineResult<T>>;
}

/** Bounded event sink so the orchestrator stays testable (defaults to eventBus). */
export interface ComponentSynthesisEventSink {
  emit(event: AppEvent): void;
}

export interface ComponentSynthesizerDeps {
  /** The Phase 10 AI engine (required; injectable for tests). */
  engine: ComponentSynthesisEngine;
  /** Event sink override (tests). */
  events?: ComponentSynthesisEventSink;
}

export interface ComponentSynthesisInput {
  /**
   * Either a validated `Blueprint` or an untrusted JSON value. When a plain
   * object is passed it is validated with the Phase 9 schema first; an invalid
   * document is refused without fabricating anything.
   */
  blueprint: Blueprint | unknown;
  options?: ComponentSynthesisOptions;
  /** Optional observed markup fragments, matched by `componentId`. */
  fragments?: ComponentSynthesisRequest['fragments'];
}

/** The task name `ai.*` events and logs key off. */
export const COMPONENT_SYNTHESIS_TASK = 'component.synthesize';

/**
 * Synthesize components from a Blueprint. Always resolves; per-component failures
 * are isolated and reported honestly.
 */
export async function synthesizeComponents(
  deps: ComponentSynthesizerDeps,
  input: ComponentSynthesisInput
): Promise<ComponentSynthesisResult> {
  const events = deps.events ?? { emit: (event) => eventBus.emit(event) };
  const options = input.options ?? {};

  const validation = resolveBlueprint(input.blueprint);
  if (!validation.ok) {
    return {
      components: [],
      failures: [],
      summary: {
        requested: 0,
        succeeded: 0,
        failed: 0,
        partial: true,
        aborted: false
      }
    };
  }

  const blueprint = validation.blueprint;
  const targets = selectTargets(blueprint.components, options);
  const requested = targets.length;

  events.emit(createEvent('component.started', { requested }));

  const components: SynthesizedComponent[] = [];
  const failures: SynthesizedComponentFailure[] = [];
  const usedNames = new Map<string, number>();
  let aborted = false;

  const byId = new Map(blueprint.components.map((component) => [component.id, component]));
  const fragmentByComponent = new Map(
    (input.fragments ?? []).map((fragment) => [fragment.componentId, fragment.html])
  );

  for (const target of targets) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }

    const desiredName = toComponentIdentifier(target.name, target.id);
    const name = dedupeName(desiredName, usedNames);

    const outcome = await synthesizeOne(deps.engine, {
      blueprint,
      component: target,
      name,
      byId,
      fragment: fragmentByComponent.get(target.id)
    });

    if (outcome.ok) {
      components.push(outcome.component);
      events.emit(
        createEvent('component.generated', {
          componentId: target.id,
          name: outcome.component.name,
          codeLength: outcome.component.code.length
        })
      );
    } else {
      failures.push(outcome.failure);
      events.emit(
        createEvent('component.failed', {
          componentId: outcome.failure.componentId,
          name: outcome.failure.name,
          code: outcome.failure.code,
          message: outcome.failure.message
        })
      );
    }
  }

  const partial = aborted || requested < cappedEligibleCount(blueprint, options);
  events.emit(
    createEvent('component.completed', {
      requested,
      succeeded: components.length,
      failed: failures.length,
      partial
    })
  );

  return {
    components,
    failures,
    summary: {
      requested,
      succeeded: components.length,
      failed: failures.length,
      partial,
      aborted
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Blueprint validation                                                       */
/* -------------------------------------------------------------------------- */

type BlueprintResolution = { ok: true; blueprint: Blueprint } | { ok: false };

/**
 * Validate the Blueprint with the authoritative Phase 9 schema, whether the
 * caller hands us a typed `Blueprint` or an untrusted JSON value. We never
 * synthesize from an unvalidated document, so an incomplete or malformed input
 * is refused rather than partially processed.
 */
function resolveBlueprint(value: Blueprint | unknown): BlueprintResolution {
  const result = validateBlueprint(value);
  return result.success ? { ok: true, blueprint: result.data } : { ok: false };
}

/* -------------------------------------------------------------------------- */
/* Target selection                                                           */
/* -------------------------------------------------------------------------- */

/** Deterministic, capped selection of eligible components (Blueprint order). */
export function selectTargets(
  components: readonly BlueprintComponent[],
  options: ComponentSynthesisOptions
): BlueprintComponent[] {
  const cap = clampLimit(options.maxComponents, MAX_SYNTHESIS_COMPONENTS);
  const filter = options.componentIds ? new Set(options.componentIds) : null;
  const eligible = filter
    ? components.filter((component) => filter.has(component.id))
    : [...components];
  return eligible.slice(0, cap);
}

/** How many components were eligible before the cap was applied. */
function cappedEligibleCount(blueprint: Blueprint, options: ComponentSynthesisOptions): number {
  const filter = options.componentIds ? new Set(options.componentIds) : null;
  return filter
    ? blueprint.components.filter((component) => filter.has(component.id)).length
    : blueprint.components.length;
}

function clampLimit(value: number | undefined, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return max;
  }
  const floored = Math.floor(value);
  if (floored < 1) {
    return 1;
  }
  return Math.min(floored, max);
}

/**
 * Deterministic identifier de-duplication with a stable numeric suffix
 * (`Button`, `Button2`, `Button3`). The suffix avoids `_` so the result still
 * satisfies the PascalCase identifier contract enforced by the output schema.
 */
function dedupeName(name: string, used: Map<string, number>): string {
  const count = used.get(name) ?? 0;
  used.set(name, count + 1);
  return count === 0 ? name : `${name}${count + 1}`;
}

/* -------------------------------------------------------------------------- */
/* Single-component synthesis                                                 */
/* -------------------------------------------------------------------------- */

interface SynthesizeOneArgs {
  blueprint: Blueprint;
  component: BlueprintComponent;
  name: string;
  byId: ReadonlyMap<string, BlueprintComponent>;
  fragment?: string;
}

type SingleOutcome =
  | { ok: true; component: SynthesizedComponent }
  | { ok: false; failure: SynthesizedComponentFailure };

async function synthesizeOne(
  engine: ComponentSynthesisEngine,
  args: SynthesizeOneArgs
): Promise<SingleOutcome> {
  const { blueprint, component, name, byId, fragment } = args;
  const sources: ComponentPayloadSources = {
    designSystem: blueprint.design_system,
    responsiveRules: blueprint.responsive_rules,
    interactions: blueprint.interactions,
    ...(fragment ? { fragment } : {})
  };

  const payload = projectComponentPayload(component, sources, byId);

  const task: GenerationTask<z.infer<typeof ComponentOutputSchema>> = {
    taskName: COMPONENT_SYNTHESIS_TASK,
    systemPrompt: buildComponentSystemPrompt(),
    payload: { ...payload, target_identifier: name },
    schema: ComponentOutputSchema,
    maxRepairAttempts: MAX_COMPONENT_REPAIR_ATTEMPTS
  };

  let result: PipelineResult<z.infer<typeof ComponentOutputSchema>>;
  try {
    result = await engine.generate(task);
  } catch (error) {
    return {
      ok: false,
      failure: toFailure(component, name, asAiError(error, 'Component synthesis failed.'))
    };
  }

  if (!result.ok) {
    return { ok: false, failure: toFailure(component, name, result.error) };
  }

  return finalizeSuccess(component, name, result.data, blueprint.source_url);
}

/** Validate the model's echo + code quality, then produce the artifact. */
function finalizeSuccess(
  component: BlueprintComponent,
  requestedName: string,
  output: z.infer<typeof ComponentOutputSchema>,
  sourceUrl: string
): SingleOutcome {
  if (output.componentId !== component.id) {
    return {
      ok: false,
      failure: toFailure(
        component,
        requestedName,
        createAiError(
          'MALFORMED_OUTPUT',
          'The model returned a componentId that does not match the requested component.'
        )
      )
    };
  }

  const assessment = evaluateGeneratedComponent(output.code, output.name);
  if (!assessment.clean || assessment.optimized === undefined) {
    return {
      ok: false,
      failure: {
        componentId: component.id,
        name: output.name,
        code: 'SLOPPY_OUTPUT',
        message: `Generated component was rejected by the cleanliness gate: ${assessment.violations.join(', ')}.`
      }
    };
  }

  return {
    ok: true,
    component: {
      componentId: component.id,
      name: output.name,
      fileName: sanitizeFileName(output.fileName, output.name),
      code: assessment.optimized,
      category: component.category,
      variantKeys: Object.keys(component.variants).sort(),
      sourceUrl,
      ...(component.confidence !== undefined ? { confidence: component.confidence } : {})
    }
  };
}

/** Strip ASCII control characters without a control-char regex (lint-safe). */
function stripControlChars(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 31 && code !== 127) {
      out += char;
    }
  }
  return out;
}

/** Restrict the model-provided file name to a safe, logical basename. */
export function sanitizeFileName(fileName: string, name: string): string {
  const base = stripControlChars(fileName).split(/[\\/]/).pop() ?? '';
  const cleaned = base.trim();
  if (cleaned === '' || !/\.tsx?$/.test(cleaned)) {
    return `${name}.tsx`;
  }
  return cleaned;
}

function toFailure(
  component: BlueprintComponent,
  name: string,
  error: StructuredError
): SynthesizedComponentFailure {
  return {
    componentId: component.id,
    name,
    code: error.code,
    message: error.message
  };
}

/** Normalize any thrown value to an AI-category structured error. */
function asAiError(error: unknown, fallbackMessage: string): StructuredError {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { category?: unknown }).category === 'ai' &&
    'code' in error
  ) {
    return error as StructuredError;
  }
  return createAiError('MALFORMED_OUTPUT', fallbackMessage, { cause: error });
}
