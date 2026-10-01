/**
 * Auth session service - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md sections 2, 4 and
 * docs/security/SECURITY.md section 3.
 *
 * Owns the lifecycle of a captured authentication session:
 *   capture (encrypt) -> persist -> load (decrypt) -> inject -> clear.
 *
 * SECURITY MODEL
 *   - The plaintext `CapturedStorageState` exists only in memory for the
 *     duration of a capture/inject call; it is never logged, never emitted on
 *     the event bus, and never written to a file.
 *   - At rest it lives ONLY as the AES-256-GCM ciphertext of `auth_sessions`.
 *   - `clearSession` performs a cryptographic deletion (the row, and thus the
 *     only copy of the key material, is removed).
 *   - A session is scoped to the project AND the target domain it was captured
 *     for; a mismatched domain is refused so a session cannot be replayed
 *     against an unrelated origin.
 *
 * KEY SEED (documented limitation): AUTH-SCANNING.md section 4.1 derives the
 * key from a "desktop app unique installation machine ID". There is no OS
 * keychain integration in this codebase yet (deferred; see SECURITY.md), so the
 * installation id is a random value generated once and stored in `app_settings`.
 * It is an installation identifier, not an OS-protected secret, and is
 * documented as such - it must not be presented as hardware-backed.
 */
import { createEvent, eventBus } from '../infra/eventBus';
import { logger } from '../infra/logger';
import { createStructuredError, type StructuredError } from '../infra/errors';
import { storageService } from '../storage';
import { getBrowserRuntime, type BrowserRuntime } from '../browser';
import { encryptSessionState, decryptSessionState, createSalt } from './crypto';
import { looksLikeLoginPath, type AuthSessionMetadata, type CapturedStorageState } from './types';
import type { AuthSession } from '../../types/models';

const INSTALLATION_ID_KEY = 'auth.installation_id';

/**
 * Resolves the live browser runtime. Injectable so the interactive capture flow
 * can be unit-tested with a fake runtime (mirroring `scanService`). The default
 * is the module-level singleton, which is `null` outside the Tauri shell.
 */
type RuntimeProvider = () => BrowserRuntime | null;
let runtimeProvider: RuntimeProvider = getBrowserRuntime;

/** Test-only: override the runtime provider; pass null to restore the default. */
export function setAuthRuntimeProviderForTests(provider: RuntimeProvider | null): void {
  runtimeProvider = provider ?? getBrowserRuntime;
}

export type AuthServiceResult<T> = { ok: true; data: T } | { ok: false; error: StructuredError };

function authError(
  code: StructuredError['code'],
  message: string,
  suggestedAction: string
): StructuredError {
  return createStructuredError({
    code,
    category: 'auth',
    message,
    severity: 'error',
    recoverable: true,
    retryable: false,
    suggestedAction
  });
}

/** Read (or lazily create) the per-installation seed. Never a bearer secret. */
async function getInstallationSeed(): Promise<string> {
  const settings = storageService.getRepositories().settings;
  const existing = await settings.get(INSTALLATION_ID_KEY);
  if (existing && existing.value.length > 0) {
    return existing.value;
  }
  const generated = crypto.randomUUID();
  await settings.set(INSTALLATION_ID_KEY, generated);
  return generated;
}

/** Hostname of a URL, lower-cased, or null when unparseable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function toMetadata(session: AuthSession): AuthSessionMetadata {
  return {
    id: session.id,
    projectId: session.projectId,
    targetDomain: session.targetDomain,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    cookieCount: session.cookieCount,
    originCount: session.originCount
  };
}

/**
 * Encrypt and persist a captured storage state as the project's single active
 * session. `expiresAt` is derived from the soonest cookie expiry (null when all
 * cookies are session cookies).
 */
