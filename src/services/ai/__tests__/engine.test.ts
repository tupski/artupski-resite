import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AICompletionResponse, IAIProvider } from '../../../types/ai';
import { createAiEngine } from '../engine';
import type { AISettingsAccess } from '../config';
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

  it('saves config and key and emits ai.config_saved with hasApiKey only', async () => {
    const access = memoryAccess();
    const events = collectEvents();
    const engine = createAiEngine({ settings: access });
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
    // The secret must live only in the credentials key, never the config blob.
    expect(access.store.get('ai.config')).not.toContain('sk-secret');
    expect(access.store.get('ai.credentials')).toContain('sk-secret');
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
