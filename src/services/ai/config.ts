/**
 * AI configuration persistence - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-10-impl-plan.md section 4.
 *
 * AI settings live in the existing `app_settings` key/value table (no migration).
 * Non-secret configuration is stored as JSON under `ai.config`; the API key is
 * stored under a SEPARATE key (`ai.credentials`) so it can be handled, redacted,
 * and later migrated independently. Values are never logged here.
 */
import type { AIConfig } from '../../types/ai';
import { storageService } from '../storage';
import { createStorageError } from '../storage/errors';
import { createStructuredError, type StructuredError } from '../infra/errors';
import {
  getSecret as keychainGetSecret,
  setSecret as keychainSetSecret,
  deleteSecret as keychainDeleteSecret,
  secretAvailable as keychainSecretAvailable,
  type SecretResult
} from '../security/keychain';
import { OpenAICompatibleProvider, type FetchLike } from './provider';
import { getPreset, validateBaseUrl } from './presets';

export const AI_CONFIG_KEY = 'ai.config';
export const AI_CREDENTIALS_KEY = 'ai.credentials';

/** The default, inert configuration (no endpoint configured). */
export const DEFAULT_AI_CONFIG: AIConfig = {
  providerId: 'openai',
  baseUrl: '',
  model: '',
  timeoutMs: 60000,
  updatedAt: ''
};

export interface AICredentials {
  apiKey: string;
}

export type AIConfigResult = { ok: true; config: AIConfig } | { ok: false; error: StructuredError };

/**
 * Read result for the API key. The `ok` branch may carry a non-fatal `warning`
 * (e.g. `SECRET_STORAGE_UNAVAILABLE` during a legacy migration) while still
 * returning a usable key for this run.
 */
export type AIKeyResult =
  | { ok: true; apiKey: string | null; warning?: StructuredError }
  | { ok: false; error: StructuredError };

/** Write result for the API key. */
export type AIKeyWriteResult = { ok: true } | { ok: false; error: StructuredError };

/** A minimal settings accessor so tests can inject an in-memory repository. */
export interface AISettingsAccess {
  get(key: string): Promise<{ value: string } | null>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<boolean>;
}

/**
 * A minimal keychain accessor so tests can inject a fake OS store. The default
 * implementation delegates to `src/services/security/keychain`.
 */
export interface AIKeychainAccess {
  available(): Promise<boolean>;
  get(account: string): Promise<SecretResult>;
  set(account: string, value: string): Promise<{ ok: boolean; error?: StructuredError }>;
  delete(account: string): Promise<{ ok: boolean; error?: StructuredError }>;
}

/** The default provider account used before any config has been persisted. */
export const DEFAULT_PROVIDER_ACCOUNT = 'openai';

const defaultKeychainAccess: AIKeychainAccess = {
  available: keychainSecretAvailable,
  get: keychainGetSecret,
  set: keychainSetSecret,
  delete: keychainDeleteSecret
};

function resolveKeychain(keychain?: AIKeychainAccess): AIKeychainAccess {
  return keychain ?? defaultKeychainAccess;
}

function resolveAccess(access?: AISettingsAccess): AISettingsAccess {
  if (access) {
    return access;
  }
  return storageService.getRepositories().settings as unknown as AISettingsAccess;
}

/** Load the persisted AI configuration, or the default when unset/invalid. */
export async function loadAIConfig(access?: AISettingsAccess): Promise<AIConfig> {
  const row = await resolveAccess(access).get(AI_CONFIG_KEY);
  if (!row) {
    return { ...DEFAULT_AI_CONFIG };
  }
  const parsed = parseConfig(row.value);
  return parsed ?? { ...DEFAULT_AI_CONFIG };
}

/** Persist the AI configuration (upsert). The key is NOT part of this blob. */
export async function saveAIConfig(
  config: AIConfig,
  access?: AISettingsAccess
): Promise<AIConfigResult> {
  const validation = validateBaseUrl(config.baseUrl);
  if (config.baseUrl && !validation.valid) {
    return {
      ok: false,
      error: createStorageError('STORAGE_WRITE_FAILED', {
        message: validation.error ?? 'Invalid base URL.'
      })
    };
  }

  try {
    const accessor = resolveAccess(access);
    await accessor.set(AI_CONFIG_KEY, JSON.stringify(config));
    return { ok: true, config };
  } catch (error) {
    return {
      ok: false,
      error: createStorageError('STORAGE_WRITE_FAILED', {
        message: 'Failed to save AI configuration.',
        cause: error
      })
    };
  }
}

/** Build a `SECRET_STORAGE_UNAVAILABLE` structured error. */
function secretStorageUnavailable(message: string): StructuredError {
  return createStructuredError({
    code: 'SECRET_STORAGE_UNAVAILABLE',
    category: 'io',
    message,
    severity: 'warning',
    recoverable: true,
    retryable: false,
    suggestedAction:
      'Install or unlock an OS credential store (Windows Credential Manager, macOS Keychain, or a running Secret Service on Linux), then save the key again.'
  });
}

/**
 * Parse a legacy `ai.credentials` plaintext row. Returns the key string, or
 * null when the row is absent/empty/malformed.
 */
