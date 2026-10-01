/**
 * Page authentication classifier - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md section 3 (detection signals and
 * the 5-value page categorization taxonomy).
 *
 * Pure and deterministic: given the signals observed for one page and whether a
 * session was injected for the run, it returns exactly one of:
 *
 *   public        - no auth wall observed and no session was injected.
 *   authenticated - no auth wall observed while a session WAS injected (the
 *                   page was scanned within an active authenticated session).
 *   auth_required - an auth wall was observed (401/403, login redirect, or a
 *                   login form). A wall always means the session did not hold,
 *                   even when one was injected.
 *   blocked       - a CAPTCHA/WAF/rate-limit challenge, not a login form.
 *   unknown       - the page errored/timed out before it could be classified.
 *
 * Documented limitation: without an unauthenticated comparison request we cannot
 * always prove a no-wall page was genuinely protected; a no-wall page during an
 * authenticated run is labelled `authenticated` (scanned with an active
 * session), which is the honest reading of the available signals.
 *
 * IMPORTANT: this module NEVER decides success. A page classified
 * `auth_required`/`blocked`/`unknown` is never reported as an authenticated
 * result; the caller persists it as a non-completed page.
 */
import type { PageAuthStatus } from '../auth/types';

export interface AuthClassifyInput {
  /** Whether this run injected a stored session. */
  sessionInjected: boolean;
  /** HTTP status observed for the page, when known. */
  httpStatus: number | null;
  /** Captured non-secret login signals. */
  signals: {
    redirectedToLogin: boolean;
    hasPasswordField: boolean;
    hasCaptcha: boolean;
  };
  /** The extraction result's own status (failed/timeout => unknown). */
  extractionStatus: 'completed' | 'failed' | 'timeout' | 'skipped';
}

/** True when the signals describe an authentication wall. */
export function hasAuthWall(signals: AuthClassifyInput['signals']): boolean {
  return signals.redirectedToLogin || signals.hasPasswordField;
}

/**
 * Classify one page. Ordering matches the taxonomy's precedence: a CAPTCHA /
 * WAF challenge dominates a login form, an auth wall dominates a session, and
 * an inconclusive fetch is `unknown`.
 */
export function classifyPageAuth(input: AuthClassifyInput): PageAuthStatus {
  const { signals, httpStatus, sessionInjected, extractionStatus } = input;

  // A page that never loaded cannot be classified beyond "unknown".
  if (extractionStatus === 'failed' || extractionStatus === 'timeout') {
    return 'unknown';
  }

  const rateLimited = httpStatus === 429;
  if (signals.hasCaptcha || rateLimited) {
    return 'blocked';
  }

  const wall = hasAuthWall(signals) || httpStatus === 401 || httpStatus === 403;
  if (wall) {
    // A wall means authentication was not established (or was lost). This holds
    // even when a session was injected: the wall is proof the session did not
    // grant access. Never report a walled page as authenticated.
    return 'auth_required';
  }

  // No wall observed. With a session injected the page was reached inside an
  // authenticated session; without one it is a public page.
  return sessionInjected ? 'authenticated' : 'public';
}
