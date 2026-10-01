import { describe, expect, it } from 'vitest';
import {
  MAX_EXTRACT_REDIRECTS,
  WORKER_PROTOCOL_VERSION,
  createCommandMessage,
  createResultMessage,
  parseMessage,
  serializeMessage,
  validateMessage,
  type NormalizedPage
} from './workerProtocol';

function samplePage(): NormalizedPage {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    title: 'Home',
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    headings: [{ level: 1, text: 'Home' }],
    internalLinks: ['https://example.com/a'],
    externalLinks: ['https://external.example.com/x'],
    images: [{ src: 'https://example.com/logo.svg', alt: 'Logo', internal: true }],
    metrics: { loadTimeMs: 5, domContentLoadedTimeMs: 3, domNodeCount: 10 },
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('workerProtocol - extract/abort commands', () => {
  it('round-trips an extract command', () => {
    const message = createCommandMessage({
      command: 'extract',
      sessionId: 's1',
      url: 'https://example.com/',
      timeoutMs: 10_000,
      followRedirects: true,
      maxRedirects: 3
    });
    const parsed = parseMessage(serializeMessage(message));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message).toEqual(message);
    }
  });

  it('accepts a minimal extract command', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'command',
        payload: { command: 'extract', sessionId: 's', url: 'https://example.com/', timeoutMs: 1000 }
      })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an extract command with a non-numeric timeout', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'command',
        payload: { command: 'extract', sessionId: 's', url: 'https://example.com/', timeoutMs: 'soon' }
      })
    );
    expect(result.ok).toBe(false);
  });

  it('accepts an abort command', () => {
    const result = parseMessage(serializeMessage(createCommandMessage({ command: 'abort', sessionId: 's' })));
    expect(result.ok).toBe(true);
  });

  it('validates an extract result payload', () => {
    const message = createResultMessage('a', { command: 'extract', sessionId: 's', page: samplePage() });
    const result = validateMessage(message);
    expect(result.ok).toBe(true);
  });

  it('rejects an extract result with a malformed page', () => {
    const message = createResultMessage('a', {
      command: 'extract',
      sessionId: 's',
      page: { requestedUrl: 'x' } as unknown as NormalizedPage
    });
    const result = validateMessage(message);
    expect(result.ok).toBe(false);
  });

  it('exposes the redirect ceiling constant', () => {
    expect(MAX_EXTRACT_REDIRECTS).toBe(5);
  });
});
