/**
 * OS keychain service - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md sections 8.1 and 9,
 * docs/security/SECURITY.md section 2.1.
 *
 * The single TypeScript boundary over the native `secret_*` commands. It never
 * throws: every operation returns a discriminated result, and the secret value
 * is never logged, emitted, or included in an error. When no OS secret store is
 * available the module fails closed (the caller must not fall back to
 * plaintext).
 *
 * The account is a provider slug; it is validated client-side against the same
 * `^[a-z0-9_-]{1,64}$` rule the Rust boundary enforces, so an invalid value is
 * rejected before any IPC round-trip.
 */
import { createStructuredError, type StructuredError } from '../infra/errors';
import { createEvent, eventBus } from '../infra/eventBus';
import { secretAvailable as ipcSecretAvailable, secretDelete, secretGet, secretSet } from '../ipc';

/** Identifies a secret within the fixed application service. */
export interface SecretRef {
  /** Account within the app service, e.g. a provider slug (`openai`). */
  readonly account: string;
}

/** Discriminated read result. `value` is `null` when no entry exists. */
export type SecretResult =
  | { ok: true; value: string | null }
  | { ok: false; error: StructuredError };

/** Discriminated write/delete result. */
export type SecretMutationResult = { ok: boolean; error?: StructuredError };

/** Account slug rule, mirrored from the Rust boundary (`secret.rs`). */
const ACCOUNT_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** True when `account` is a valid, bounded secret account slug. */
export function isValidSecretAccount(account: string): boolean {
  return ACCOUNT_PATTERN.test(account);
}

function createSecretError(code: 'SECRET_STORAGE_UNAVAILABLE' | 'SECRET_READ_FAILED' | 'SECRET_WRITE_FAILED', message: string, cause?: unknown): StructuredError {
  const suggestedAction =
    code === 'SECRET_STORAGE_UNAVAILABLE'
      ? 'Install or unlock an OS credential store (Windows Credential Manager, macOS Keychain, or a running Secret Service on Linux), then retry.'
      : code === 'SECRET_READ_FAILED'
        ? 'Retry reading the key. If it keeps failing, re-enter the key in Settings.'
        : 'Retry saving the key. If it keeps failing, the OS credential store may be unavailable.';

  return createStructuredError({
    code,
    category: 'io',
    message,
    severity: code === 'SECRET_STORAGE_UNAVAILABLE' ? 'warning' : 'error',
    recoverable: true,
    retryable: code !== 'SECRET_STORAGE_UNAVAILABLE',
    suggestedAction,
    ...(cause !== undefined ? { cause } : {})
  });
}

/** Emit a bounded `security.key_unavailable` event (id + code only). */
function emitUnavailable(providerId: string, code: string): void {
  eventBus.emit(createEvent('security.key_unavailable', { providerId, code }));
}

/**
 * True when an OS secret store is usable in this environment. A transport
 * failure is reported as `false` (fail closed) rather than thrown.
 */
export async function secretAvailable(): Promise<boolean> {
  const result = await ipcSecretAvailable();
  return result.ok ? result.data : false;
}

/**
 * Read a secret; `null` when absent. Never logs the value.
 *
 * An invalid account slug or an unavailable store yields a structured failure
 * (`SECRET_READ_FAILED` / `SECRET_STORAGE_UNAVAILABLE`).
 */
export async function getSecret(account: string): Promise<SecretResult> {
  if (!isValidSecretAccount(account)) {
    return {
      ok: false,
      error: createSecretError(
        'SECRET_READ_FAILED',
        `Invalid secret account "${account}": expected [a-z0-9_-]{1,64}.`
      )
    };
  }

  const result = await secretGet(account);
  if (result.ok) {
    return { ok: true, value: result.data };
  }

  const unavailable = result.error.code === 'SECRET_STORAGE_UNAVAILABLE';
  emitUnavailable(account, result.error.code);
  return {
    ok: false,
    error: unavailable
      ? createSecretError('SECRET_STORAGE_UNAVAILABLE', 'The OS credential store is unavailable.', result.error)
      : createSecretError('SECRET_READ_FAILED', 'Failed to read the secret.', result.error)
  };
}

/**
 * Write/replace a secret. An empty value deletes it. On success emits a bounded
 * `security.key_stored` event (provider id only - never the value).
 */
export async function setSecret(account: string, value: string): Promise<SecretMutationResult> {
  if (!isValidSecretAccount(account)) {
    return {
      ok: false,
      error: createSecretError(
        'SECRET_WRITE_FAILED',
        `Invalid secret account "${account}": expected [a-z0-9_-]{1,64}.`
      )
    };
  }

  const result = await secretSet(account, value);
  if (!result.ok) {
    const unavailable = result.error.code === 'SECRET_STORAGE_UNAVAILABLE';
    emitUnavailable(account, result.error.code);
    return {
      ok: false,
      error: unavailable
        ? createSecretError('SECRET_STORAGE_UNAVAILABLE', 'The OS credential store is unavailable.', result.error)
        : createSecretError('SECRET_WRITE_FAILED', 'Failed to write the secret.', result.error)
    };
  }

  eventBus.emit(createEvent('security.key_stored', { providerId: account }));
  return { ok: true };
}

/**
 * Delete a secret; a missing entry is success. On success emits a bounded
 * `security.key_revoked` event (provider id + `removed` only).
 */
export async function deleteSecret(account: string): Promise<SecretMutationResult> {
  if (!isValidSecretAccount(account)) {
    return {
      ok: false,
      error: createSecretError(
        'SECRET_WRITE_FAILED',
        `Invalid secret account "${account}": expected [a-z0-9_-]{1,64}.`
      )
    };
  }

  const result = await secretDelete(account);
  if (!result.ok) {
    const unavailable = result.error.code === 'SECRET_STORAGE_UNAVAILABLE';
    emitUnavailable(account, result.error.code);
    return {
      ok: false,
      error: unavailable
        ? createSecretError('SECRET_STORAGE_UNAVAILABLE', 'The OS credential store is unavailable.', result.error)
        : createSecretError('SECRET_WRITE_FAILED', 'Failed to delete the secret.', result.error)
    };
  }

  eventBus.emit(createEvent('security.key_revoked', { providerId: account, removed: true }));
  return { ok: true };
}
