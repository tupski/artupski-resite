/**
 * Blueprint validation wrapper - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 9 and
 * docs/specs/BLUEPRINT-SPEC.md section 4.
 *
 * Runs the FULL `validateBlueprint` (Zod) on an assembled document and returns
 * bounded, actionable results. A document is never reported as valid unless the
 * complete schema accepts it - there is no partial/permissive parsing here.
 */
import {
  validateBlueprint,
  type Blueprint,
  type BlueprintValidationError
} from '../../types/blueprint';

/** Maximum number of validation errors surfaced (the rest are summarized). */
export const MAX_REPORTED_ERRORS = 100;

export interface ValidationOutcome {
  valid: boolean;
  errors: BlueprintValidationError[];
  /** True when more errors existed than `MAX_REPORTED_ERRORS`. */
  truncated: boolean;
  /** The parsed document when valid, otherwise null. */
  data: Blueprint | null;
}

/**
 * Validate an assembled Blueprint document. Never throws: an unexpected schema
 * failure becomes an actionable validation error rather than an exception.
 */
export function validateAssembledBlueprint(input: unknown): ValidationOutcome {
  let result: ReturnType<typeof validateBlueprint>;
  try {
    result = validateBlueprint(input);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          code: 'BLUEPRINT_VALIDATION_FAILED',
          path: '(root)',
          message: `Validation threw unexpectedly: ${String(error)}`
        }
      ],
      truncated: false,
      data: null
    };
  }

  if (result.success) {
    return { valid: true, errors: [], truncated: false, data: result.data };
  }

  const truncated = result.errors.length > MAX_REPORTED_ERRORS;
  return {
    valid: false,
    errors: result.errors.slice(0, MAX_REPORTED_ERRORS),
    truncated,
    data: null
  };
}