export async function captureSession(input: {
  projectId: string;
  targetUrl: string;
  storageState: CapturedStorageState;
}): Promise<AuthServiceResult<AuthSessionMetadata>> {
  if (storageService.getState() !== 'ready') {
    return {
      ok: false,
      error: authError(
        'STORAGE_NOT_READY',
        'Cannot store the session: local storage is not ready.',
        'Retry once storage is ready.'
      )
    };
  }
  const domain = hostOf(input.targetUrl);
  if (!domain) {
    return {
      ok: false,
      error: authError(
        'INVALID_URL',
        'The session target URL is not valid.',
        'Enter a valid http(s) URL and retry.'
      )
    };
  }
  if (input.storageState.cookies.length === 0 && input.storageState.origins.length === 0) {
    return {
      ok: false,
      error: authError(
        'LOGIN_FAILED',
        'No authentication state was captured. Complete the login before capturing.',
        'Sign in in the browser window, then capture the session.'
      )
    };
  }

  const seed = await getInstallationSeed();
  const salt = createSalt();
  try {
    const plaintext = JSON.stringify(input.storageState);
    const encrypted = await encryptSessionState({
      plaintext,
      installationSeed: seed,
      projectSalt: salt
    });

    // Expiry: soonest non-session cookie expiry (epoch seconds -> ISO). Session
    // cookies (`expires` <= 0) are ignored for expiry purposes.
    const expiries = input.storageState.cookies
      .map((cookie) => cookie.expires)
      .filter((expires) => Number.isFinite(expires) && expires > 0);
    const expiresAt =
      expiries.length > 0 ? new Date(Math.min(...expiries) * 1000).toISOString() : null;

    const session = await storageService.getRepositories().authSessions.saveSession({
      projectId: input.projectId,
      authType: 'interactive',
      sessionName: domain,
      targetDomain: domain,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt,
      cookieCount: input.storageState.cookies.length,
      originCount: input.storageState.origins.length,
      expiresAt
    });

    // The event carries only counts/domain - never a cookie or token.
    eventBus.emit(
      createEvent('auth.completed', {
        projectId: input.projectId,
        targetDomain: domain,
        cookieCount: session.cookieCount,
        originCount: session.originCount
      })
    );
    logger.child('auth').info('Session captured', {
      projectId: input.projectId,
      domain,
      cookieCount: session.cookieCount
    });
    return { ok: true, data: toMetadata(session) };
  } catch (error) {
    logger
      .child('auth')
      .error('Session capture failed', error as StructuredError, { projectId: input.projectId });
    return {
      ok: false,
      error: authError(
        'STORAGE_WRITE_FAILED',
        'The captured session could not be encrypted and stored.',
        'Retry capturing the session.'
      )
    };
  }
}

/**
 * Load and decrypt the active session for a project, scoped to the requested
 * target. Expired sessions are purged first (spec section 4.2). Returns a
 * structured auth failure when there is no usable session - never plaintext on
 * failure.
 */
export async function loadSessionForScan(
  projectId: string,
  targetUrl: string
): Promise<AuthServiceResult<CapturedStorageState>> {
  if (storageService.getState() !== 'ready') {
    return {
      ok: false,
      error: authError(
        'STORAGE_NOT_READY',
        'Cannot load the session: local storage is not ready.',
        'Retry once storage is ready.'
      )
    };
  }
  const repo = storageService.getRepositories().authSessions;
  await repo.purgeExpired();

  const session = await repo.findActive(projectId);
  if (!session) {
    return {
      ok: false,
      error: authError(
        'LOGIN_FAILED',
        'No active authentication session was found for this project.',
        'Capture a session from the Scan screen before running an authenticated scan.'
      )
    };
  }

  const domain = hostOf(targetUrl);
  if (!domain || domain !== session.targetDomain) {
    return {
      ok: false,
      error: authError(
        'LOGIN_FAILED',
        `The stored session was captured for ${session.targetDomain} and cannot be used for ${domain ?? 'this target'}.`,
        'Capture a new session for this target.'
      )
    };
  }

  try {
    const seed = await getInstallationSeed();
    const plaintext = await decryptSessionState({
      ciphertext: session.ciphertext,
      iv: session.iv,
      authTag: session.authTag,
      installationSeed: seed,
      projectSalt: session.salt
    });
    const parsed = JSON.parse(plaintext) as CapturedStorageState;
    return {
      ok: true,
      data: {
        cookies: Array.isArray(parsed.cookies) ? parsed.cookies : [],
        origins: Array.isArray(parsed.origins) ? parsed.origins : []
      }
    };
  } catch {
    return {
      ok: false,
      error: authError(
        'SESSION_EXPIRED',
        'The stored session could not be decrypted and is no longer usable.',
        'Capture a new session.'
      )
    };
  }
}

/** Whether the project currently has an active, unexpired session. */
export async function hasActiveSession(projectId: string): Promise<boolean> {
  if (storageService.getState() !== 'ready') {
    return false;
  }
  const repo = storageService.getRepositories().authSessions;
  await repo.purgeExpired();
  return (await repo.findActive(projectId)) !== null;
}

/** Metadata for the active session (no ciphertext), for honest UI display. */
export async function getSessionMetadata(projectId: string): Promise<AuthSessionMetadata | null> {
  if (storageService.getState() !== 'ready') {
    return null;
  }
  const repo = storageService.getRepositories().authSessions;
  await repo.purgeExpired();
  const session = await repo.findActive(projectId);
  return session ? toMetadata(session) : null;
}

/** Cryptographic deletion of every session for the project ("Clear Session"). */
export async function clearSession(projectId: string): Promise<AuthServiceResult<number>> {
  if (storageService.getState() !== 'ready') {
    return {
      ok: false,
      error: authError(
        'STORAGE_NOT_READY',
        'Cannot clear the session: local storage is not ready.',
        'Retry once storage is ready.'
      )
    };
  }
  const removed = await storageService.getRepositories().authSessions.deleteByProject(projectId);
  if (removed > 0) {
    eventBus.emit(createEvent('auth.session_cleared', { projectId, removed }));
    logger.child('auth').info('Session cleared', { projectId, removed });
  }
  return { ok: true, data: removed };
}

