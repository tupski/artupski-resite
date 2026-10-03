import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_KEY,
  AI_CREDENTIALS_KEY,
  createProviderFromConfig,
  DEFAULT_AI_CONFIG,
  loadAIConfig,
  loadAIKey,
  saveAIConfig,
  saveAIKey,
  type AIKeychainAccess,
  type AISettingsAccess
} from '../config';
import { createStructuredError, type StructuredError } from '../../infra/errors';
import type { SecretResult } from '../../security/keychain';

/** In-memory settings accessor mirroring the `app_settings` repository contract. */
function memoryAccess(): AISettingsAccess & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => (store.has(key) ? { value: store.get(key) as string } : null),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => store.delete(key)
  };
}

/** In-memory keychain double so no real OS credential store is touched. */
function memoryKeychain(seed: Record<string, string> = {}): AIKeychainAccess & {
  store: Map<string, string>;
  failWith?: StructuredError;
} {
  const store = new Map(Object.entries(seed));
  const access: AIKeychainAccess & { store: Map<string, string>; failWith?: StructuredError } = {
    store,
    failWith: undefined,
    available: async () => access.failWith === undefined,
    get: async (account): Promise<SecretResult> => {
      if (access.failWith) {
        return { ok: false, error: access.failWith };
      }
      return { ok: true, value: store.has(account) ? (store.get(account) as string) : null };
    },
    set: async (account, value) => {
      if (access.failWith) {
        return { ok: false, error: access.failWith };
      }
      store.set(account, value);
      return { ok: true };
    },
    delete: async (account) => {
      if (access.failWith) {
        return { ok: false, error: access.failWith };
      }
      store.delete(account);
      return { ok: true };
    }
  };
  return access;
}

function unavailableError(): StructuredError {
  return createStructuredError({
    code: 'SECRET_STORAGE_UNAVAILABLE',
    category: 'io',
    message: 'no store'
  });
}

const LEGACY_KEY = 'sk-legacy-secret';

describe('AI configuration persistence (no migration; app_settings)', () => {
  it('returns the default config when nothing is stored', async () => {
    const access = memoryAccess();
    expect(await loadAIConfig(access)).toEqual(DEFAULT_AI_CONFIG);
  });

  it('round-trips a saved configuration', async () => {
    const access = memoryAccess();
    const config = {
      providerId: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1:8b',
      timeoutMs: 30000,
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    const saved = await saveAIConfig(config, access);
    expect(saved.ok).toBe(true);
    expect(await loadAIConfig(access)).toEqual(config);
  });

  it('rejects an invalid base URL', async () => {
    const access = memoryAccess();
    const result = await saveAIConfig(
      { ...DEFAULT_AI_CONFIG, baseUrl: 'ftp://bad', model: 'm' },
      access
    );
    expect(result.ok).toBe(false);
  });

  it('stores the API key in the keychain, never in app_settings', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain();
    await saveAIConfig(
      { ...DEFAULT_AI_CONFIG, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      access
    );
    const saved = await saveAIKey('sk-super-secret', access, keychain, 'openai');

    expect(saved.ok).toBe(true);
    const configBlob = access.store.get(AI_CONFIG_KEY) ?? '';
    expect(configBlob).not.toContain('sk-super-secret');
    // The plaintext credentials row is never written.
    expect(access.store.has(AI_CREDENTIALS_KEY)).toBe(false);
    expect(keychain.store.get('openai')).toBe('sk-super-secret');

    const key = await loadAIKey(access, keychain, 'openai');
    expect(key.ok && key.apiKey).toBe('sk-super-secret');
  });

  it('clears the keychain entry when saving an empty string', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain({ openai: 'sk-abc' });
    await saveAIKey('', access, keychain, 'openai');
    const key = await loadAIKey(access, keychain, 'openai');
    expect(key.ok && key.apiKey).toBeNull();
    expect(keychain.store.has('openai')).toBe(false);
  });

  it('returns null for a malformed config blob', async () => {
    const access = memoryAccess();
    await access.set(AI_CONFIG_KEY, 'not-json');
    expect(await loadAIConfig(access)).toEqual(DEFAULT_AI_CONFIG);
  });
});

describe('AI key keychain-first read and legacy migration', () => {
  it('prefers the keychain entry when present', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain({ openai: 'sk-from-keychain' });
    const result = await loadAIKey(access, keychain, 'openai');
    expect(result.ok && result.apiKey).toBe('sk-from-keychain');
  });

  it('migrates a legacy plaintext row to the keychain and deletes it on success', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain();
    await access.set(AI_CREDENTIALS_KEY, JSON.stringify({ apiKey: LEGACY_KEY }));

    const result = await loadAIKey(access, keychain, 'openai');

    expect(result.ok && result.apiKey).toBe(LEGACY_KEY);
    expect(keychain.store.get('openai')).toBe(LEGACY_KEY);
    // The plaintext row is removed only after a confirmed keychain write.
    expect(access.store.has(AI_CREDENTIALS_KEY)).toBe(false);
  });

  it('fails closed when the keychain is unavailable: no plaintext write, honest warning', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain();
    keychain.failWith = unavailableError();

    const saved = await saveAIKey('sk-new', access, keychain, 'openai');
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('SECRET_STORAGE_UNAVAILABLE');
    }
    // Fail closed: nothing was written to app_settings.
    expect(access.store.has(AI_CREDENTIALS_KEY)).toBe(false);
  });

  it('keeps the legacy row and warns when the migration write fails', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain();
    keychain.failWith = unavailableError();
    await access.set(AI_CREDENTIALS_KEY, JSON.stringify({ apiKey: LEGACY_KEY }));

    const result = await loadAIKey(access, keychain, 'openai');

    // The key is still usable for this run...
    expect(result.ok && result.apiKey).toBe(LEGACY_KEY);
    // ...the plaintext row is retained (no data loss)...
    expect(access.store.has(AI_CREDENTIALS_KEY)).toBe(true);
    // ...and the failure is surfaced honestly.
    expect(result.ok && result.warning?.code).toBe('SECRET_STORAGE_UNAVAILABLE');
  });

  it('returns no key when neither keychain nor legacy row exists', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain();
    const result = await loadAIKey(access, keychain, 'openai');
    expect(result.ok && result.apiKey).toBeNull();
    expect(access.store.has(AI_CREDENTIALS_KEY)).toBe(false);
  });
});

describe('createProviderFromConfig', () => {
  it('returns null when no base URL is configured', () => {
    expect(createProviderFromConfig(DEFAULT_AI_CONFIG, null)).toBeNull();
  });

  it('returns null for an invalid base URL', () => {
    expect(
      createProviderFromConfig({ ...DEFAULT_AI_CONFIG, baseUrl: 'not a url' }, null)
    ).toBeNull();
  });

  it('builds a provider for a valid configuration', () => {
    const provider = createProviderFromConfig(
      { ...DEFAULT_AI_CONFIG, baseUrl: 'http://localhost:11434/v1', model: 'llama3.1:8b' },
      null
    );
    expect(provider).not.toBeNull();
    expect(provider?.id).toBe('openai-compatible');
  });
});
