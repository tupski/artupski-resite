/**
 * OpenAI-compatible provider - Artupski ReSite
 * Source of truth: docs/specs/AI-SPEC.md section 1.2.
 *
 * A single client for any OpenAI-compatible REST endpoint (`/models`,
 * `/chat/completions`). It supports streaming (SSE) and non-streaming modes,
 * normalizes usage/finish reasons, enforces timeouts + abort, and maps every
 * failure onto a redacted `StructuredError` in the `ai` category.
 *
 * `fetch` is injected so tests exercise real request/response mapping without a
 * live network. The API key is never placed in any thrown message.
 */
import type {
  AICompletionOptions,
  AICompletionResponse,
  AIFinishReason,
  AIMessage,
  IAIProvider,
  ProviderConfig
} from '../../types/ai';
import { isRecord } from '../blueprint/util';
import { createAiError } from './errors';
import { normalizeBaseUrl } from './presets';

/** A minimal `fetch`-compatible signature (injectable for tests). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Resolve the ambient `fetch` with its receiver attached.
 *
 * `globalThis.fetch` is a host function: it MUST be invoked with the global
 * object as its `this`. Assigning it to a field and later calling it as
 * `this.fetchImpl(...)` detaches the receiver and the native implementation
 * throws `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
 * Binding the receiver once here is the root-cause fix. Injected fakes are used
 * as-is (they are ordinary closures and do not require a receiver).
 */
function resolveDefaultFetch(): FetchLike {
  const ambient: unknown = globalThis.fetch;
  if (typeof ambient !== 'function') {
    return ambient as FetchLike;
  }
  return (ambient as FetchLike).bind(globalThis);
}

/** True for the host-function receiver error thrown by a detached `fetch`. */
function isIllegalInvocation(error: unknown): boolean {
  return error instanceof TypeError && /illegal invocation/i.test(error.message);
}

/** Default request timeout when neither the option nor config supplies one. */
export const DEFAULT_TIMEOUT_MS = 60000;

/** Finish reasons a provider may return that we pass through unchanged. */
const KNOWN_FINISH_REASONS: readonly AIFinishReason[] = ['stop', 'length', 'content_filter'];

function toFinishReason(value: unknown): AIFinishReason {
  return typeof value === 'string' && (KNOWN_FINISH_REASONS as readonly string[]).includes(value)
    ? (value as AIFinishReason)
    : 'stop';
}

/** Read a bounded slice of an error body without ever echoing the request key. */
async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

export class OpenAICompatibleProvider implements IAIProvider {
  public readonly id = 'openai-compatible';
  public readonly name = 'OpenAI Compatible Gateway';

