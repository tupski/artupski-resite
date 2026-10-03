/**
 * AI engine - public surface - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-10-impl-plan.md section 3.
 *
 * Consumers import from here; the individual modules and the concrete provider
 * implementation stay private so Phases 11+ depend on the `IAIProvider`
 * contract, not a vendor.
 */
export {
  createAiEngine,
  type AiEngine,
  type AiEngineDeps,
  type AiHealthResult,
  type AiSaveConfigResult
} from './engine';

export { OpenAICompatibleProvider, DEFAULT_TIMEOUT_MS, type FetchLike } from './provider';

export {
  PROVIDER_PRESETS,
  CUSTOM_PRESET,
  getPreset,
  normalizeBaseUrl,
  validateBaseUrl,
  type BaseUrlValidation
} from './presets';

export { TokenBudgetManager, MODEL_BUDGET_PROFILES, CHARS_PER_TOKEN } from './tokenBudget';

export { GenerationPipeline, extractJson, type PipelineResult } from './pipeline';

export {
  sanitizePayload,
  escapeBoundary,
  buildUserMessageContent,
  DATA_PAYLOAD_OPEN,
  DATA_PAYLOAD_CLOSE,
  MAX_DATA_URI_LENGTH
} from './payload';

export { SYSTEM_PROMPT_BASE, buildSystemPrompt } from './prompts/systemPrompt';

export { createAiError, isAiError } from './errors';

export {
  loadAIConfig,
  saveAIConfig,
  loadAIKey,
  saveAIKey,
  createProviderFromConfig,
  DEFAULT_AI_CONFIG,
  DEFAULT_PROVIDER_ACCOUNT,
  AI_CONFIG_KEY,
  AI_CREDENTIALS_KEY,
  type AIConfigResult,
  type AIKeyResult,
  type AIKeyWriteResult,
  type AICredentials,
  type AISettingsAccess,
  type AIKeychainAccess
} from './config';
