/**
 * AI engine type contracts - Artupski ReSite
 * Source of truth: docs/specs/AI-SPEC.md section 1 (IAIProvider) and section 3
 * (TokenBudgetManager / GenerationTask). These are the authoritative interfaces
 * the engine is built against; consumers (Phases 11+) depend on THIS module and
 * never on a concrete provider.
 */
import type { z } from 'zod';

/** Message roles accepted by OpenAI-compatible chat endpoints. */
export type AIMessageRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

/** Provider-agnostic completion options (AI-SPEC.md section 1.1). */
export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  stopSequences?: string[];
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

/**
 * Normalized finish reason. `abort`/`error` are engine-level outcomes so callers
 * never have to interpret provider-specific strings.
 */
export type AIFinishReason = 'stop' | 'length' | 'content_filter' | 'abort' | 'error';

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AICompletionResponse {
  content: string;
  usage: AIUsage;
  model: string;
  finishReason: AIFinishReason;
}

/** A vendor-neutral provider. The engine depends only on this interface. */
export interface IAIProvider {
  readonly id: string;
  readonly name: string;

  /** Verify the endpoint + credentials are usable (network round-trip). */
  validateCredentials(): Promise<{ valid: boolean; error?: string }>;
  /** List model ids advertised by the endpoint. */
  listModels(): Promise<string[]>;
  chatCompletion(
    messages: AIMessage[],
    options?: AICompletionOptions
  ): Promise<AICompletionResponse>;
  streamChatCompletion(
    messages: AIMessage[],
    onChunk: (chunk: string) => void,
    options?: AICompletionOptions
  ): Promise<AICompletionResponse>;
}

/** Construction config for the OpenAI-compatible provider (AI-SPEC.md 1.2). */
export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  organizationId?: string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/** Token budgeting profile for a model family (AI-SPEC.md 3.1). */
export interface ModelContextConfig {
  contextWindow: number;
  maxCompletionTokens: number;
  safetyMarginTokens: number;
}

/**
 * A single schema-constrained generation task. `schema` is any Zod schema; the
 * pipeline validates and repairs until it parses or the repair budget is spent.
 */
export interface GenerationTask<T> {
  taskName: string;
  systemPrompt: string;
  payload: Record<string, unknown>;
  schema: z.ZodSchema<T>;
  maxRepairAttempts: number;
}

/** Preset metadata surfaced by the settings UI (base URL + example model). */
export interface AIProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  /** True for endpoints that typically run on the local machine. */
  local: boolean;
  /** True when the endpoint generally requires (or accepts) a bearer key. */
  requiresApiKey: boolean;
  /** Human hint describing the auth header style from AI-SPEC.md 2.2. */
  authStyle: string;
}

/** Persisted, non-secret AI configuration stored in `app_settings`. */
export interface AIConfig {
  providerId: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  updatedAt: string;
}
