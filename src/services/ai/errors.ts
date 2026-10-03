/**
 * AI error mapping - Artupski ReSite
 * Source of truth: docs/architecture/ERROR-HANDLING.md section 1 (`AI_` codes)
 * and docs/impl-plan/phase-10-impl-plan.md sections 7-8.
 *
 * Every transport/HTTP/parse failure in the AI engine is normalized to a
 * `StructuredError` in the reserved `ai` category so the UI, logger, and future
 * IPC boundary consume one predictable shape. Secrets are never included.
 */
import { createStructuredError, type ErrorCode, type StructuredError } from '../infra/errors';

/** Default, actionable guidance per AI error code. */
const SUGGESTED_ACTIONS: Partial<Record<ErrorCode, string>> = {
  API_KEY_INVALID: 'Check the API key in Settings and verify it is active for this endpoint.',
  RATE_LIMIT_EXCEEDED: 'Wait for the provider rate limit to reset, then retry.',
  CONTEXT_LENGTH_EXCEEDED:
    'Reduce the payload size or select a model with a larger context window.',
  MALFORMED_OUTPUT: 'Retry; if it persists, choose a model that supports JSON output mode.',
  IPC_ERROR:
    'Check the endpoint URL and that the provider service is reachable. If the message ' +
    'mentions "Illegal invocation", it is a client-side fetch binding bug - not the endpoint.'
};

/** Build an AI-category structured error with a code-appropriate suggestion. */
export function createAiError(
  code: ErrorCode,
  message: string,
  options: { retryable?: boolean; recoveryHint?: string; cause?: unknown } = {}
): StructuredError {
  const suggestedAction =
    options.recoveryHint ?? SUGGESTED_ACTIONS[code] ?? 'Retry the AI request.';

  return createStructuredError({
    code,
    category: 'ai',
    message,
    severity: 'error',
    recoverable: true,
    retryable: options.retryable ?? (code === 'RATE_LIMIT_EXCEEDED' || code === 'IPC_ERROR'),
    suggestedAction,
    ...(options.cause !== undefined ? { cause: options.cause } : {})
  });
}

/** True when an object looks like an AI-category structured error. */
export function isAiError(value: unknown): value is StructuredError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { category?: unknown }).category === 'ai' &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}
