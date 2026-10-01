/**
 * Authentication & session-scanning domain types - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md sections 2.2 and 3.2.
 *
 * These are the application-facing (camelCase) shapes for captured
 * authentication sessions and the per-page auth classification. They mirror the
 * `storageState` produced by Playwright and the taxonomy in the spec, so the
 * rest of the application never invents its own auth vocabulary.
 *
 * SECRET HANDLING: `AuthCookieRecord.value`, `OriginStorageRecord.localStorage`
 * and `sessionStorage` are bearer secrets. They exist ONLY in memory during a
 * capture/inject operation. They are NEVER written to logs, event payloads,
 * scan reports, technology evidence, or the ordinary crawler output; at rest
 * they live only inside the AES-256-GCM ciphertext of `auth_sessions`.
 */

/** A single cookie as captured from the interactive session. */
export interface AuthCookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix epoch seconds; -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/** localStorage / sessionStorage captured for one origin. */
export interface OriginStorageRecord {
  origin: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/** The full, in-memory storage state captured from the interactive window. */
export interface CapturedStorageState {
  cookies: AuthCookieRecord[];
  origins: OriginStorageRecord[];
}

/** Metadata shape persisted for a captured session (never the plaintext). */
export interface AuthSessionMetadata {
  id: string;
  projectId: string;
  targetDomain: string;
  createdAt: string;
  expiresAt: string | null;
  cookieCount: number;
  originCount: number;
}

/**
 * Per-page authentication classification (AUTH-SCANNING.md section 3.2).
 * Every crawled URL is assigned exactly one of these five values.
 */
export type PageAuthStatus = 'public' | 'authenticated' | 'auth_required' | 'blocked' | 'unknown';

export const PAGE_AUTH_STATUSES: readonly PageAuthStatus[] = [
  'public',
  'authenticated',
  'auth_required',
  'blocked',
  'unknown'
];

/** Whether the scan is unauthenticated or uses a captured session. */
export type ScanAuthMode = 'none' | 'session';

/** Honest, user-facing auth outcome distinct from a generic scan failure. */
export type AuthFailureKind =
  'setup_failed' | 'login_failed' | 'session_expired' | 'access_denied' | 'not_required';

export const AUTH_FAILURE_LABEL: Record<AuthFailureKind, string> = {
  setup_failed: 'Authentication setup failed',
  login_failed: 'Login was not completed',
  session_expired: 'Session expired',
  access_denied: 'Access denied',
  not_required: 'No authentication required'
};

/** Known login-looking paths used by redirect-based auth-wall detection. */
export const LOGIN_PATH_HINTS: readonly string[] = [
  '/login',
  '/signin',
  '/sign-in',
  '/auth',
  '/oauth/authorize',
  '/accounts/login',
  '/session/new'
];

/** True when a path/URL looks like a login route. */
export function looksLikeLoginPath(urlOrPath: string): boolean {
  let pathname = urlOrPath;
  try {
    pathname = new URL(urlOrPath).pathname;
  } catch {
    // Already a path fragment; use as-is.
  }
  const lower = pathname.toLowerCase();
  return LOGIN_PATH_HINTS.some(
    (hint) => lower === hint || lower.startsWith(`${hint}/`) || lower.includes(hint)
  );
}
