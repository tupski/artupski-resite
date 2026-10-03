import { describe, expect, it, vi } from 'vitest';
import type { LogEntry, LogSink } from '../../infra/logger';
import { createRedactingSink, REDACTED_PLACEHOLDER, scrubSecrets } from '../redaction';

describe('scrubSecrets', () => {
  it('redacts secret-looking fields in nested objects and arrays', () => {
    const input = {
      url: 'https://app.example.com',
      cookie: 'sid=secret',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      items: [{ apiKey: 'sk-1' }, { token: 't' }, { safe: 'ok' }],
      nested: { sessionToken: 'xyz', password: 'p', safe: 1 }
    };

    const out = scrubSecrets(input) as typeof input;

    expect(out.url).toBe('https://app.example.com');
    expect(out.cookie).toBe(REDACTED_PLACEHOLDER);
    expect(out.headers.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(out.headers['Content-Type']).toBe('application/json');
    expect(out.items[0]!.apiKey).toBe(REDACTED_PLACEHOLDER);
    expect(out.items[1]!.token).toBe(REDACTED_PLACEHOLDER);
    expect(out.items[2]!.safe).toBe('ok');
    expect(out.nested.sessionToken).toBe(REDACTED_PLACEHOLDER);
    expect(out.nested.password).toBe(REDACTED_PLACEHOLDER);
    expect(out.nested.safe).toBe(1);
  });

  it('does not mutate the input', () => {
    const input = { cookie: 'sid=secret', nested: { token: 't' } };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;

    scrubSecrets(input);

    expect(input).toEqual(snapshot);
    expect(input.cookie).toBe('sid=secret');
  });

  it('passes primitives through unchanged', () => {
    expect(scrubSecrets('plain string')).toBe('plain string');
    expect(scrubSecrets(42)).toBe(42);
    expect(scrubSecrets(null)).toBeNull();
    expect(scrubSecrets(undefined)).toBeUndefined();
  });
});

describe('createRedactingSink', () => {
  it('scrubs metadata and error details before forwarding to the wrapped sink', () => {
    const next = vi.fn<(entry: LogEntry) => void>();
    const sink: LogSink = createRedactingSink(next);

    const entry: LogEntry = {
      id: '1',
      timestamp: new Date().toISOString(),
      level: 'INFO',
      scope: 'test',
      message: 'hello',
      metadata: { apiKey: 'sk-secret', url: 'https://x' },
      error: {
        code: 'API_KEY_INVALID',
        category: 'ai',
        message: 'bad',
        severity: 'error',
        recoverable: true,
        retryable: false,
        suggestedAction: 'fix',
        timestamp: new Date().toISOString(),
        details: { authorization: 'Bearer abc' }
      }
    };

    sink(entry);

    expect(next).toHaveBeenCalledOnce();
    const [forwarded] = next.mock.calls[0]!;
    expect(forwarded.metadata).toEqual({ apiKey: REDACTED_PLACEHOLDER, url: 'https://x' });
    expect((forwarded.error?.details as Record<string, unknown>).authorization).toBe(
      REDACTED_PLACEHOLDER
    );
    expect(forwarded.message).toBe('hello');
    // The original entry is untouched.
    expect(entry.metadata).toEqual({ apiKey: 'sk-secret', url: 'https://x' });
  });

  it('leaves entries without metadata/error intact', () => {
    const next = vi.fn<(entry: LogEntry) => void>();
    const sink = createRedactingSink(next);
    sink({
      id: '2',
      timestamp: new Date().toISOString(),
      level: 'WARN',
      scope: 'test',
      message: 'no extras'
    });
    const [forwarded] = next.mock.calls[0]!;
    expect(forwarded.metadata).toBeUndefined();
    expect(forwarded.error).toBeUndefined();
    expect(forwarded.message).toBe('no extras');
  });
});
