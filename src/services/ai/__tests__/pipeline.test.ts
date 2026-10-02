import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AICompletionResponse, AIMessage, IAIProvider } from '../../../types/ai';
import { GenerationPipeline, extractJson } from '../pipeline';
import { TokenBudgetManager } from '../tokenBudget';

function response(content: string): AICompletionResponse {
  return {
    content,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'test-model',
    finishReason: 'stop'
  };
}

/** A scripted provider that returns queued responses in order. */
function scriptedProvider(outputs: string[]): IAIProvider & { calls: AIMessage[][] } {
  const calls: AIMessage[][] = [];
  let index = 0;
  return {
    id: 'scripted',
    name: 'Scripted',
    calls,
    validateCredentials: async () => ({ valid: true }),
    listModels: async () => ['test-model'],
    chatCompletion: async (messages) => {
      calls.push(messages);
      const output = outputs[Math.min(index, outputs.length - 1)];
      index += 1;
      return response(output ?? '');
    },
    streamChatCompletion: async () => response('')
  };
}

const schema = z.object({ name: z.string(), count: z.number() });

describe('extractJson (AI-SPEC.md 4.1)', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a fenced ```json block', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('throws when no JSON is present', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('GenerationPipeline (AI-SPEC.md 4.1)', () => {
  const task = {
    taskName: 'component.synthesize',
    systemPrompt: 'system',
    payload: { html: '<div/>' },
    schema,
    maxRepairAttempts: 2
  };

  it('returns validated data on the first valid response', async () => {
    const provider = scriptedProvider(['{"name":"hero","count":2}']);
    const pipeline = new GenerationPipeline(provider, new TokenBudgetManager('default'));
    const result = await pipeline.executeTask(task);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: 'hero', count: 2 });
      expect(result.attempts).toBe(1);
    }
  });

  it('wraps the untrusted payload in DATA_PAYLOAD before sending', async () => {
    const provider = scriptedProvider(['{"name":"a","count":1}']);
    const pipeline = new GenerationPipeline(provider, new TokenBudgetManager('default'));
    await pipeline.executeTask(task);
    const userMessage = provider.calls[0]?.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('<DATA_PAYLOAD>');
    expect(userMessage?.content).toContain('</DATA_PAYLOAD>');
  });

  it('repairs after a schema-invalid response then succeeds', async () => {
    const provider = scriptedProvider(['{"name":"hero"}', '{"name":"hero","count":3}']);
    const pipeline = new GenerationPipeline(provider, new TokenBudgetManager('default'));
    const result = await pipeline.executeTask(task);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('fails with MALFORMED_OUTPUT after exhausting repair attempts', async () => {
    const provider = scriptedProvider(['{"name":"hero"}', '{"name":"hero"}', '{"name":"hero"}']);
    const pipeline = new GenerationPipeline(provider, new TokenBudgetManager('default'));
    const result = await pipeline.executeTask({ ...task, maxRepairAttempts: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_OUTPUT');
      expect(result.error.category).toBe('ai');
    }
  });

  it('fails with MALFORMED_OUTPUT when the output is not parseable JSON', async () => {
    const provider = scriptedProvider(['not json at all']);
    const pipeline = new GenerationPipeline(provider, new TokenBudgetManager('default'));
    const result = await pipeline.executeTask(task);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_OUTPUT');
    }
  });

  it('rejects an over-budget payload with CONTEXT_LENGTH_EXCEEDED without calling the provider', async () => {
    const provider = scriptedProvider(['{"name":"a","count":1}']);
    const chatSpy = vi.spyOn(provider, 'chatCompletion');
    const pipeline = new GenerationPipeline(provider, new TokenBudgetManager('default'));
    const huge = { blob: 'x'.repeat(200_000) };
    const result = await pipeline.executeTask({ ...task, payload: huge });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONTEXT_LENGTH_EXCEEDED');
    }
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('returns a structured error when the provider throws', async () => {
    const provider = scriptedProvider([]);
    const throwing: IAIProvider['chatCompletion'] = async () => {
      throw new Error('boom');
    };
    provider.chatCompletion = throwing;
    const pipeline = new GenerationPipeline(provider, new TokenBudgetManager('default'));
    const result = await pipeline.executeTask(task);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('ai');
    }
  });
});
