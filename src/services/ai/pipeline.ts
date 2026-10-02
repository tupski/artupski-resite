/**
 * Generation pipeline - Artupski ReSite
 * Source of truth: docs/specs/AI-SPEC.md section 4.1.
 *
 * Executes a schema-constrained generation task: sanitize + wrap the untrusted
 * payload, guard the token budget, request JSON output, extract JSON, validate
 * with Zod, and run bounded repair passes feeding validation errors back to the
 * model. The pipeline NEVER throws past its boundary - every failure is returned
 * as a discriminated result carrying an `ai`-category `StructuredError`.
 */
import { z } from 'zod';
import type { AIMessage, GenerationTask, IAIProvider } from '../../types/ai';
import type { StructuredError } from '../infra/errors';
import { createAiError } from './errors';
import { buildUserMessageContent } from './payload';
import { TokenBudgetManager } from './tokenBudget';

export type PipelineResult<T> =
  { ok: true; data: T; attempts: number } | { ok: false; error: StructuredError; attempts: number };

/**
 * Extract a JSON value from raw model output. Accepts a bare object/array or a
 * fenced ```json block (AI-SPEC.md section 4.1 "Raw JSON Extraction").
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    return JSON.parse(match[1].trim());
  }
  throw new Error('Unable to extract valid JSON from LLM output');
}

export class GenerationPipeline {
  constructor(
    private readonly aiProvider: IAIProvider,
    private readonly budgetManager: TokenBudgetManager
  ) {}

  async executeTask<T>(task: GenerationTask<T>): Promise<PipelineResult<T>> {
    const userMessageContent = buildUserMessageContent(task.payload);

    if (!this.budgetManager.fitsInContext(task.systemPrompt, userMessageContent)) {
      return {
        ok: false,
        attempts: 0,
        error: createAiError(
          'CONTEXT_LENGTH_EXCEEDED',
          `Task ${task.taskName} exceeds the model token context budget.`
        )
      };
    }

    const messages: AIMessage[] = [
      { role: 'system', content: task.systemPrompt },
      { role: 'user', content: userMessageContent }
    ];

    let attempts = 0;
    let current: string;

    try {
      const first = await this.aiProvider.chatCompletion(messages, {
        responseFormat: 'json_object',
        temperature: 0.0
      });
      current = first.content;
    } catch (error) {
      return {
        ok: false,
        attempts,
        error: asAiError(error, `Generation failed for ${task.taskName}`)
      };
    }

    for (;;) {
      attempts += 1;
      let parsed: z.SafeParseReturnType<unknown, T>;
      let extracted: unknown;
      try {
        extracted = extractJson(current);
        parsed = task.schema.safeParse(extracted);
      } catch (error) {
        return {
          ok: false,
          attempts,
          error: createAiError(
            'MALFORMED_OUTPUT',
            `Unable to parse JSON output for ${task.taskName}.`,
            {
              cause: error
            }
          )
        };
      }

      if (parsed.success) {
        return { ok: true, data: parsed.data, attempts };
      }

      if (attempts > task.maxRepairAttempts) {
        return {
          ok: false,
          attempts,
          error: createAiError(
            'MALFORMED_OUTPUT',
            `Validation failed for ${task.taskName} after ${attempts} attempt(s).`,
            { recoveryHint: 'Retry, or switch to a model with stronger JSON-schema adherence.' }
          )
        };
      }

      const repairPrompt = `The previous JSON response failed schema validation.
Validation Errors:
${JSON.stringify(parsed.error.format(), null, 2)}

Original Invalid Output:
${current}

Instructions:
1. Fix every schema error identified above.
2. Return ONLY valid JSON adhering strictly to the requested schema.`;

      messages.push({ role: 'assistant', content: current });
      messages.push({ role: 'user', content: repairPrompt });

      try {
        const repaired = await this.aiProvider.chatCompletion(messages, {
          responseFormat: 'json_object',
          temperature: 0.0
        });
        current = repaired.content;
      } catch (error) {
        return {
          ok: false,
          attempts,
          error: asAiError(error, `Repair pass failed for ${task.taskName}`)
        };
      }
    }
  }
}

/** Normalize an arbitrary thrown value to an AI-category structured error. */
function asAiError(error: unknown, fallbackMessage: string): StructuredError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    (error as { category?: unknown }).category === 'ai' &&
    'code' in error
  ) {
    return error as StructuredError;
  }
  return createAiError('MALFORMED_OUTPUT', fallbackMessage, { cause: error });
}
