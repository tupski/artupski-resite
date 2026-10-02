/**
 * AI engine entrypoint - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-10-impl-plan.md sections 3 and 9.
 *
 * The service-layer seam the store/UI (and, in later phases, the synthesis
 * pipeline) calls. It resolves persisted configuration + key into a provider,
 * performs health checks, and delegates schema-constrained generation to the
 * `GenerationPipeline`. It emits bounded `ai.*` events that NEVER contain the
 * API key, request headers, or prompt/completion content.
 *
 * Every operation returns a discriminated result and never throws.
 */
import type {
  AICompletionOptions,
  AICompletionResponse,
  AIConfig,
  AIMessage,
  GenerationTask
} from '../../types/ai';
import type { StructuredError } from '../infra/errors';
import { createEvent, eventBus } from '../infra/eventBus';
import { logger } from '../infra/logger';
import {
  createProviderFromConfig,
  loadAIConfig,
  loadAIKey,
  saveAIConfig,
  saveAIKey,
  type AISettingsAccess
} from './config';
import { createAiError } from './errors';
import { GenerationPipeline, type PipelineResult } from './pipeline';
import { getPreset } from './presets';
import { TokenBudgetManager } from './tokenBudget';
import type { IAIProvider } from '../../types/ai';
import type { FetchLike } from './provider';

const log = logger.child('ai');

export interface AiHealthResult {
  valid: boolean;
  providerId: string;
  models: string[];
  error?: StructuredError;
}

export type AiSaveConfigResult =
  { ok: true; config: AIConfig; hasApiKey: boolean } | { ok: false; error: StructuredError };

export interface AiEngineDeps {
  /** Settings access override (tests). Defaults to the live storage layer. */
  settings?: AISettingsAccess;
  /** fetch override (tests). */
  fetchImpl?: FetchLike;
  /** Provider override (tests) - bypasses config resolution entirely. */
  provider?: IAIProvider;
}

export interface AiEngine {
  loadConfig(): Promise<AIConfig>;
  saveConfig(config: AIConfig, apiKey?: string): Promise<AiSaveConfigResult>;
  /** True when a usable endpoint + model are configured. */
  isConfigured(): Promise<boolean>;
  healthCheck(): Promise<AiHealthResult>;
  chatCompletion(
    messages: AIMessage[],
    options?: AICompletionOptions
  ): Promise<{ ok: true; data: AICompletionResponse } | { ok: false; error: StructuredError }>;
  /** Schema-constrained generation with bounded repair (Phase 11 consumer). */
  generate<T>(task: GenerationTask<T>): Promise<PipelineResult<T>>;
}

/** Resolve a provider from config + key, or null when unconfigured. */
async function resolveProvider(deps: AiEngineDeps): Promise<{
  provider: IAIProvider | null;
  config: AIConfig;
}> {
  const config = await loadAIConfig(deps.settings);
  if (deps.provider) {
    return { provider: deps.provider, config };
  }
  const key = await loadAIKey(deps.settings);
  const apiKey = key.ok ? key.apiKey : null;
  const provider = createProviderFromConfig(config, apiKey, deps.fetchImpl);
  return { provider, config };
}

export function createAiEngine(deps: AiEngineDeps = {}): AiEngine {
  return {
    loadConfig: () => loadAIConfig(deps.settings),

    saveConfig: async (config, apiKey) => {
      const saved = await saveAIConfig(config, deps.settings);
      if (!saved.ok) {
        return { ok: false, error: saved.error };
      }
      let hasApiKey = false;
      if (apiKey !== undefined) {
        try {
          await saveAIKey(apiKey, deps.settings);
        } catch (error) {
          return {
            ok: false,
            error: createAiError('IPC_ERROR', 'Failed to persist the API key.', { cause: error })
          };
        }
        hasApiKey = Boolean(apiKey);
      } else {
        const existing = await loadAIKey(deps.settings);
        hasApiKey = existing.ok && Boolean(existing.apiKey);
      }

      eventBus.emit(
        createEvent('ai.config_saved', {
          providerId: config.providerId,
          hasApiKey,
          model: config.model
        })
      );

      return { ok: true, config, hasApiKey };
    },

    isConfigured: async () => {
      const { provider } = await resolveProvider(deps);
      return provider !== null;
    },

    healthCheck: async () => {
      const { provider, config } = await resolveProvider(deps);
      eventBus.emit(createEvent('ai.connection_started', { providerId: config.providerId }));

      if (!provider) {
        const error = createAiError('API_KEY_INVALID', 'No AI endpoint is configured.', {
          recoveryHint: 'Set a base URL and model in Settings before testing the connection.'
        });
        eventBus.emit(
          createEvent('ai.connection_failed', {
            providerId: config.providerId,
            code: error.code,
            message: error.message
          })
        );
        return { valid: false, providerId: config.providerId, models: [], error };
      }

      try {
        const models = await provider.listModels();
        eventBus.emit(
          createEvent('ai.connection_verified', {
            providerId: config.providerId,
            modelCount: models.length
          })
        );
        return { valid: true, providerId: config.providerId, models };
      } catch (error) {
        const structured = asAiError(error, 'AI connection check failed.');
        log.warn('AI health check failed', {
          providerId: config.providerId,
          code: structured.code
        });
        eventBus.emit(
          createEvent('ai.connection_failed', {
            providerId: config.providerId,
            code: structured.code,
            message: structured.message
          })
        );
        return { valid: false, providerId: config.providerId, models: [], error: structured };
      }
    },

    chatCompletion: async (messages, options) => {
      const { provider, config } = await resolveProvider(deps);
      if (!provider) {
        return {
          ok: false,
          error: createAiError('API_KEY_INVALID', 'No AI endpoint is configured.')
        };
      }
      try {
        const data = await provider.chatCompletion(messages, options);
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: asAiError(error, `AI request failed for ${config.model}.`) };
      }
    },

    generate: async <T>(task: GenerationTask<T>) => {
      const { provider, config } = await resolveProvider(deps);
      const taskName = task.taskName;
      if (!provider) {
        return {
          ok: false,
          attempts: 0,
          error: createAiError('API_KEY_INVALID', 'No AI endpoint is configured.')
        };
      }
      eventBus.emit(
        createEvent('ai.generation_started', { providerId: config.providerId, taskName })
      );
      const pipeline = new GenerationPipeline(
        provider,
        new TokenBudgetManager(config.model || getPreset(config.providerId).defaultModel)
      );
      const result = await pipeline.executeTask(task);
      if (result.ok) {
        eventBus.emit(
          createEvent('ai.generation_completed', {
            providerId: config.providerId,
            taskName,
            attempts: result.attempts,
            totalTokens: 0
          })
        );
      } else {
        eventBus.emit(
          createEvent('ai.generation_failed', {
            providerId: config.providerId,
            taskName,
            code: result.error.code,
            message: result.error.message
          })
        );
      }
      return result;
    }
  };
}

/** Normalize any thrown value to an AI-category structured error. */
function asAiError(error: unknown, fallbackMessage: string): StructuredError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    (error as { category?: unknown }).category === 'ai' &&
    'code' in error
  ) {
    return error as StructuredError;
  }
  return createAiError('MALFORMED_OUTPUT', fallbackMessage, { cause: error });
}
