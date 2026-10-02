import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AIConfig } from '../types/ai';
import { createAiError } from '../services/ai';
import type { AiEngine } from '../services/ai';
import { setEngineForTests, useAiStore, watchAiEvents } from './aiStore';
import { eventBus } from '../services/infra/eventBus';

const CONFIGURED: AIConfig = {
  providerId: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.1:8b',
  timeoutMs: 60000,
  updatedAt: '2026-01-01T00:00:00.000Z'
};

function fakeEngine(overrides: Partial<AiEngine> = {}): AiEngine {
  return {
    loadConfig: async () => CONFIGURED,
    saveConfig: async (config) => ({ ok: true, config, hasApiKey: false }),
    isConfigured: async () => true,
    healthCheck: async () => ({ valid: true, providerId: 'ollama', models: ['llama3.1:8b'] }),
    chatCompletion: async () => ({
      ok: true,
      data: {
        content: '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: 'm',
        finishReason: 'stop'
      }
    }),
    generate: async () => ({
      ok: false,
      attempts: 0,
      error: createAiError('MALFORMED_OUTPUT', 'n/a')
    }),
    ...overrides
  };
}

describe('aiStore', () => {
  beforeEach(() => {
    useAiStore.getState().reset();
    setEngineForTests(fakeEngine());
  });

  afterEach(() => {
    setEngineForTests(null);
    eventBus.clear();
  });

  it('starts unconfigured with no fabricated connection', () => {
    expect(useAiStore.getState().status).toBe('unconfigured');
    expect(useAiStore.getState().models).toEqual([]);
    expect(useAiStore.getState().lastVerifiedAt).toBeNull();
  });

  it('loads persisted config and moves to idle when configured', async () => {
    await useAiStore.getState().loadConfig();
    expect(useAiStore.getState().config.baseUrl).toBe('http://localhost:11434/v1');
    expect(useAiStore.getState().status).toBe('idle');
  });

  it('marks the store unconfigured when the loaded config lacks an endpoint', async () => {
    setEngineForTests(
      fakeEngine({ loadConfig: async () => ({ ...CONFIGURED, baseUrl: '', model: '' }) })
    );
    await useAiStore.getState().loadConfig();
    expect(useAiStore.getState().status).toBe('unconfigured');
  });

  it('reports a successful health check as ready with real models', async () => {
    await useAiStore.getState().loadConfig();
    const ok = await useAiStore.getState().testConnection();
    expect(ok).toBe(true);
    expect(useAiStore.getState().status).toBe('ready');
    expect(useAiStore.getState().models).toEqual(['llama3.1:8b']);
    expect(useAiStore.getState().lastVerifiedAt).toBeTruthy();
  });

  it('reports a failed health check honestly with the real code', async () => {
    setEngineForTests(
      fakeEngine({
        healthCheck: async () => ({
          valid: false,
          providerId: 'ollama',
          models: [],
          error: createAiError('IPC_ERROR', 'unreachable')
        })
      })
    );
    await useAiStore.getState().loadConfig();
    const ok = await useAiStore.getState().testConnection();
    expect(ok).toBe(false);
    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().error?.code).toBe('IPC_ERROR');
    expect(useAiStore.getState().models).toEqual([]);
  });

  it('refuses to test an unconfigured endpoint without a network call', async () => {
    let called = false;
    setEngineForTests(
      fakeEngine({
        loadConfig: async () => ({ ...CONFIGURED, baseUrl: '', model: '' }),
        healthCheck: async () => {
          called = true;
          return { valid: true, providerId: 'x', models: [] };
        }
      })
    );
    await useAiStore.getState().loadConfig();
    const ok = await useAiStore.getState().testConnection();
    expect(ok).toBe(false);
    expect(called).toBe(false);
    expect(useAiStore.getState().status).toBe('unconfigured');
  });

  it('saving a new configuration resets a previously verified state', async () => {
    await useAiStore.getState().loadConfig();
    await useAiStore.getState().testConnection();
    expect(useAiStore.getState().status).toBe('ready');

    useAiStore.getState().setConfigField('model', 'other-model');
    await useAiStore.getState().saveConfig();
    expect(useAiStore.getState().status).toBe('idle');
    expect(useAiStore.getState().lastVerifiedAt).toBeNull();
  });

  it('clears the transient key input after a save that included a key', async () => {
    setEngineForTests(
      fakeEngine({
        saveConfig: async (config) => ({ ok: true, config, hasApiKey: true })
      })
    );
    useAiStore.getState().setApiKeyInput('sk-temp');
    await useAiStore.getState().saveConfig({ saveApiKey: true });
    expect(useAiStore.getState().apiKeyInput).toBe('');
    expect(useAiStore.getState().hasStoredKey).toBe(true);
  });

  it('mirrors ai.* events into connection state', () => {
    const stop = watchAiEvents();
    eventBus.emit({
      type: 'ai.connection_failed',
      payload: {
        eventId: 'e1',
        timestamp: new Date().toISOString(),
        domain: 'ai',
        providerId: 'ollama',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'slow down'
      }
    });
    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().error?.code).toBe('RATE_LIMIT_EXCEEDED');
    stop();
  });
});
