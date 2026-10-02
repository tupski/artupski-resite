/**
 * Token budget manager - Artupski ReSite
 * Source of truth: docs/specs/AI-SPEC.md section 3.1.
 *
 * A pure, dependency-free estimator used to guard a prompt against a model's
 * usable input budget before any network call. The heuristic (~3.8 chars/token)
 * intentionally over-estimates volatile markup so a payload that "fits" here is
 * very unlikely to be rejected by the provider for length.
 */
import type { ModelContextConfig } from '../../types/ai';

/** Per-model context profiles (AI-SPEC.md section 3.1). */
export const MODEL_BUDGET_PROFILES: Record<string, ModelContextConfig> = {
  default: { contextWindow: 8192, maxCompletionTokens: 2048, safetyMarginTokens: 512 },
  'gpt-4o': { contextWindow: 128000, maxCompletionTokens: 4096, safetyMarginTokens: 2048 },
  'gpt-4o-mini': { contextWindow: 128000, maxCompletionTokens: 4096, safetyMarginTokens: 2048 },
  'claude-3.5-sonnet': {
    contextWindow: 200000,
    maxCompletionTokens: 8192,
    safetyMarginTokens: 4096
  },
  'qwen2.5-coder:32b': { contextWindow: 32768, maxCompletionTokens: 4096, safetyMarginTokens: 1024 }
};

/** The fallback profile, extracted so index access stays well-typed. */
export const DEFAULT_BUDGET_PROFILE: ModelContextConfig = {
  contextWindow: 8192,
  maxCompletionTokens: 2048,
  safetyMarginTokens: 512
};

/** Characters-per-token heuristic for source/markup (AI-SPEC.md section 3.1). */
export const CHARS_PER_TOKEN = 3.8;

export class TokenBudgetManager {
  private readonly config: ModelContextConfig;

  constructor(model: string) {
    this.config = MODEL_BUDGET_PROFILES[model] ?? DEFAULT_BUDGET_PROFILE;
  }

  /** The active profile (exposed for diagnostics/tests). */
  getConfig(): ModelContextConfig {
    return this.config;
  }

  /** Fast heuristic token estimation (~3.8 chars/token). */
  estimateTokenCount(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /** Tokens available for input after reserving completion + safety margin. */
  getUsableInputBudget(): number {
    return (
      this.config.contextWindow - this.config.maxCompletionTokens - this.config.safetyMarginTokens
    );
  }

  /** True when the system prompt + user payload fit within the usable budget. */
  fitsInContext(systemPrompt: string, userPayload: string): boolean {
    const total = this.estimateTokenCount(systemPrompt) + this.estimateTokenCount(userPayload);
    return total <= this.getUsableInputBudget();
  }
}
