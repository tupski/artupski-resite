/**
 * Provider presets & base-URL policy - Artupski ReSite
 * Source of truth: docs/specs/AI-SPEC.md section 2.2 (compatible provider matrix)
 * and docs/architecture/TECH-STACK.md section 2.
 *
 * The matrix is descriptive metadata for the settings UI and for base-URL
 * defaults. It performs NO network work. `normalizeBaseUrl` / `validateBaseUrl`
 * are pure and are the single place base-URL policy is enforced.
 */
import type { AIProviderPreset } from '../../types/ai';

/** The OpenAI-compatible provider preset matrix (AI-SPEC.md section 2.2). */
export const PROVIDER_PRESETS: readonly AIProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    local: false,
    requiresApiKey: true,
    authStyle: 'Bearer sk-...'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    local: false,
    requiresApiKey: true,
    authStyle: 'Bearer sk-or-...'
  },
  {
    id: '9router',
    name: '9Router',
    baseUrl: 'https://api.9router.com/v1',
    defaultModel: 'gpt-4o',
    local: false,
    requiresApiKey: true,
    authStyle: 'Bearer 9r-...'
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1:8b',
    local: true,
    requiresApiKey: false,
    authStyle: 'None / Dummy string'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'deepseek-coder-v2-lite-instruct',
    local: true,
    requiresApiKey: false,
    authStyle: 'None / Dummy string'
  },
  {
    id: 'localai',
    name: 'LocalAI / vLLM',
    baseUrl: 'http://localhost:8080/v1',
    defaultModel: 'local-model',
    local: true,
    requiresApiKey: false,
    authStyle: 'Optional API Key'
  }
];

/** The fallback preset used when persisted config references an unknown id. */
export const CUSTOM_PRESET: AIProviderPreset = {
  id: 'custom',
  name: 'Custom OpenAI-Compatible',
  baseUrl: '',
  defaultModel: '',
  local: false,
  requiresApiKey: false,
  authStyle: 'Optional API Key'
};

/** Look up a preset by id, falling back to the custom descriptor. */
export function getPreset(id: string): AIProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? CUSTOM_PRESET;
}

/** Remove trailing slashes so `${base}/chat/completions` never double-slashes. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export interface BaseUrlValidation {
  valid: boolean;
  /** Present when invalid; a user-facing reason. */
  error?: string;
}

/**
 * Validate a user-supplied base URL.
 *
 * Enforced: absolute http(s) URL, no embedded credentials, no whitespace. The
 * engine never follows arbitrary URLs from page content, so this is the only
 * place a remote origin can enter the system - rejecting credentials-in-URL
 * prevents a leaked key from being stored inside the base URL itself.
 */
export function validateBaseUrl(url: string): BaseUrlValidation {
  const trimmed = url.trim();
  if (!trimmed) {
    return { valid: false, error: 'Base URL is required.' };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, error: 'Base URL must not contain whitespace.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Base URL must be an absolute http(s) URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Base URL must use http or https.' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Base URL must not embed credentials (use the API key field).' };
  }

  return { valid: true };
}
