/**
 * Centralized error model - Artupski ReSite
 * Source of truth: docs/architecture/ERROR-HANDLING.md section 2.
 *
 * Every module represents failures through `StructuredError` so that IPC,
 * logging, and the UI can consume a single, predictable shape.
 */

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export type ErrorCategory =
  | 'network'
  | 'browser'
  | 'auth'
  | 'ai'
  | 'blueprint'
  | 'io'
  | 'database'
  | 'process'
  | 'validation'
  | 'ipc';

/** Error codes defined by the failure-mode taxonomy (ERROR-HANDLING.md section 1). */
export type ErrorCode =
  | 'INVALID_URL'
  | 'URL_POLICY_VIOLATION'
  | 'DNS_RESOLUTION_FAILED'
  | 'CONNECTION_TIMED_OUT'
  | 'SSL_CERTIFICATE_INVALID'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'PLAYWRIGHT_CRASHED'
  | 'NAVIGATION_ABORTED'
  | 'EXECUTION_CONTEXT_DESTROYED'
  | 'LOGIN_FAILED'
  | 'SESSION_EXPIRED'
  | 'CAPTCHA_CHALLENGE_BLOCKED'
  | 'API_KEY_INVALID'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'MALFORMED_OUTPUT'
  | 'BLUEPRINT_VALIDATION_FAILED'
  | 'UNSUPPORTED_VERSION'
  | 'DISK_FULL'
  | 'PERMISSION_DENIED'
  | 'SQLITE_BUSY'
  | 'SQLITE_CORRUPT'
  | 'STORAGE_INIT_FAILED'
  | 'STORAGE_NOT_READY'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'USER_CANCELLED'
  | 'SCAN_ALREADY_RUNNING'
  | 'PROCESS_SPAWN_FAILED'
  | 'PROCESS_TIMEOUT'
  | 'PROCESS_EXITED_UNEXPECTEDLY'
  | 'WORKER_PROTOCOL_VIOLATION'
  | 'WORKER_SHUTDOWN_FAILED'
  | 'BROWSER_NOT_INSTALLED'
  | 'CAPTURE_URL_INVALID'
  | 'IPC_ERROR'
  | 'UNKNOWN_ERROR';

export interface StructuredError {
  code: ErrorCode;
  category: ErrorCategory;
  message: string;
  severity: ErrorSeverity;
  recoverable: boolean;
  retryable: boolean;
  retryCount?: number;
  maxRetries?: number;
  details?: Record<string, unknown>;
  stackTrace?: string;
  suggestedAction: string;
  timestamp: string;
}

export interface CreateStructuredErrorInput {
  code: ErrorCode;
  category: ErrorCategory;
  message: string;
  severity?: ErrorSeverity;
  recoverable?: boolean;
  retryable?: boolean;
  details?: Record<string, unknown>;
  suggestedAction?: string;
  cause?: unknown;
}

const DEFAULT_SUGGESTED_ACTION = 'Retry the operation. If the problem persists, check the logs.';

/** Build a fully-populated `StructuredError` with sensible defaults. */
export function createStructuredError(input: CreateStructuredErrorInput): StructuredError {
  const error: StructuredError = {
    code: input.code,
    category: input.category,
    message: input.message,
    severity: input.severity ?? 'error',
    recoverable: input.recoverable ?? true,
    retryable: input.retryable ?? false,
    suggestedAction: input.suggestedAction ?? DEFAULT_SUGGESTED_ACTION,
    timestamp: new Date().toISOString()
  };

  if (input.details !== undefined) {
    error.details = input.details;
  }

  if (input.cause instanceof Error && input.cause.stack !== undefined) {
    error.stackTrace = input.cause.stack;
  }

  return error;
}

/** Narrow an unknown thrown value into a `StructuredError`. */
export function toStructuredError(
  error: unknown,
  fallback: Partial<Omit<CreateStructuredErrorInput, 'message'>> & { message?: string } = {}
): StructuredError {
  if (isStructuredError(error)) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (fallback.message ?? 'An unexpected error occurred.');

  return createStructuredError({
    code: fallback.code ?? 'UNKNOWN_ERROR',
    category: fallback.category ?? 'process',
    message,
    severity: fallback.severity ?? 'error',
    recoverable: fallback.recoverable ?? true,
    retryable: fallback.retryable ?? false,
    suggestedAction: fallback.suggestedAction,
    cause: error
  });
}

/** Type guard for `StructuredError` values crossing process/IPC boundaries. */
export function isStructuredError(value: unknown): value is StructuredError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.severity === 'string' &&
    typeof candidate.timestamp === 'string'
  );
}
