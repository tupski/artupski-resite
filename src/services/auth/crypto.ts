/**
 * Session cryptography - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md section 4.1 and
 * docs/security/SECURITY.md section 3.1.
 *
 * Authenticated scans capture a Playwright `storageState` (cookies +
 * localStorage). That material is a bearer credential: anyone holding it can
 * impersonate the user against the target. It therefore MUST be encrypted at
 * rest with an authenticated cipher and never stored, logged, or transmitted in
 * plaintext.
 *
 * This module is the single crypto boundary. It:
 *   - derives a per-installation key with PBKDF2 (SHA-512) over a
 *     system-unique seed + a per-project salt;
 *   - encrypts with AES-256-GCM, returning IV / ciphertext / auth tag as
 *     Base64 strings (the shape persisted in `auth_sessions`);
 *   - decrypts with tag verification (tamper -> hard failure);
 *   - redacts cookie values from any object before it can be logged or emitted.
 *
 * It NEVER stores the derived key or the plaintext; callers hold the plaintext
 * only for the duration of an inject/decrypt operation and drop it afterwards.
 *
 * KDF (spec-mandated): AUTH-SCANNING.md section 4.1 and SECURITY.md section 3.1
 * both require PBKDF2 with 100,000 iterations and SHA-512 over the installation
 * seed + per-project salt. The earlier Argon2id mention in an earlier draft was
 * superseded; the authoritative text is PBKDF2. PBKDF2-HMAC-SHA512 is provided
 * by the Web Crypto API in both the Tauri webview and Vitest, so no native or
 * WASM dependency is introduced. This is the implemented, mandated algorithm -
 * not a deviation.
 *
 * Threat model: the ciphertext at rest is only as strong as the seed. The seed
 * (see `authSessionService.getInstallationSeed`) is a random 122-bit UUID held
 * in `app_settings`, scoped to this OS user account. It protects against a
 * database file copied off the machine without the app's settings store; it does
 * NOT protect against an attacker who already reads the user's application data
 * directory. Moving the seed to the OS keychain is a tracked hardening item (see
 * SECURITY.md). A per-session random salt means one cracked key does not aid
 * another session.
 */
import type { StructuredError } from '../infra/errors';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** AES-GCM ciphertext envelope persisted (Base64) in `auth_sessions`. */
export interface EncryptedPayload {
  /** Base64 AES-256-GCM ciphertext. */
  ciphertext: string;
  /** Base64 12-byte initialization vector (unique per encryption). */
  iv: string;
  /** Base64 16-byte GCM authentication tag. */
  authTag: string;
}

export interface AuthCryptoError extends StructuredError {
  code: 'STORAGE_WRITE_FAILED' | 'STORAGE_READ_FAILED';
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toCryptoError(
  code: AuthCryptoError['code'],
  message: string,
  cause?: unknown
): AuthCryptoError {
  const suggestedAction =
    code === 'STORAGE_WRITE_FAILED'
      ? 'Retry capturing the session; if it keeps failing, restart the application.'
      : 'The stored session could not be decrypted. Re-authenticate to capture a new session.';
  return {
    code,
    category: 'auth',
    message,
    severity: 'error',
    recoverable: true,
    retryable: false,
    suggestedAction,
    timestamp: new Date().toISOString(),
    ...(cause !== undefined ? { details: { cause: String(cause) } } : {})
  };
}

/**
 * Derive the 32-byte AES key from the installation seed and the project salt.
 * The seed comes from the caller (per OS keychain / installation) and is never
 * persisted by this module.
 */
export async function deriveSessionKey(
  installationSeed: string,
  projectSalt: string
): Promise<CryptoKey> {
  if (installationSeed.length === 0) {
    throw toCryptoError(
      'STORAGE_WRITE_FAILED',
      'A non-empty installation seed is required to derive the session key.'
    );
  }
  const encoder = new TextEncoder();
  const seedMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(installationSeed),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const salt = encoder.encode(projectSalt);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-512' },
    seedMaterial,
    KEY_LENGTH_BITS
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export interface EncryptOptions {
  /** Human-readable JSON of the storage state (cookies + origins). */
  plaintext: string;
  installationSeed: string;
  projectSalt: string;
}

/** Re-type a byte array so Web Crypto accepts it as an `ArrayBuffer` view. */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

/** Encrypt a storage-state JSON string. The IV is fresh on every call. */
export async function encryptSessionState(options: EncryptOptions): Promise<EncryptedPayload> {
  const key = await deriveSessionKey(options.installationSeed, options.projectSalt);
  const iv = asBufferSource(crypto.getRandomValues(new Uint8Array(IV_BYTES)));
  const encoded = asBufferSource(new TextEncoder().encode(options.plaintext));
  let combined: ArrayBuffer;
  try {
    combined = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: GCM_TAG_BYTES * 8 },
      key,
      encoded
    );
  } catch (cause) {
    throw toCryptoError('STORAGE_WRITE_FAILED', 'Failed to encrypt the session payload.', cause);
  }
  const bytes = new Uint8Array(combined);
  const ciphertext = bytes.slice(0, bytes.length - GCM_TAG_BYTES);
  const authTag = bytes.slice(bytes.length - GCM_TAG_BYTES);
  return {
    ciphertext: base64FromBytes(ciphertext),
    iv: base64FromBytes(iv),
    authTag: base64FromBytes(authTag)
  };
}

export interface DecryptOptions extends EncryptedPayload {
  installationSeed: string;
  projectSalt: string;
}

/**
 * Decrypt a stored session payload. Tag verification means a tampered payload
 * (or a wrong seed) fails closed rather than yielding garbage plaintext.
 */
export async function decryptSessionState(options: DecryptOptions): Promise<string> {
  try {
    const key = await deriveSessionKey(options.installationSeed, options.projectSalt);
    // Decoding happens INSIDE the guard: malformed Base64 (a corrupt or hostile
    // envelope) must fail closed with a structured error, never leak a raw
    // DOMException or partial plaintext.
    const iv = asBufferSource(bytesFromBase64(options.iv));
    const ciphertext = bytesFromBase64(options.ciphertext);
    const authTag = bytesFromBase64(options.authTag);
    const combined = new Uint8Array(ciphertext.length + authTag.length);
    combined.set(ciphertext, 0);
    combined.set(authTag, ciphertext.length);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: GCM_TAG_BYTES * 8 },
      key,
      asBufferSource(combined)
    );
    return new TextDecoder().decode(plaintext);
  } catch (cause) {
    throw toCryptoError(
      'STORAGE_READ_FAILED',
      'Failed to decrypt the stored session payload.',
      cause
    );
  }
}

/** Generate a random Base64 salt (per project). */
export function createSalt(): string {
  return base64FromBytes(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/**
 * Structurally redact secret fields from any object before it is logged.
 * Used as a defensive last line so a cookie value or an `Authorization` header
 * can never reach a log sink, an event payload, or an error message.
 */
const SECRET_KEY_PATTERN =
  /(cookie|authorization|token|secret|password|passwd|pwd|session|set-cookie|bearer)/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redactSecrets(entry);
    }
    return result;
  }
  return value;
}
