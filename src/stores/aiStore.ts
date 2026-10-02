/**
 * AI store - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-10-impl-plan.md sections 3, 8, 9.
 *
 * Honest UI state for the Phase 10 AI engine. Persisted configuration
 * (`app_settings`) is the source of truth for the saved settings; the health
 * check reflects the LAST real network round-trip. It NEVER fabricates a
 * "connected" state: a missing endpoint is `unconfigured`, a failed check is
 * `error` with the real code/message, and only a verified round-trip is `ready`.
 * The API key is held in local state only to seed the input; it is never logged.
 */
import { create } from 'zustand';
import type { AIConfig } from '../types/ai';
import { eventBus } from '../services/infra/eventBus';
import { logger } from '../services/infra/logger';
import { createAiEngine, type AiEngine } from '../services/ai';

/**
 * Honest connection lifecycle:
 *   unconfigured - no endpoint configured yet
 *   idle         - configured, but not yet verified this session
 *   testing      - a health check is in flight
 *   ready        - the last health check succeeded
 *   error        - the last health check failed
 */
export type AiConnectionStatus = 'unconfigured' | 'idle' | 'testing' | 'ready' | 'error';

export interface AiStoreError {
  code: string;
  message: string;
  suggestedAction: string;
}

export interface AiState {
  status: AiConnectionStatus;
  config: AIConfig;
  /** Transient input value; never persisted, never logged, never emitted. */
  apiKeyInput: string;
  /** True when a key is already stored (drives the "key saved" hint). */
  hasStoredKey: boolean;
  models: string[];
  error: AiStoreError | null;
  lastVerifiedAt: string | null;
  loading: boolean;

  loadConfig: () => Promise<void>;
  setConfigField: <K extends keyof AIConfig>(key: K, value: AIConfig[K]) => void;
  setApiKeyInput: (value: string) => void;
  saveConfig: (options?: { saveApiKey?: boolean }) => Promise<boolean>;
  testConnection: () => Promise<boolean>;
  reset: () => void;
}

const INITIAL_CONFIG: AIConfig = {
  providerId: 'openai',
  baseUrl: '',
  model: '',
  timeoutMs: 60000,
  updatedAt: ''
};

const IDLE_STATE = {
  status: 'unconfigured' as AiConnectionStatus,
  config: INITIAL_CONFIG,
  apiKeyInput: '',
  hasStoredKey: false,
  models: [] as string[],
  error: null as AiStoreError | null,
  lastVerifiedAt: null as string | null,
  loading: false
};

/** Default engine; tests inject a custom engine via `setEngineForTests`. */
let engine: AiEngine = createAiEngine();

/** Test seam: replace the engine used by the store. */
export function setEngineForTests(next: AiEngine | null): void {
  engine = next ?? createAiEngine();
}

function toStoreError(error: {
  code: string;
  message: string;
  suggestedAction: string;
}): AiStoreError {
  return { code: error.code, message: error.message, suggestedAction: error.suggestedAction };
}

export const useAiStore = create<AiState>()((set, get) => ({
  ...IDLE_STATE,

  loadConfig: async () => {
    set({ loading: true, error: null });
    try {
      const config = await engine.loadConfig();
      const configured = Boolean(config.baseUrl && config.model);
      set((state) => ({
        config,
        loading: false,
        status: configured
          ? state.status === 'unconfigured'
            ? 'idle'
            : state.status
          : 'unconfigured'
      }));
    } catch (error) {
      logger.child('ai').warn('Failed to load AI configuration', { error: String(error) });
      set({ loading: false });
    }
  },

  setConfigField: (key, value) => set((state) => ({ config: { ...state.config, [key]: value } })),

  setApiKeyInput: (value) => set({ apiKeyInput: value }),

  saveConfig: async (options) => {
    set({ loading: true, error: null });
    const config = { ...get().config, updatedAt: new Date().toISOString() };
    const saveApiKey = options?.saveApiKey ?? true;
    const result = await engine.saveConfig(config, saveApiKey ? get().apiKeyInput : undefined);

    if (!result.ok) {
      set({ loading: false, error: toStoreError(result.error) });
      return false;
    }

    const configured = Boolean(result.config.baseUrl && result.config.model);
    set({
      loading: false,
      config: result.config,
      hasStoredKey: result.hasApiKey,
      // Entering a new configuration invalidates any prior "ready" badge.
      status: configured ? 'idle' : 'unconfigured',
      models: [],
      lastVerifiedAt: null,
      error: null
    });
    if (saveApiKey) {
      set({ apiKeyInput: '' });
    }
    return true;
  },

  testConnection: async () => {
    const { config } = get();
    if (!config.baseUrl || !config.model) {
      set({
        status: 'unconfigured',
        error: {
          code: 'API_KEY_INVALID',
          message: 'Set a base URL and model before testing the connection.',
          suggestedAction: 'Fill in the endpoint and model, then save.'
        }
      });
      return false;
    }

    set({ status: 'testing', error: null });
    const result = await engine.healthCheck();

    if (result.valid) {
      set({
        status: 'ready',
        models: result.models,
        error: null,
        lastVerifiedAt: new Date().toISOString()
      });
      return true;
    }

    set({
      status: 'error',
      models: [],
      error: result.error
        ? toStoreError(result.error)
        : { code: 'UNKNOWN_ERROR', message: 'Connection failed.', suggestedAction: 'Retry.' }
    });
    return false;
  },

  reset: () => {
    set({ ...IDLE_STATE, config: INITIAL_CONFIG });
  }
}));

/**
 * Mirror bounded `ai.*` events so the panel can reflect connection state without
 * polling. The listener receives only ids/counts - never the API key.
 */
export function watchAiEvents(): () => void {
  const unsubscribers = [
    eventBus.on('ai.connection_started', () => {
      if (useAiStore.getState().status !== 'testing') {
        useAiStore.setState({ status: 'testing' });
      }
    }),
    eventBus.on('ai.connection_verified', (event) => {
      useAiStore.setState({
        status: 'ready',
        lastVerifiedAt: event.payload.timestamp,
        error: null
      });
    }),
    eventBus.on('ai.connection_failed', (event) => {
      useAiStore.setState({
        status: 'error',
        error: {
          code: event.payload.code,
          message: event.payload.message,
          suggestedAction: 'Review the endpoint and key, then retry the connection test.'
        }
      });
    })
  ];
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
