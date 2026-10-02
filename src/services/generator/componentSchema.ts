/**
 * Component synthesis output contract - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-11-impl-plan.md section 7. The model
 * returns STRUCTURED JSON (never a fenced code block or prose) so the Phase 10
 * pipeline can validate it with Zod and run bounded repair on failure.
 *
 * Structural validation only. Code QUALITY is judged separately by the
 * deterministic `jsxCleanliness` optimizer; a schema-valid result is never
 * assumed correct.
 */
import { z } from 'zod';
import { MAX_COMPONENT_CODE_CHARS } from '../../types/componentSynth';

/** PascalCase React identifier (letters/digits, capital first, no separators). */
export const COMPONENT_IDENTIFIER_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

export const ComponentOutputSchema = z
  .object({
    componentId: z.string().min(1),
    name: z.string().regex(COMPONENT_IDENTIFIER_PATTERN, 'name must be a PascalCase identifier'),
    fileName: z.string().min(1),
    code: z
      .string()
      .min(1)
      .max(MAX_COMPONENT_CODE_CHARS, 'generated code exceeds the maximum allowed length')
  })
  .strict();

export type ComponentOutput = z.infer<typeof ComponentOutputSchema>;
