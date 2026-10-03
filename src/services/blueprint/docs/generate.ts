/**
 * Blueprint documentation generator - Artupski ReSite
 *
 * Orchestrates the AI-powered documentation set for a validated Blueprint:
 *
 *   1. validate the Blueprint (an invalid document is refused, never guessed at),
 *   2. build a deterministic plan (7 required docs + relevant/opted-in optionals),
 *   3. for each document, emit a data-derived Markdown skeleton locally, and
 *   4. optionally enrich ONE narrative section with the configured AI provider.
 *
 * Robustness guarantees (task requirements 3 and 4):
 *   - deterministic, data-derived sections (asset tables, token tables, route
 *     lists) are generated locally, so a document is always complete even when
 *     AI is unavailable;
 *   - a per-document AI failure NEVER fails the run: the local skeleton is emitted
 *     and a bounded warning is surfaced;
 *   - the prompt is pre-checked against the model token budget and the AI call is
 *     skipped (with a warning) when it would not fit, so a prompt is never oversized.
 *
 * The module depends only on a `{ generate }` engine seam (the Phase 10
 * `AiEngine` satisfies it structurally); tests inject a scripted engine. It never
 * throws past its boundary and never executes generated content.
 */
import { z } from 'zod';
import { validateBlueprint, type Blueprint } from '../../../types/blueprint';
import type { GenerationTask } from '../../../types/ai';
import type {
  BlueprintDoc,
  BlueprintDocName,
  BlueprintDocsOptions,
  BlueprintDocsResult,
  BlueprintDocsWarning,
  DocNarrative
} from '../../../types/blueprintDocs';
import type { AppEvent } from '../../infra/eventBus';
import { createEvent, eventBus } from '../../infra/eventBus';
import type { PipelineResult } from '../../ai';
import { buildUserMessageContent, createAiEngine, TokenBudgetManager } from '../../ai';
import { planBlueprintDocs, skippedOptionalDocs, DOC_TITLES } from './catalog';
import { buildDocSystemPrompt, projectDocPayload } from './prompt';
import { buildBlueprintDoc } from './templates';

/**
 * The narrow engine seam this generator depends on. The Phase 10 `AiEngine`
 * satisfies it structurally; tests inject a scripted implementation.
 */
export interface BlueprintDocsEngine {
  generate<T>(task: GenerationTask<T>): Promise<PipelineResult<T>>;
}

/** Bounded event sink so the generator stays testable (defaults to eventBus). */
export interface BlueprintDocsEventSink {
  emit(event: AppEvent): void;
}

export interface BlueprintDocsDeps {
  /** AI engine override (tests). Otherwise the live engine is resolved lazily. */
  engine?: BlueprintDocsEngine;
  /** Event sink override (tests). */
  events?: BlueprintDocsEventSink;
}

/**
 * The structured JSON contract the model must return for a narrative. Both
 * fields are required so `z.ZodSchema<T>` input and output types match; a model
 * that omits one is repaired by the pipeline (bounded repair attempts).
 */
export const NarrativeSchema = z.object({
  summary: z.string(),
  notes: z.array(z.string())
});

/** Caps applied to AI narrative output (bounded, never trusted verbatim). */
export const MAX_NARRATIVE_SUMMARY_CHARS = 1200;
export const MAX_NARRATIVE_NOTES = 8;
export const MAX_NARRATIVE_NOTE_CHARS = 240;

/** The task name prefix used for `ai.*` events / logs. */
export const DOC_TASK_PREFIX = 'blueprint.doc';

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Trim/bound a model narrative so it can never dominate a document. */
export function sanitizeNarrative(input: z.infer<typeof NarrativeSchema>): DocNarrative | undefined {
  const summary = input.summary.replace(/\s+/g, ' ').trim().slice(0, MAX_NARRATIVE_SUMMARY_CHARS);
  const notes = input.notes
    .map((note) => note.replace(/\s+/g, ' ').trim())
    .filter((note) => note.length > 0)
    .slice(0, MAX_NARRATIVE_NOTES)
    .map((note) => note.slice(0, MAX_NARRATIVE_NOTE_CHARS));
  if (summary.length === 0 && notes.length === 0) {
    return undefined;
  }
  return { summary, notes };
}

/**
 * Resolve the AI engine to use. An explicitly injected engine always wins. When
 * `useAi` is false no engine is used. The live engine is created lazily and only
 * ever *called* inside a try/catch, so an unconfigured provider degrades to the
 * deterministic document rather than failing the run.
 */
