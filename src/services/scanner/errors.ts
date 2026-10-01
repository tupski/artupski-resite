/**
 * Scanner (crawler) error helpers - Artupski ReSite
 * Source of truth: docs/architecture/ERROR-HANDLING.md section 1.
 *
 * Phase 4 introduces crawler-specific failure codes on top of the shared
 * `StructuredError` model. This is the single factory so every scanner error
 * has a consistent category, severity, and suggested action.
 */
import { createStructuredError, isStructuredError, type StructuredError } from '../infra/errors';

export type ScannerErrorCode =
  | 'INVALID_URL'
  | 'URL_POLICY_VIOLATION'
  | 'DNS_RESOLUTION_FAILED'
  | 'CONNECTION_TIMED_OUT'
  | 'NAVIGATION_ABORTED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'USER_CANCELLED'
  | 'SCAN_ALREADY_RUNNING';

export interface ScannerErrorContext {
  message?: string;
  details?: Record<string, unknown>;
  /** Override the default suggested action for this code. */
  suggestedAction?: string;
  cause?: unknown;
}

const SUGGESTED_ACTION: Record<ScannerErrorCode, string> = {
  INVALID_URL: 'Enter a valid http(s) URL and retry the scan.',
  URL_POLICY_VIOLATION:
    'The target is outside the crawler access policy (private, loopback, link-local, or metadata address). Choose a public target.',
  DNS_RESOLUTION_FAILED: 'Check the hostname and network connection, then retry.',
  CONNECTION_TIMED_OUT: 'The site did not respond in time. Retry or increase the navigation timeout.',
  NAVIGATION_ABORTED: 'The navigation was blocked or entered a redirect loop. Verify the target URL.',
  UNSUPPORTED_CONTENT_TYPE: 'The target is not an HTML page and cannot be extracted.',
  USER_CANCELLED: 'The scan was cancelled.',
  SCAN_ALREADY_RUNNING: 'A scan is already running. Wait for it to finish or cancel it before starting another.'
};

/** Build a structured scanner error with the correct category and defaults. */
export function createScannerError(code: ScannerErrorCode, context: ScannerErrorContext = {}): StructuredError {
  const category = code === 'USER_CANCELLED' || code === 'SCAN_ALREADY_RUNNING' ? 'process' : 'network';
  const retryable = code === 'CONNECTION_TIMED_OUT' || code === 'DNS_RESOLUTION_FAILED';
  return createStructuredError({
    code,
    category,
    message: context.message ?? `Scanner operation failed (${code}).`,
    severity: 'error',
    recoverable: code !== 'URL_POLICY_VIOLATION',
    retryable,
    details: context.details,
    suggestedAction: context.suggestedAction ?? SUGGESTED_ACTION[code],
    cause: context.cause
  });
}

/** Map a worker-thrown error code onto a scanner error, defensively. */
export function toScannerError(error: unknown): StructuredError {
  // A structured error from the process/worker layer is already correct.
  if (isStructuredError(error)) {
    return error;
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? (error.code as string)
      : 'UNKNOWN_ERROR';
  const message = error instanceof Error ? error.message : 'Scanner operation failed.';
  const known: ScannerErrorCode[] = [
    'INVALID_URL',
    'URL_POLICY_VIOLATION',
    'DNS_RESOLUTION_FAILED',
    'CONNECTION_TIMED_OUT',
    'NAVIGATION_ABORTED',
    'UNSUPPORTED_CONTENT_TYPE',
    'USER_CANCELLED'
  ];
  if ((known as string[]).includes(code)) {
    return createScannerError(code as ScannerErrorCode, { message, cause: error });
  }
  return createStructuredError({
    code: 'UNKNOWN_ERROR',
    category: 'network',
    message,
    severity: 'error',
    recoverable: true,
    retryable: false,
    suggestedAction: 'Retry the scan; if the problem persists, check the logs.',
    cause: error
  });
}