  private readonly config: ProviderConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: ProviderConfig, fetchImpl: FetchLike = resolveDefaultFetch()) {
    this.config = { timeoutMs: DEFAULT_TIMEOUT_MS, ...config };
    this.fetchImpl = fetchImpl;
  }

  async validateCredentials(): Promise<{ valid: boolean; error?: string }> {
    try {
      const models = await this.listModels();
      // An endpoint that responds with an (even empty) model list is reachable
      // and authorized. An empty list is NOT treated as a failure.
      void models;
      return { valid: true };
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Connection failed';
      return { valid: false, error: message };
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${normalizeBaseUrl(this.config.baseUrl)}/models`;
    const { response, cleanup } = await this.request(url, { method: 'GET' });
    try {
      if (!response.ok) {
        throw this.httpError(response.status, response.statusText, await readErrorBody(response));
      }
      const json: unknown = await response.json();
      if (!isRecord(json)) {
        return [];
      }
      const data = json.data;
      if (!Array.isArray(data)) {
        return [];
      }
      return data
        .map((entry) => (isRecord(entry) ? entry.id : undefined))
        .filter((id): id is string => typeof id === 'string');
    } finally {
      cleanup();
    }
  }

  async chatCompletion(
    messages: AIMessage[],
    options?: AICompletionOptions
  ): Promise<AICompletionResponse> {
    const url = `${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`;
    const model = options?.model ?? this.config.defaultModel;
    const payload = {
      model,
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens,
      response_format:
        options?.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
      stop: options?.stopSequences
    };

    const { response, cleanup } = await this.request(
      url,
      { method: 'POST', body: JSON.stringify(payload) },
      options
    );

    try {
      if (!response.ok) {
        throw this.httpError(response.status, response.statusText, await readErrorBody(response));
      }
      const json: unknown = await response.json();
      if (!isRecord(json)) {
        throw createAiError('MALFORMED_OUTPUT', 'Provider returned a non-object completion body.');
      }
      const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
      const choiceRecord = isRecord(choice) ? choice : undefined;
      const message =
        choiceRecord && isRecord(choiceRecord.message) ? choiceRecord.message : undefined;
      const content = message && typeof message.content === 'string' ? message.content : '';
      const usage = isRecord(json.usage) ? json.usage : {};

      return {
        content,
        usage: {
          promptTokens: numberOrZero(usage.prompt_tokens),
          completionTokens: numberOrZero(usage.completion_tokens),
          totalTokens: numberOrZero(usage.total_tokens)
        },
        model: typeof json.model === 'string' ? json.model : model,
        finishReason: toFinishReason(choiceRecord?.finish_reason)
      };
    } finally {
      cleanup();
    }
  }

  async streamChatCompletion(
    messages: AIMessage[],
    onChunk: (chunk: string) => void,
    options?: AICompletionOptions
  ): Promise<AICompletionResponse> {
    const url = `${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`;
    const model = options?.model ?? this.config.defaultModel;
    const payload = {
      model,
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens,
      stream: true,
      response_format:
        options?.responseFormat === 'json_object' ? { type: 'json_object' } : undefined
    };

    const { response, cleanup } = await this.request(
      url,
      { method: 'POST', body: JSON.stringify(payload) },
      options
    );

    try {
      if (!response.ok || !response.body) {
        throw this.httpError(response.status, response.statusText, await readErrorBody(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';
      let buffer = '';
      let finishReason: AIFinishReason = 'stop';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            continue;
          }
          try {
            const parsed: unknown = JSON.parse(dataStr);
            if (!isRecord(parsed)) {
              continue;
            }
            const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
            const choice = isRecord(choices[0]) ? choices[0] : undefined;
            const delta = choice && isRecord(choice.delta) ? choice.delta : undefined;
            if (delta && typeof delta.content === 'string' && delta.content) {
              fullText += delta.content;
              onChunk(delta.content);
            }
            if (choice && typeof choice.finish_reason === 'string') {
              finishReason = toFinishReason(choice.finish_reason);
            }
          } catch {
            // Ignore partial frames still in flight.
          }
        }
      }

      return {
        content: fullText,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model,
        finishReason
      };
    } finally {
      cleanup();
    }
  }

  /** Build request headers. The key is applied here and nowhere else. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    if (this.config.organizationId) {
      headers['OpenAI-Organization'] = this.config.organizationId;
    }
    if (this.config.customHeaders) {
      Object.assign(headers, this.config.customHeaders);
    }
    return headers;
  }

  /**
   * Perform a request with a timeout + abort signal. Returns a cleanup function
   * that clears the timer and detaches the abort listener. Transport failures
   * are mapped to redacted structured errors.
   */
  private async request(
    url: string,
    init: { method: string; body?: string },
    options?: AICompletionOptions
  ): Promise<{ response: Response; cleanup: () => void }> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    options?.abortSignal?.addEventListener('abort', onExternalAbort);

    const cleanup = () => {
      clearTimeout(timer);
      options?.abortSignal?.removeEventListener('abort', onExternalAbort);
    };

    try {
      const response = await this.fetchImpl(url, {
        method: init.method,
        headers: this.buildHeaders(),
        body: init.body,
        signal: controller.signal
      });
      return { response, cleanup };
    } catch (error) {
      cleanup();
      if (options?.abortSignal?.aborted) {
        throw createAiError('USER_CANCELLED', 'AI request was cancelled.');
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw createAiError('CONNECTION_TIMED_OUT', `AI request timed out after ${timeoutMs}ms.`, {
          retryable: true,
          cause: error
        });
      }
      if (isIllegalInvocation(error)) {
        // A detached `fetch` (lost `this`) is a client-side binding bug, NOT a
        // network/reachability problem. Say so explicitly so the message is
        // actionable instead of blaming the endpoint.
        throw createAiError(
          'IPC_ERROR',
          'AI request failed: fetch was invoked without its window receiver (Illegal invocation). ' +
            'This is a client-side binding bug, not an endpoint problem.',
          {
            retryable: false,
            recoveryHint:
              'This is a client-side fetch binding bug, not a reachability issue. The endpoint and key are not the cause.',
            cause: error
          }
        );
      }
      throw createAiError(
        'IPC_ERROR',
        `AI request failed: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true, cause: error }
      );
    }
  }

  /** Map an HTTP status + bounded body excerpt to a redacted `StructuredError`. */
  private httpError(status: number, statusText: string, body: string) {
    const suffix = body ? ` - ${body}` : '';
    if (status === 401 || status === 403) {
      return createAiError(
        'API_KEY_INVALID',
        `Authentication failed [${status} ${statusText}]${suffix}`
      );
    }
    if (status === 429) {
      return createAiError('RATE_LIMIT_EXCEEDED', `Rate limited [429]${suffix}`);
    }
    if (status === 413) {
      return createAiError('CONTEXT_LENGTH_EXCEEDED', `Payload too large [413]${suffix}`);
    }
    if (status === 400 && /context|token|length/i.test(body)) {
      return createAiError('CONTEXT_LENGTH_EXCEEDED', `Context length exceeded [400]${suffix}`);
    }
    return createAiError('IPC_ERROR', `AI request failed [${status} ${statusText}]${suffix}`);
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
