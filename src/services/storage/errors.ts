/**
 * Storage error codes and helpers - Artupski ReSite
 *
 * Storage failures are represented through the shared `StructuredError` model.
 * The codes below extend `ErrorCode` in `src/services/infra/errors.ts` and are
 * documented in docs/architecture/ERROR-HANDLING.md.
 */
import { createStructuredError, toStructuredError, type StructuredError } from '../infra/errors';

export type StorageErrorCode =
  | 'STORAGE_INIT_FAILED'
  | 'STORAGE_NOT_READY'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'SQLITE_BUSY'
  | 'SQLITE_CORRUPT';

export interface StorageErrorContext {
  message?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

const SUGGESTED_ACTION: Record<StorageErrorCode, string> = {
  STORAGE_INIT_FAILED: 'Restart the application. If the problem persists, inspect the storage logs.',
  STORAGE_NOT_READY: 'Wait for local storage to finish initializing, then retry.',
  STORAGE_READ_FAILED: 'Retry the read. If the problem persists, the local database may need repair.',
  STORAGE_WRITE_FAILED: 'Retry the write. Check that the application data directory is writable.',
  MIGRATION_FAILED: 'The database schema could not be updated. Inspect the migration logs for the failing version.',
  MIGRATION_CHECKSUM_MISMATCH:
    'An applied migration no longer matches its recorded checksum. Do not continue; restore the database from backup.',
  SQLITE_BUSY: 'The database is locked by another operation. Retry shortly.',
  SQLITE_CORRUPT: 'The local database appears corrupted and must be restored from backup.'
};

/** Build a structured storage error with the correct category and defaults. */
export function createStorageError(
  code: StorageErrorCode,
  context: StorageErrorContext = {}
): StructuredError {
  const retryable = code === 'STORAGE_READ_FAILED' || code === 'STORAGE_WRITE_FAILED' || code === 'SQLITE_BUSY';
  return createStructuredError({
    code,
    category: 'database',
    message: context.message ?? `Storage operation failed (${code}).`,
    severity: code === 'MIGRATION_CHECKSUM_MISMATCH' || code === 'SQLITE_CORRUPT' ? 'fatal' : 'error',
    recoverable: code !== 'MIGRATION_CHECKSUM_MISMATCH' && code !== 'SQLITE_CORRUPT',
    retryable,
    details: context.details,
    suggestedAction: SUGGESTED_ACTION[code],
    cause: context.cause
  });
}

/** Normalize an unknown thrown value into a structured storage error. */
export function toStorageError(code: StorageErrorCode, cause: unknown): StructuredError {
  return toStructuredError(cause, {
    code,
    category: 'database',
    message: `Storage operation failed (${code}).`,
    severity: 'error',
    recoverable: true,
    retryable: code === 'STORAGE_READ_FAILED' || code === 'STORAGE_WRITE_FAILED'
  });
}
