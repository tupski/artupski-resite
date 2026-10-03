import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider, type FetchLike } from '../provider';

/** Build a Response-like object without depending on a live server. */
function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {}
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: stream
  } as unknown as Response;
}

const CONFIG = {
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'sk-secret-value',
  defaultModel: 'gpt-4o-mini'
};

describe('OpenAICompatibleProvider.chatCompletion (AI-SPEC.md 1.2)', () => {
  it('maps a completion response, usage, and finish reason', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o-mini'
      });
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    const result = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('{"ok":true}');
    expect(result.usage.totalTokens).toBe(15);
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('sends the bearer token and normalizes the base URL (no double slash)', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenAuth = String((init?.headers as Record<string, string>).Authorization);
      return jsonResponse({ choices: [{ message: { content: 'x' } }] });
    };
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    expect(seenUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(seenAuth).toBe('Bearer sk-secret-value');
  });

  it('maps 401 to API_KEY_INVALID without leaking the key', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    await expect(provider.chatCompletion([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'API_KEY_INVALID',
      category: 'ai'
    });
    try {
      await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    } catch (error) {
      expect((error as { message: string }).message).not.toContain('sk-secret-value');
    }
  });

  it('maps 429 to RATE_LIMIT_EXCEEDED', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse('slow down', { status: 429, statusText: 'Too Many Requests' });
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    await expect(provider.chatCompletion([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED'
    });
  });

  it('maps a context-length 400 to CONTEXT_LENGTH_EXCEEDED', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse('maximum context length exceeded', { status: 400, statusText: 'Bad Request' });
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    await expect(provider.chatCompletion([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'CONTEXT_LENGTH_EXCEEDED'
    });
  });
});

describe('OpenAICompatibleProvider.streamChatCompletion (SSE)', () => {
  it('assembles streamed deltas and invokes onChunk per delta', async () => {
    const fetchImpl: FetchLike = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"a\\":"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"1}"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n'
      ]);
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    const received: string[] = [];
    const result = await provider.streamChatCompletion([{ role: 'user', content: 'hi' }], (chunk) =>
      received.push(chunk)
    );
    expect(received.join('')).toBe('{"a":1}');
    expect(result.content).toBe('{"a":1}');
    expect(result.finishReason).toBe('stop');
  });
});

describe('OpenAICompatibleProvider.listModels / validateCredentials', () => {
  it('lists model ids from the /models endpoint', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] });
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    expect(await provider.listModels()).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('validateCredentials is valid on a reachable endpoint even with no models', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ data: [] });
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    expect(await provider.validateCredentials()).toEqual({ valid: true });
  });

  it('validateCredentials reports an error when the endpoint fails', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ error: 'nope' }, { status: 403, statusText: 'Forbidden' });
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    const result = await provider.validateCredentials();
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('OpenAICompatibleProvider default fetch receiver (Illegal invocation regression)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the global fetch with the global object as its receiver', async () => {
    const receivers: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      function (this: unknown) {
        receivers.push(this);
        return Promise.resolve(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
      }
    );

    // Construct WITHOUT an injected fetch so the provider resolves the default.
    const provider = new OpenAICompatibleProvider(CONFIG);
    await provider.chatCompletion([{ role: 'user', content: 'hi' }]);

    expect(receivers).toHaveLength(1);
    // A detached reference (`const f = globalThis.fetch; f(url)`) would set the
    // receiver to `undefined`/the provider, which the native fetch rejects with
    // "Illegal invocation". The default must keep `globalThis` as receiver.
    expect(receivers[0]).toBe(globalThis);
  });

  it('does not throw Illegal invocation when the native fetch is a strict host function', async () => {
    vi.stubGlobal(
      'fetch',
      function (this: unknown) {
        if (this !== globalThis) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        return Promise.resolve(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
      }
    );

    const provider = new OpenAICompatibleProvider(CONFIG);
    await expect(provider.chatCompletion([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      content: 'ok'
    });
  });
});

describe('OpenAICompatibleProvider transport failures', () => {
  it('maps a network error to a retryable ai-category error', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    await expect(provider.chatCompletion([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'IPC_ERROR',
      category: 'ai',
      retryable: true
    });
  });

  it('maps a browser "Failed to fetch" TypeError to a retryable IPC_ERROR (not an Illegal invocation)', async () => {
    // A cross-origin request blocked by the webview (e.g. a missing CSP
    // `connect-src`) rejects with `TypeError: Failed to fetch`. That is a
    // reachability/transport failure, NOT a detached-fetch binding bug, so the
    // guidance must still point at the endpoint.
    const fetchImpl: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    try {
      await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
      throw new Error('expected chatCompletion to reject');
    } catch (error) {
      const structured = error as {
        code: string;
        message: string;
        retryable: boolean;
        suggestedAction: string;
      };
      expect(structured.code).toBe('IPC_ERROR');
      expect(structured.retryable).toBe(true);
      expect(structured.message).not.toContain('Illegal invocation');
      expect(structured.suggestedAction.toLowerCase()).toContain('reachable');
    }
  });

  it('maps a timeout (AbortError) to CONNECTION_TIMED_OUT', async () => {
    const fetchImpl: FetchLike = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    await expect(provider.chatCompletion([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'CONNECTION_TIMED_OUT'
    });
  });

  it('maps a detached-fetch (Illegal invocation) failure to an accurate, non-reachability error', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    };
    const provider = new OpenAICompatibleProvider(CONFIG, fetchImpl);
    try {
      await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
      throw new Error('expected chatCompletion to reject');
    } catch (error) {
      const structured = error as { code: string; message: string; suggestedAction: string };
      expect(structured.code).toBe('IPC_ERROR');
      // The message must name the real cause, not a network/reachability problem.
      expect(structured.message.toLowerCase()).toContain('receiver');
      expect(structured.suggestedAction.toLowerCase()).not.toContain('reachable');
    }
  });
});

describe('OpenAICompatibleProvider endpoint URL assembly', () => {
  function captureUrl(): { url: () => string; fetchImpl: FetchLike } {
    let seen = '';
    return {
      url: () => seen,
      fetchImpl: async (url) => {
        seen = url;
        return jsonResponse({ choices: [{ message: { content: 'x' } }], data: [] });
      }
    };
  }

  it.each([
    ['https://api.example.com/v1', 'https://api.example.com/v1/chat/completions'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1/chat/completions'],
    ['https://api.example.com/v1///', 'https://api.example.com/v1/chat/completions'],
    ['  https://api.example.com/v1/  ', 'https://api.example.com/v1/chat/completions']
  ])('joins %s without duplicate or missing slashes', async (baseUrl, expected) => {
    const { url, fetchImpl } = captureUrl();
    const provider = new OpenAICompatibleProvider({ ...CONFIG, baseUrl }, fetchImpl);
    await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    expect(url()).toBe(expected);
  });

  it('assembles the /models URL for health checks', async () => {
    const { url, fetchImpl } = captureUrl();
    const provider = new OpenAICompatibleProvider({ ...CONFIG, baseUrl: 'http://localhost:11434/v1' }, fetchImpl);
    await provider.listModels();
    expect(url()).toBe('http://localhost:11434/v1/models');
  });
});
