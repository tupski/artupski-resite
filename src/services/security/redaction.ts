/**
 * Secret redaction helpers - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md sections 8.2 and 12.
 *
 * A thin, dependency-free layer over `redactSecrets`
 * (`src/services/auth/crypto.ts`) so every logging/event/export boundary can
 * scrub secret-looking fields with one call. `scrubSecrets` is a pure,
 * non-mutating recursive copy; `createRedactingSink` wraps an existing
 * `LogSink` so secrets are removed at the console boundary.
 */
import type { LogEntry, LogSink } from '../infra/logger';
import { redactSecrets } from '../auth/crypto';

/** The literal placeholder `redactSecrets` substitutes for secret fields. */
export const REDACTED_PLACEHOLDER = '[redacted]';

/**
 * Return a scrubbed deep copy of `value`.
 *
 * - Arrays and plain objects are traversed recursively.
 * - Object keys matching the secret pattern (cookie/authorization/token/
 *   secret/password/session/bearer) have their value replaced with
 *   `[redacted]`.
 * - Primitive values (including strings) are returned unchanged; scrubbing is
 *   field-name based, so it never corrupts legitimate text.
 * - The input is NEVER mutated.
 */
/**
 * API-key field names that `redactSecrets` (the auth-session pattern) does not
 * already cover. `key` is matched exactly (not as a substring) so legitimate
 * fields such as `keyboard` or `keyCount` are left intact.
 */
const API_KEY_FIELD_PATTERN = /^(api[-_]?key|x[-_]?api[-_]?key|key)$/i;

function scrubApiKeyFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => scrubApiKeyFields(entry));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      result[key] = API_KEY_FIELD_PATTERN.test(key)
        ? REDACTED_PLACEHOLDER
        : scrubApiKeyFields(entry);
    }
    return result;
  }
  return value;
}

/**
 * Return a scrubbed deep copy of `value`.
 *
 * Applies `redactSecrets` (cookie/authorization/token/password/session fields)
 * first, then a supplementary pass for API-key field names (`apiKey`, `key`,
 * `x-api-key`). Arrays and nested objects are traversed recursively; the input
 * is never mutated.
 */
export function scrubSecrets<T>(value: T): T {
  return scrubApiKeyFields(redactSecrets(value)) as T;
}

/**
 * Wrap a `LogSink` so every entry it receives has its metadata and error
 * details scrubbed of secret fields before the wrapped sink sees them.
 *
 * The original entry is not mutated; a scrubbed copy is forwarded. The message
 * and level are preserved verbatim (only structured metadata is field-scrubbed).
 */
export function createRedactingSink(next: LogSink): LogSink {
  return (entry: LogEntry): void => {
    const scrubbed: LogEntry = {
      ...entry,
      ...(entry.metadata !== undefined
        ? { metadata: scrubSecrets(entry.metadata) as Record<string, unknown> }
        : {}),
      ...(entry.error !== undefined ? { error: scrubSecrets(entry.error) } : {})
    };
    next(scrubbed);
  };
}