function parseLegacyKey(row: { value: string } | null): string | null {
  if (!row) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'apiKey' in parsed) {
      const value = (parsed as { apiKey: unknown }).apiKey;
      return typeof value === 'string' && value.length > 0 ? value : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Read the API key, keychain-first:
 *
 * 1. If a keychain entry exists for the provider, use it.
 * 2. Else if a legacy plaintext `ai.credentials` row exists, use it for this
 *    run and migrate it: write to the keychain, then delete the plaintext row
 *    ONLY after a confirmed write. On migration failure the plaintext row is
 *    retained and a non-fatal `SECRET_STORAGE_UNAVAILABLE` warning is returned.
 * 3. Else no key.
 *
 * The key is never returned via events or logs.
 */
export async function loadAIKey(
  access?: AISettingsAccess,
  keychain?: AIKeychainAccess,
  account: string = DEFAULT_PROVIDER_ACCOUNT
): Promise<AIKeyResult> {
  const keychainAccess = resolveKeychain(keychain);

  let fromKeychain: SecretResult;
  try {
    fromKeychain = await keychainAccess.get(account);
  } catch (error) {
    return {
      ok: false,
      error: createStorageError('STORAGE_READ_FAILED', {
        message: 'Failed to read AI credentials from the OS credential store.',
        cause: error
      })
    };
  }

  if (fromKeychain.ok && fromKeychain.value !== null) {
    return { ok: true, apiKey: fromKeychain.value };
  }

  // Keychain is unreachable: fail closed, but still surface any legacy key so
  // the current session can use it (the plaintext row is never re-created).
  const legacyWarning = fromKeychain.ok
    ? undefined
    : fromKeychain.error.code === 'SECRET_STORAGE_UNAVAILABLE'
      ? secretStorageUnavailable('The OS credential store is unavailable; the key is used for this session only.')
      : undefined;

  let legacyKey: string | null = null;
  try {
    legacyKey = parseLegacyKey(await resolveAccess(access).get(AI_CREDENTIALS_KEY));
  } catch (error) {
    return {
      ok: false,
      error: createStorageError('STORAGE_READ_FAILED', {
        message: 'Failed to read AI credentials.',
        cause: error
      })
    };
  }

  if (legacyKey === null) {
    return legacyWarning ? { ok: true, apiKey: null, warning: legacyWarning } : { ok: true, apiKey: null };
  }

  // Attempt the one-time migration; the plaintext row is only removed after a
  // confirmed keychain write.
  const write = await keychainAccess.set(account, legacyKey);
  if (write.ok) {
    await resolveAccess(access).delete(AI_CREDENTIALS_KEY);
    return { ok: true, apiKey: legacyKey };
  }

  const warning =
    write.error?.code === 'SECRET_STORAGE_UNAVAILABLE'
      ? secretStorageUnavailable('The OS credential store is unavailable; the key could not be migrated and remains stored locally.')
      : createStructuredError({
          code: 'SECRET_WRITE_FAILED',
          category: 'io',
          message: 'Failed to migrate the AI key to the OS credential store.',
          severity: 'warning',
          recoverable: true,
          retryable: true,
          suggestedAction: 'Retry saving the key in Settings. The existing key is retained for this session.'
        });
  return { ok: true, apiKey: legacyKey, warning };
}

/**
 * Store (or clear, when empty) the API key in the OS keychain. Fails closed
 * when no store is available: the key is NEVER written to plaintext.
 */
export async function saveAIKey(
  apiKey: string,
  access?: AISettingsAccess,
  keychain?: AIKeychainAccess,
  account: string = DEFAULT_PROVIDER_ACCOUNT
): Promise<AIKeyWriteResult> {
  const keychainAccess = resolveKeychain(keychain);
  if (!apiKey) {
    const deleted = await keychainAccess.delete(account);
    if (!deleted.ok) {
      return {
        ok: false,
        error:
          deleted.error ??
          secretStorageUnavailable('The OS credential store is unavailable; the key was not revoked.')
      };
    }
    // Remove any legacy plaintext row too, so a revoked key leaves nothing.
    await resolveAccess(access).delete(AI_CREDENTIALS_KEY);
    return { ok: true };
  }

  const written = await keychainAccess.set(account, apiKey);
  if (!written.ok) {
    return {
      ok: false,
      error:
        written.error ??
        secretStorageUnavailable('The OS credential store is unavailable; the key was not stored.')
    };
  }

  // A successful keychain write supersedes any legacy plaintext row.
  await resolveAccess(access).delete(AI_CREDENTIALS_KEY);
  return { ok: true };
}

function parseConfig(raw: string): AIConfig | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
      providerId:
        typeof record.providerId === 'string' ? record.providerId : DEFAULT_AI_CONFIG.providerId,
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
      model: typeof record.model === 'string' ? record.model : '',
      timeoutMs:
        typeof record.timeoutMs === 'number' ? record.timeoutMs : DEFAULT_AI_CONFIG.timeoutMs,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
    };
  } catch {
    return null;
  }
}

/**
 * Build a provider from persisted config + key. Returns null when no endpoint is
 * configured yet. `fetchImpl` is injectable for tests.
 */
export function createProviderFromConfig(
  config: AIConfig,
  apiKey: string | null,
  fetchImpl?: FetchLike
): OpenAICompatibleProvider | null {
  if (!config.baseUrl || !validateBaseUrl(config.baseUrl).valid) {
    return null;
  }
  return new OpenAICompatibleProvider(
    {
      baseUrl: config.baseUrl,
      apiKey: apiKey ?? '',
      defaultModel: config.model || getPreset(config.providerId).defaultModel,
      timeoutMs: config.timeoutMs
    },
    fetchImpl
  );
}