function resolveEngine(deps: BlueprintDocsDeps, useAi: boolean): BlueprintDocsEngine | null {
  if (deps.engine) {
    return deps.engine;
  }
  if (!useAi) {
    return null;
  }
  return createAiEngine();
}

/**
 * Request the AI narrative for one document. Returns `undefined` (never throws)
 * when AI is unavailable, the prompt does not fit the budget, or the model output
 * is invalid; a bounded warning is pushed in every such case.
 */
async function requestNarrative(
  name: BlueprintDocName,
  blueprint: Blueprint,
  engine: BlueprintDocsEngine,
  model: string | undefined,
  warnings: BlueprintDocsWarning[]
): Promise<DocNarrative | undefined> {
  const systemPrompt = buildDocSystemPrompt(name);
  const payload = projectDocPayload(name, blueprint);
  const userContent = buildUserMessageContent(payload);
  const budget = new TokenBudgetManager(model ?? '');
  if (!budget.fitsInContext(systemPrompt, userContent)) {
    warnings.push({
      doc: name,
      code: 'DOC_PROMPT_TOO_LARGE',
      message: `The narrative prompt for ${name} exceeds the model input budget; the deterministic document was emitted.`
    });
    return undefined;
  }

  const task: GenerationTask<z.infer<typeof NarrativeSchema>> = {
    taskName: `${DOC_TASK_PREFIX}.${name}`,
    systemPrompt,
    payload,
    schema: NarrativeSchema,
    maxRepairAttempts: 1
  };

  let result: PipelineResult<z.infer<typeof NarrativeSchema>>;
  try {
    result = await engine.generate(task);
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : '';
    warnings.push({
      doc: name,
      code: 'DOC_AI_UNAVAILABLE',
      message: `AI narrative for ${name} failed${detail}; the deterministic document was emitted.`
    });
    return undefined;
  }

  if (!result.ok) {
    warnings.push({
      doc: name,
      code: result.error.code,
      message: `AI narrative for ${name} was unavailable (${result.error.code}); the deterministic document was emitted.`
    });
    return undefined;
  }

  const narrative = sanitizeNarrative(result.data);
  if (!narrative) {
    warnings.push({
      doc: name,
      code: 'DOC_AI_EMPTY',
      message: `AI returned an empty narrative for ${name}; the deterministic document was emitted.`
    });
  }
  return narrative;
}

/**
 * Generate the blueprint documentation set. Always resolves; a per-document AI
 * failure degrades to the deterministic skeleton with an honest warning.
 */
export async function generateBlueprintDocs(
  blueprint: Blueprint | unknown,
  options: BlueprintDocsOptions = {},
  deps: BlueprintDocsDeps = {}
): Promise<BlueprintDocsResult> {
  const validation = validateBlueprint(blueprint);
  if (!validation.success) {
    return {
      docs: [],
      skipped: [],
      warnings: [
        {
          doc: 'AGENTS.md',
          code: 'BLUEPRINT_VALIDATION_FAILED',
          message: 'The Blueprint document is invalid; no documentation was generated.'
        }
      ]
    };
  }
  const document = validation.data;
  const events = deps.events ?? { emit: (event: AppEvent) => eventBus.emit(event) };
  const useAi = options.useAi !== false;
  const engine = resolveEngine(deps, useAi);
  const plan = planBlueprintDocs(document, options);

  const docs: BlueprintDoc[] = [];
  const warnings: BlueprintDocsWarning[] = [];

  for (const entry of plan) {
    if (options.signal?.aborted) {
      break;
    }
    const docWarnings: BlueprintDocsWarning[] = [];
    let narrative: DocNarrative | undefined;
    if (engine) {
      narrative = await requestNarrative(
        entry.name,
        document,
        engine,
        options.model,
        docWarnings
      );
    }

    const contents = buildBlueprintDoc(entry.name, document, narrative);
    const doc: BlueprintDoc = {
      name: entry.name,
      title: DOC_TITLES[entry.name],
      contents,
      bytes: utf8Bytes(contents),
      source: narrative ? 'ai' : 'deterministic',
      selectionReason: entry.reason,
      warnings: docWarnings.map((warning) => warning.message)
    };
    docs.push(doc);
    warnings.push(...docWarnings);
    events.emit(createEvent('export.doc_generated', { name: entry.name, bytes: doc.bytes }));
  }

  return { docs, warnings, skipped: skippedOptionalDocs(document, options) };
}
