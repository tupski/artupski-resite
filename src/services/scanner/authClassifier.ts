/**
 * Page authentication classifier - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md section 3 (detection signals and
 * the 5-value page categorization taxonomy).
 *
 * Pure and deterministic: given the signals observed for one page and whether a
 * session was injected for the run, it returns exactly one of:
 *
 *   public        - no auth wall observed and no session was injected.
 *   authenticated - no auth wall observed while a session WAS injected. This
 *                   value means "scanned WITH an authenticated session in
 *                   effect"; it is NOT independent proof that the page is
 *                   protected. It is the only honest reading available without
 *                   an extra unauthenticated comparison request (which the spec
 *                   forbids because it would create out-of-scope side effects).
 *   auth_required - an auth wall was observed (401/403, login redirect, or a
 *                   login form). A wall always means the session did not hold,
 *                   even when one was injected.
 *   blocked       - a CAPTCHA/WAF/rate-limit challenge, not a login form.
 *   unknown       - the page errored/timed out before it could be classified.
 *
 * Documented limitation (AUTH-SCANNING.md section 3.2): `authenticated` reports
 * session USE, not verified protection. A genuinely public page reached during
 * an authenticated scan is also labelled `authenticated`, because the classifier
 * cannot distinguish "public page" from "protected page the session unlocked"
 * without a second, unauthenticated request. Consumers MUST treat `authenticated`
 * as "session was in effect", never as "access was proven required".
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

  // No wall observed. With a session in effect the page was reached inside an
  // authenticated session (`authenticated` = session used, not verified
  // protected); without one it is truthfully `public`.
  return sessionInjected ? 'authenticated' : 'public';
}
