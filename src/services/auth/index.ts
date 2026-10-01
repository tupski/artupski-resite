/**
 * Authentication service barrel - Artupski ReSite
 *
 * The single import seam for authenticated-scanning consumers. Crypto and the
 * repository stay behind this boundary.
 */
export {
  captureSession,
  loadSessionForScan,
  hasActiveSession,
  getSessionMetadata,
  clearSession,
  isLoginRoute,
  type AuthServiceResult
} from './authSessionService';

export {
  PAGE_AUTH_STATUSES,
  AUTH_FAILURE_LABEL,
  LOGIN_PATH_HINTS,
  looksLikeLoginPath,
  type AuthCookieRecord,
  type OriginStorageRecord,
  type CapturedStorageState,
  type AuthSessionMetadata,
  type PageAuthStatus,
  type ScanAuthMode,
  type AuthFailureKind
} from './types';

export {
  deriveSessionKey,
  encryptSessionState,
  decryptSessionState,
  createSalt,
  redactSecrets,
  type EncryptedPayload
} from './crypto';
