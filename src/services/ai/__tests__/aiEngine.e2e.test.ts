/** @vitest-environment node */
/**
 * Opt-in AI engine E2E - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-10-impl-plan.md section 9.
 *
 * OPT-IN (`RUN_AI_TESTS=1`). Boots a real local OpenAI-compatible HTTP server
 * (`node:http`) and drives the full stack over a real socket: config resolution,
 * `/models` health check, non-streaming chat completion, SSE streaming, and a
 * schema-constrained generation task. No external network is touched, and the
 * server never sees a real key (a deterministic test token is used).
 *
 * Run with:  RUN_AI_TESTS=1 npx vitest run src/services/ai
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiEngine } from '../engine';
import type { AISettingsAccess } from '../config';

const RUN = process.env.RUN_AI_TESTS === '1';
const describeE2E = RUN ? describe : describe.skip;

const PORT = 7331;

/** A minimal OpenAI-compatible mock. Serves /models, /chat/completions (JSON + SSE). */
function startMockServer(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}') as { stream?: boolean };
        if (payload.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"{\\"name\\":"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":"\\"mock\\",\\"count\\":7}"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '{"name":"mock","count":7}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
            model: 'mock-model'
          })
        );
      });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

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

const SEED = JSON.stringify({
  providerId: 'custom',
  baseUrl: `http://127.0.0.1:${PORT}/v1`,
  model: 'mock-model',
  timeoutMs: 5000,
  updatedAt: ''
});

describeE2E('AI engine end-to-end (mock OpenAI-compatible server)', () => {
  let server: Server;
  let engine: ReturnType<typeof createAiEngine>;

  beforeAll(async () => {
    server = await startMockServer();
    engine = createAiEngine({
      settings: memoryAccess({
        'ai.config': SEED,
        'ai.credentials': JSON.stringify({ apiKey: 'test-token' })
      })
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('verifies a real health check against /models', async () => {
    const result = await engine.healthCheck();
    expect(result.valid).toBe(true);
    expect(result.models).toEqual(['mock-model']);
  });

  it('returns a typed non-streaming completion over a real socket', async () => {
    const result = await engine.chatCompletion([{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.usage.totalTokens).toBe(7);
      expect(result.data.model).toBe('mock-model');
    }
  });

  it('returns valid structured JSON from a schema-constrained task', async () => {
    const schema = z.object({ name: z.string(), count: z.number() });
    const result = await engine.generate({
      taskName: 'e2e.structured',
      systemPrompt: 'Extract.',
      payload: { html: '<div/>' },
      schema,
      maxRepairAttempts: 1
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: 'mock', count: 7 });
    }
  });
});