/**
 * True when a URL is a login-looking route. Re-exported through this service so
 * callers do not reach into the auth type module directly.
 */
export function isLoginRoute(url: string): boolean {
  return looksLikeLoginPath(url);
}

// ---------------------------------------------------------------------------
// Interactive (headed) capture flow - AUTH-SCANNING.md section 2.1
//
// Capture is a THREE-step, user-in-the-loop operation split across separate
// requests so the human login (which may take minutes) is never bounded by the
// 30s worker request timeout:
//   1. beginInteractiveCapture  -> opens the headed window (returns at once)
//   2. (user completes login in the window)
//   3. completeInteractiveCapture -> captures + encrypts + persists, then closes
// Cancel is always available and always closes the window.
//
// SECURITY: no credential is ever entered, read, or stored by the application;
// the captured state is scoped to the target host by the worker, validated here
// against the host the user is capturing for, and only then encrypted.
// ---------------------------------------------------------------------------

/** Validate an http(s) target URL and return its lower-cased hostname. */
function httpHostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Open the headed interactive capture window for `targetUrl` and return its
 * opaque session id. The window carries NO injected state; the user completes
 * login manually. Never automates or observes credentials.
 */
export async function beginInteractiveCapture(input: {
  targetUrl: string;
}): Promise<AuthServiceResult<{ sessionId: string }>> {
  if (storageService.getState() !== 'ready') {
    return {
      ok: false,
      error: authError(
        'STORAGE_NOT_READY',
        'Cannot start the capture: local storage is not ready.',
        'Retry once storage is ready.'
      )
    };
  }
  const host = httpHostOf(input.targetUrl);
  if (!host) {
    return {
      ok: false,
      error: authError(
        'INVALID_URL',
        'The capture target is not a valid http(s) URL.',
        'Enter the full https URL of the page you sign in on.'
      )
    };
  }
  const runtime = runtimeProvider();
  if (!runtime || runtime.getState() !== 'ready') {
    return {
      ok: false,
      error: authError(
        'BROWSER_NOT_INSTALLED',
        'The browser runtime is not available.',
        'Install the browser runtime with `npx playwright install chromium`, then retry.'
      )
    };
  }

  const started = await runtime.launchCaptureSession(input.targetUrl);
  if (!started.ok) {
    return { ok: false, error: started.error };
  }
  return { ok: true, data: { sessionId: started.data.sessionId } };
}

/**
 * Capture the storage state from the open interactive window, verify it is
 * scoped to the capture target, encrypt + persist it as the project's active
 * session, and always close the window. No secret is logged or emitted.
 */
export async function completeInteractiveCapture(input: {
  projectId: string;
  targetUrl: string;
}): Promise<AuthServiceResult<AuthSessionMetadata>> {
  const runtime = runtimeProvider();
  const host = httpHostOf(input.targetUrl);
  if (!runtime || !host) {
    return {
      ok: false,
      error: authError(
        'LOGIN_FAILED',
        'The interactive capture could not be completed.',
        'Retry the capture from the Scan screen.'
      )
    };
  }

  try {
    const captured = await runtime.captureSessionState();
    if (!captured.ok) {
      return { ok: false, error: captured.error };
    }

    // Scope enforcement at the host boundary: the worker already scoped the
    // state, but the host re-checks that it matches the target the user is
    // capturing for. A mismatch is refused so state can never be filed against
    // an unrelated origin.
    if (captured.data.scopeHost.toLowerCase() !== host) {
      return {
        ok: false,
        error: authError(
          'LOGIN_FAILED',
          'The captured session did not match the chosen target domain.',
          'Make sure you sign in on the target site, then retry the capture.'
        )
      };
    }

    // Playwright's storageState covers cookies + localStorage; sessionStorage is
    // not part of that snapshot, so it is normalized to an empty map here.
    const storageState: CapturedStorageState = {
      cookies: captured.data.storageState.cookies,
      origins: captured.data.storageState.origins.map((origin) => ({
        origin: origin.origin,
        localStorage: origin.localStorage,
        sessionStorage: origin.sessionStorage ?? {}
      }))
    };
    const result = await captureSession({
      projectId: input.projectId,
      targetUrl: input.targetUrl,
      storageState
    });
    return result;
  } finally {
    // Always close the window, on success, failure, or cancellation.
    await runtime.cancelCapture();
  }
}

/** Close and discard the interactive capture window. Idempotent. */
export async function cancelInteractiveCapture(): Promise<void> {
  const runtime = runtimeProvider();
  if (runtime) {
    await runtime.cancelCapture();
  }
}
