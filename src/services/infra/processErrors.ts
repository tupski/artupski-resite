/**
 * Process / worker error codes and helpers - Artupski ReSite
 *
 * Phase 3 introduces the child-process boundary (ProcessManager + Playwright
 * worker). Failures are represented through the shared `StructuredError` model
 * exactly like the storage layer; this module is the single factory so every
 * process error has consistent category, severity, and suggested action.
 *
 * Source of truth: docs/architecture/ERROR-HANDLING.md section 1.
 */
// NOTE: the `.ts` extension is required so the dedicated Node worker (which runs
// these files via Node's native type stripping) can resolve the import chain.
import { createStructuredError, type StructuredError } from './errors.ts';

export type ProcessErrorCode =
  | 'PROCESS_SPAWN_FAILED'
  | 'PROCESS_TIMEOUT'
  | 'PROCESS_EXITED_UNEXPECTEDLY'
  | 'WORKER_PROTOCOL_VIOLATION'
  | 'WORKER_SHUTDOWN_FAILED'
  | 'BROWSER_NOT_INSTALLED'
  | 'PLAYWRIGHT_CRASHED'
  | 'CAPTURE_URL_INVALID'
  | 'USER_CANCELLED';

export interface ProcessErrorContext {
  message?: string;
  details?: Record<string, unknown>;
  /** Override the default suggested action for this code. */
  suggestedAction?: string;
  cause?: unknown;
}

const SUGGESTED_ACTION: Record<ProcessErrorCode, string> = {
  PROCESS_SPAWN_FAILED:
    'Verify the Node.js runtime is installed and on PATH, then retry starting the worker.',
  PROCESS_TIMEOUT:
    'The worker did not respond within the timeout. Increase the timeout or retry the operation.',
  PROCESS_EXITED_UNEXPECTEDLY:
    'The worker process exited on its own. Restart it; if the problem persists, inspect the worker logs.',
  WORKER_PROTOCOL_VIOLATION:
    'The worker sent a malformed or unsupported message. Restart the worker; a version mismatch is the likely cause.',
  WORKER_SHUTDOWN_FAILED:
    'The worker did not stop within the grace period and was force-terminated. Restart the application if a process lingers.',
  BROWSER_NOT_INSTALLED:
    'Install the browser runtime with `npx playwright install chromium`, then retry.',
  PLAYWRIGHT_CRASHED:
    'The browser process terminated abnormally. Retry; if it recurs, check available memory.',
  CAPTURE_URL_INVALID:
    'Enter a valid http(s) URL for the page you sign in on, then retry the capture.',
  USER_CANCELLED: 'The operation was cancelled by the user.'
};

/** Build a structured process error with the correct category and defaults. */
export function createProcessError(
  code: ProcessErrorCode,
  context: ProcessErrorContext = {}
): StructuredError {
  const retryable =
    code === 'PROCESS_SPAWN_FAILED' ||
    code === 'PROCESS_TIMEOUT' ||
    code === 'BROWSER_NOT_INSTALLED' ||
    code === 'PLAYWRIGHT_CRASHED';

  const category =
    code === 'BROWSER_NOT_INSTALLED' || code === 'PLAYWRIGHT_CRASHED' ? 'browser' : 'process';

  return createStructuredError({
    code,
    category,
    message: context.message ?? `Process operation failed (${code}).`,
    severity: code === 'WORKER_PROTOCOL_VIOLATION' ? 'fatal' : 'error',
    recoverable: code !== 'WORKER_PROTOCOL_VIOLATION',
    retryable,
    details: context.details,
    suggestedAction: context.suggestedAction ?? SUGGESTED_ACTION[code],
    cause: context.cause
  });
}

/** Type guard for the process-specific codes. */
export function isProcessErrorCode(value: unknown): value is ProcessErrorCode {
  return typeof value === 'string' && value in SUGGESTED_ACTION;
}
