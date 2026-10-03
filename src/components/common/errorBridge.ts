/**
 * Error bridge - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md sections 5 (S6), 8.4, 11 and 13.
 *
 * Turns low-level failures into bounded, scrubbed user notices so a background
 * worker crash or an unhandled global exception is *visible* without ever taking
 * the render tree down. It is deliberately the ONLY place that touches
 * `window.error` / `window.unhandledrejection`: the handlers never rethrow and
 * never render a raw stack.
 *
 * `startErrorBridge()` is idempotent and returns a cleanup function.
 */
import { eventBus } from '../../services/infra/eventBus';
import {
  createStructuredError,
  toStructuredError,
  type ErrorCode,
  type StructuredError
} from '../../services/infra/errors';
import { logger } from '../../services/infra/logger';
import { useUiStore } from '../../stores/uiStore';

/**
 * Scrub secret-looking substrings out of a free-text message and collapse it to
 * a single line (never a stack trace). Field-name based `redactSecrets` cannot
 * help here because the material lives inside prose, so a small, explicit set of
 * value patterns is applied instead.
 */
const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  // Provider-style opaque keys (e.g. `sk-...`).
  [/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[redacted]'],
  // `Bearer <token>` authorization values.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  // `key=value` / `key: value` pairs for common secret field names.
  [
    /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pwd|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi,
    '$1[redacted]'
  ]
];

/** Return the first line of `message` with secret-looking substrings redacted. */
export function scrubErrorMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  let scrubbed = firstLine;
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  const trimmed = scrubbed.trim();
  return trimmed.length > 0 ? trimmed : 'An unexpected error occurred.';
}

/**
 * Push a `StructuredError` as an actionable danger notice with its message
 * scrubbed. Exposed so any caller can route a structured failure through the
 * same bridge the global handlers use.
 */
export function notifyStructuredError(error: StructuredError): void {
  useUiStore.getState().pushErrorNotice({
    ...error,
    message: scrubErrorMessage(error.message)
  });
}

let activeStop: (() => void) | null = null;

/**
 * Subscribe to worker failures and install the global `error` /
 * `unhandledrejection` guards. Idempotent: a second call returns the existing
 * cleanup without registering duplicate listeners.
 */
export function startErrorBridge(): () => void {
  if (activeStop) {
    return activeStop;
  }

  const disposers: Array<() => void> = [];

  // An unexpected worker exit is a warning with a retry affordance; a reported
  // process failure is a danger notice. Neither ever rethrows.
  disposers.push(
    eventBus.on('process.exited', (event) => {
      if (!event.payload.unexpected) {
        return;
      }
      try {
        useUiStore.getState().pushNotice({
          tone: 'warning',
          message: `The "${event.payload.processName}" worker stopped unexpectedly.`,
          action: { label: 'Try again', kind: 'retry' },
          durationMs: 0
        });
      } catch (error) {
        logger.warn('Failed to surface a worker-exit notice', { error: String(error) });
      }
    })
  );

  disposers.push(
    eventBus.on('process.failed', (event) => {
      try {
        notifyStructuredError(
          createStructuredError({
            // Process errors are always emitted with a taxonomy code; treat the
            // payload's string as the canonical code and keep the real message.
            code: event.payload.code as ErrorCode,
            category: 'process',
            message: event.payload.message,
            severity: 'error',
            recoverable: true,
            retryable: true,
            details: { processName: event.payload.processName },
            suggestedAction: 'Restart the worker and retry the operation.'
          })
        );
      } catch (error) {
        logger.warn('Failed to surface a worker-failure notice', { error: String(error) });
      }
    })
  );

  if (typeof window !== 'undefined') {
    const onWindowError = (event: ErrorEvent): void => {
      // Never rethrow into the host: surface a scrubbed notice instead.
      try {
        const raw =
          event.error instanceof Error
            ? event.error.message
            : typeof event.message === 'string' && event.message.length > 0
              ? event.message
              : 'An unexpected error occurred.';
        useUiStore.getState().pushNotice({
          tone: 'danger',
          message: scrubErrorMessage(raw),
          action: { label: 'Reload application', kind: 'reload' },
          durationMs: 0
        });
      } catch (error) {
        logger.warn('Global error handler failed to record an error', { error: String(error) });
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      try {
        notifyStructuredError(
          toStructuredError(event.reason, {
            code: 'UNKNOWN_ERROR',
            category: 'process',
            message: 'An unexpected background failure occurred.',
            suggestedAction: 'Reload the application; if the problem persists, check the logs.'
          })
        );
      } catch (error) {
        logger.warn('Global rejection handler failed to record an error', { error: String(error) });
      } finally {
        // Mark the rejection as handled so it does not propagate as an uncaught
        // error; the notice is the user-visible outcome.
        event.preventDefault?.();
      }
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    disposers.push(() => window.removeEventListener('error', onWindowError));
    disposers.push(() => window.removeEventListener('unhandledrejection', onUnhandledRejection));
  }

  activeStop = () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      try {
        dispose?.();
      } catch {
        // Cleanup must never throw.
      }
    }
    activeStop = null;
  };

  return activeStop;
}
