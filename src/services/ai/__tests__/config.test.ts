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
  type AISettingsAccess
} from '../config';

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

  it('keeps the API key in a separate key from the config blob', async () => {
    const access = memoryAccess();
    await saveAIConfig(
      { ...DEFAULT_AI_CONFIG, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      access
    );
    await saveAIKey('sk-super-secret', access);

    const configBlob = access.store.get(AI_CONFIG_KEY) ?? '';
    expect(configBlob).not.toContain('sk-super-secret');
    expect(access.store.has(AI_CREDENTIALS_KEY)).toBe(true);

    const key = await loadAIKey(access);
    expect(key.ok && key.apiKey).toBe('sk-super-secret');
  });

  it('clears the stored key when saving an empty string', async () => {
    const access = memoryAccess();
    await saveAIKey('sk-abc', access);
    await saveAIKey('', access);
    const key = await loadAIKey(access);
    expect(key.ok && key.apiKey).toBeNull();
    expect(access.store.has(AI_CREDENTIALS_KEY)).toBe(false);
  });

  it('returns null for a malformed config blob', async () => {
    const access = memoryAccess();
    await access.set(AI_CONFIG_KEY, 'not-json');
    expect(await loadAIConfig(access)).toEqual(DEFAULT_AI_CONFIG);
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
