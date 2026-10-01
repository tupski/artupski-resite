import { describe, expect, it } from 'vitest';
import {
  MAX_EXTRACT_REDIRECTS,
  WORKER_PROTOCOL_VERSION,
  createCommandMessage,
  createResultMessage,
  isAuthStorageState,
  parseMessage,
  serializeMessage,
  validateMessage,
  type AuthStorageState,
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
    authStatus: 'public',
    loginSignals: { redirectedToLogin: false, hasPasswordField: false, hasCaptcha: false },
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
        payload: {
          command: 'extract',
          sessionId: 's',
          url: 'https://example.com/',
          timeoutMs: 1000
        }
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
        payload: {
          command: 'extract',
          sessionId: 's',
          url: 'https://example.com/',
          timeoutMs: 'soon'
        }
      })
    );
    expect(result.ok).toBe(false);
  });

  it('accepts an abort command', () => {
    const result = parseMessage(
      serializeMessage(createCommandMessage({ command: 'abort', sessionId: 's' }))
    );
    expect(result.ok).toBe(true);
  });

  it('validates an extract result payload', () => {
    const message = createResultMessage('a', {
      command: 'extract',
      sessionId: 's',
      page: samplePage()
    });
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

  describe('workerProtocol - authenticated session commands', () => {
    const validState: AuthStorageState = {
      cookies: [
        {
          name: 'sid',
          value: 'v',
          domain: 'app.example.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax'
        }
      ],
      origins: [{ origin: 'https://app.example.com', localStorage: { a: 'b' }, sessionStorage: {} }]
    };

    it('round-trips a launch command carrying an injected storage state', () => {
      const message = createCommandMessage({
        command: 'launch',
        engine: 'chromium',
        headless: true,
        authState: validState
      });
      const parsed = parseMessage(serializeMessage(message));
      expect(parsed.ok).toBe(true);
      if (parsed.ok && parsed.message.type === 'command') {
        expect(parsed.message.payload).toMatchObject({ command: 'launch', authState: validState });
      }
    });

    it('accepts a launch command without a storage state', () => {
      const message = createCommandMessage({
        command: 'launch',
        engine: 'chromium',
        headless: true
      });
      expect(validateMessage(message)).toEqual({ ok: true });
    });

    it('rejects a malformed storage state at the protocol boundary', () => {
      const message = createCommandMessage({
        command: 'launch',
        engine: 'chromium',
        headless: true
      });
      const malformed = {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: message.id,
        type: 'command',
        payload: {
          command: 'launch',
          engine: 'chromium',
          headless: true,
          authState: { cookies: [{ name: 'x' }], origins: [] }
        }
      };
      const parsed = parseMessage(JSON.stringify(malformed));
      expect(parsed.ok).toBe(false);
    });

    it('round-trips a detectLogin command and result', () => {
      const command = createCommandMessage({
        command: 'detectLogin',
        sessionId: 's1',
        url: 'https://app.example.com/dashboard',
        timeoutMs: 5000
      });
      expect(parseMessage(serializeMessage(command)).ok).toBe(true);

      const result = createResultMessage(command.id, {
        command: 'detectLogin',
        sessionId: 's1',
        url: 'https://app.example.com/dashboard',
        finalUrl: 'https://app.example.com/login',
        status: 200,
        signals: {
          redirectedToLogin: true,
          hasPasswordField: true,
          hasCaptcha: false,
          httpStatus: 200
        }
      });
      expect(parseMessage(serializeMessage(result)).ok).toBe(true);
    });

    it('validates the storage-state shape structurally', () => {
      expect(isAuthStorageState(validState)).toBe(true);
      expect(isAuthStorageState({ cookies: [], origins: [] })).toBe(true);
      expect(isAuthStorageState({ cookies: [{ name: 'x' }], origins: [] })).toBe(false);
      expect(isAuthStorageState({ cookies: [], origins: [{ origin: 1 }] })).toBe(false);
      expect(isAuthStorageState(null)).toBe(false);
    });
  });
});
