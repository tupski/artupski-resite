import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AICompletionResponse, IAIProvider } from '../../../types/ai';
import { createAiEngine } from '../engine';
import type { AIKeychainAccess, AISettingsAccess } from '../config';
import type { SecretResult } from '../../security/keychain';
import { eventBus, type AppEventType } from '../../infra/eventBus';

function memoryAccess(
  seed: Record<string, string> = {}
): AISettingsAccess & { store: Map<string, string> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: async (key) => (store.has(key) ? { value: store.get(key) as string } : null),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => store.delete(key)
  };
}

/** In-memory keychain double so the engine never touches a real OS store. */
function memoryKeychain(seed: Record<string, string> = {}): AIKeychainAccess & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(seed));
  return {
    store,
    available: async () => true,
    get: async (account): Promise<SecretResult> => ({
      ok: true,
      value: store.has(account) ? (store.get(account) as string) : null
    }),
    set: async (account, value) => {
      store.set(account, value);
      return { ok: true };
    },
    delete: async (account) => {
      store.delete(account);
      return { ok: true };
    }
  };
}

function response(content: string): AICompletionResponse {
  return {
    content,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'm',
    finishReason: 'stop'
  };
}

function stubProvider(overrides: Partial<IAIProvider> = {}): IAIProvider {
  return {
    id: 'stub',
    name: 'Stub',
    validateCredentials: async () => ({ valid: true }),
    listModels: async () => ['m'],
    chatCompletion: async () => response('{"name":"a","count":1}'),
    streamChatCompletion: async () => response(''),
    ...overrides
  };
}

const CONFIG_SEED = JSON.stringify({
  providerId: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.1:8b',
  timeoutMs: 60000,
  updatedAt: ''
});

function collectEvents(): { types: AppEventType[]; stop: () => void } {
  const types: AppEventType[] = [];
  const channels: AppEventType[] = [
    'ai.config_saved',
    'ai.connection_started',
    'ai.connection_verified',
    'ai.connection_failed',
    'ai.generation_started',
    'ai.generation_completed',
    'ai.generation_failed'
  ];
  const stops = channels.map((type) => eventBus.on(type, (event) => types.push(event.type)));
  return { types, stop: () => stops.forEach((stop) => stop()) };
}

describe('createAiEngine', () => {
  afterEach(() => eventBus.clear());

  it('reports health verified and emits connection events (no key in payload)', async () => {
    const access = memoryAccess({ 'ai.config': CONFIG_SEED });
    const events = collectEvents();
    const engine = createAiEngine({ settings: access, provider: stubProvider() });
    const result = await engine.healthCheck();
    events.stop();

    expect(result.valid).toBe(true);
    expect(events.types).toEqual(['ai.connection_started', 'ai.connection_verified']);
  });

  it('reports health failure with a structured ai error', async () => {
    const access = memoryAccess({ 'ai.config': CONFIG_SEED });
    const engine = createAiEngine({
      settings: access,
      provider: stubProvider({
        listModels: async () => {
          throw new Error('down');
        }
      })
    });
    const result = await engine.healthCheck();
    expect(result.valid).toBe(false);
    expect(result.error?.category).toBe('ai');
  });

  it('is unconfigured and fails health when no endpoint is set', async () => {
    const access = memoryAccess();
    const engine = createAiEngine({ settings: access });
    expect(await engine.isConfigured()).toBe(false);
    const result = await engine.healthCheck();
    expect(result.valid).toBe(false);
  });

  it('saves config and key to the keychain and emits ai.config_saved with hasApiKey only', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain();
    const events = collectEvents();
    const engine = createAiEngine({ settings: access, keychain });
    const saved = await engine.saveConfig(
      {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        timeoutMs: 60000,
        updatedAt: ''
      },
      'sk-secret'
    );
    events.stop();

    expect(saved.ok).toBe(true);
    expect(events.types).toContain('ai.config_saved');
    // The secret must live only in the keychain, never in app_settings.
    expect(access.store.get('ai.config')).not.toContain('sk-secret');
    expect(access.store.has('ai.credentials')).toBe(false);
    expect(keychain.store.get('openai')).toBe('sk-secret');
  });

  it('surfaces SECRET_STORAGE_UNAVAILABLE from saveConfig without crashing', async () => {
    const access = memoryAccess();
    const keychain = memoryKeychain();
    keychain.set = async () => ({
      ok: false,
      error: {
        code: 'SECRET_STORAGE_UNAVAILABLE',
        category: 'io',
        message: 'no store',
        severity: 'warning',
        recoverable: true,
        retryable: false,
        suggestedAction: 'unlock the store',
        timestamp: new Date().toISOString()
      }
    });
    const engine = createAiEngine({ settings: access, keychain });
    const saved = await engine.saveConfig(
      {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        timeoutMs: 60000,
        updatedAt: ''
      },
      'sk-secret'
    );

    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('SECRET_STORAGE_UNAVAILABLE');
    }
    // Fail closed: the key is not persisted to plaintext.
    expect(access.store.has('ai.credentials')).toBe(false);
  });

  it('runs a generation task through the pipeline and emits lifecycle events', async () => {
    const access = memoryAccess({ 'ai.config': CONFIG_SEED });
    const events = collectEvents();
    const engine = createAiEngine({ settings: access, provider: stubProvider() });
    const schema = z.object({ name: z.string(), count: z.number() });
    const result = await engine.generate({
      taskName: 'component.synthesize',
      systemPrompt: 'system',
      payload: { html: '<div/>' },
      schema,
      maxRepairAttempts: 1
    });
    events.stop();

    expect(result.ok).toBe(true);
    expect(events.types).toEqual(['ai.generation_started', 'ai.generation_completed']);
  });

  it('emits ai.generation_failed when the pipeline cannot satisfy the schema', async () => {
    const access = memoryAccess({ 'ai.config': CONFIG_SEED });
    const events = collectEvents();
    const engine = createAiEngine({
      settings: access,
      provider: stubProvider({ chatCompletion: async () => response('{"name":"a"}') })
    });
    const schema = z.object({ name: z.string(), count: z.number() });
    const result = await engine.generate({
      taskName: 't',
      systemPrompt: 's',
      payload: {},
      schema,
      maxRepairAttempts: 0
    });
    events.stop();

    expect(result.ok).toBe(false);
    expect(events.types).toEqual(['ai.generation_started', 'ai.generation_failed']);
  });
});
