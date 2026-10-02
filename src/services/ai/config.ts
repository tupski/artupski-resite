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
import type { StructuredError } from '../infra/errors';
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

export type AIKeyResult =
  { ok: true; apiKey: string | null } | { ok: false; error: StructuredError };

/** A minimal settings accessor so tests can inject an in-memory repository. */
export interface AISettingsAccess {
  get(key: string): Promise<{ value: string } | null>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<boolean>;
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

/** Read the stored API key, or null. Never returned via events or logs. */
export async function loadAIKey(access?: AISettingsAccess): Promise<AIKeyResult> {
  try {
    const row = await resolveAccess(access).get(AI_CREDENTIALS_KEY);
    if (!row) {
      return { ok: true, apiKey: null };
    }
    const parsed = JSON.parse(row.value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'apiKey' in parsed) {
      const value = (parsed as { apiKey: unknown }).apiKey;
      return { ok: true, apiKey: typeof value === 'string' ? value : null };
    }
    return { ok: true, apiKey: null };
  } catch (error) {
    return {
      ok: false,
      error: createStorageError('STORAGE_READ_FAILED', {
        message: 'Failed to read AI credentials.',
        cause: error
      })
    };
  }
}

/** Store (or clear, when empty) the API key. */
export async function saveAIKey(apiKey: string, access?: AISettingsAccess): Promise<void> {
  const accessor = resolveAccess(access);
  if (!apiKey) {
    await accessor.delete(AI_CREDENTIALS_KEY);
    return;
  }
  await accessor.set(AI_CREDENTIALS_KEY, JSON.stringify({ apiKey }));
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
