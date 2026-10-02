import { describe, expect, it } from 'vitest';
import {
  MAX_FRAME_BYTES,
  WORKER_PROTOCOL_VERSION,
  createCommandMessage,
  createErrorMessage,
  createEventMessage,
  createLogMessage,
  createMessageId,
  createResultMessage,
  decodeFrames,
  parseMessage,
  serializeMessage,
  stableStringify,
  validateMessage
} from './workerProtocol';
import type { WorkerMessage } from './workerProtocol';

describe('workerProtocol versioning', () => {
  it('exposes a positive integer protocol version', () => {
    expect(Number.isInteger(WORKER_PROTOCOL_VERSION)).toBe(true);
    expect(WORKER_PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('stamps the protocol version on every built message', () => {
    expect(createCommandMessage({ command: 'ping' }).protocolVersion).toBe(WORKER_PROTOCOL_VERSION);
    expect(createEventMessage({ event: 'x' }).protocolVersion).toBe(WORKER_PROTOCOL_VERSION);
    expect(createLogMessage({ level: 'info', message: 'x' }).protocolVersion).toBe(
      WORKER_PROTOCOL_VERSION
    );
    expect(createErrorMessage({ code: 'X', message: 'x' }).protocolVersion).toBe(
      WORKER_PROTOCOL_VERSION
    );
  });

  it('rejects an unknown protocol version', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: 999,
        id: 'a',
        type: 'command',
        payload: { command: 'ping' }
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WORKER_PROTOCOL_VIOLATION');
      expect(result.error.message).toMatch(/version/i);
    }
  });
});

describe('workerProtocol serialization', () => {
  it('round-trips a command through serialize/parse', () => {
    const message = createCommandMessage({
      command: 'navigate',
      sessionId: 's1',
      url: 'http://127.0.0.1:9099/simple-page',
      timeoutMs: 5000
    });
    const frame = serializeMessage(message);
    expect(frame.endsWith('\n')).toBe(true);

    const parsed = parseMessage(frame);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message).toEqual(message);
    }
  });

  it('produces deterministic JSON with sorted keys', () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const b = stableStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('generates unique correlation ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createMessageId()));
    expect(ids.size).toBe(50);
  });
});

describe('workerProtocol validation', () => {
  it('rejects an empty frame', () => {
    const result = parseMessage('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/empty/i);
    }
  });

  it('rejects invalid JSON', () => {
    const result = parseMessage('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WORKER_PROTOCOL_VIOLATION');
      expect(result.error.message).toMatch(/json/i);
    }
  });

  it('rejects a non-object frame', () => {
    expect(parseMessage('42').ok).toBe(false);
    expect(parseMessage('"a string"').ok).toBe(false);
  });

  it('rejects an unknown message type', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'bogus',
        payload: {}
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/type/i);
    }
  });

  it('rejects a command with an invalid payload', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'command',
        payload: { command: 'launch', engine: 'firefox' }
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/payload/i);
    }
  });

  it('rejects a navigate command missing its timeout', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'command',
        payload: { command: 'navigate', sessionId: 's', url: 'http://x' }
      })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a missing correlation id', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        type: 'command',
        payload: { command: 'ping' }
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/correlation/i);
    }
  });

  it('validates a well-formed result payload', () => {
    const validation = validateMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 'a',
      type: 'result',
      payload: { command: 'ping', pong: true, workerVersion: '0.1.0' }
    });
    expect(validation.ok).toBe(true);
  });

  it('accepts a bounded captureViewport command', () => {
    const validation = validateMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 'cv',
      type: 'command',
      payload: {
        command: 'captureViewport',
        sessionId: 's',
        url: 'https://app.example.com',
        timeoutMs: 20_000,
        profile: {
          name: 'mobile',
          width: 375,
          height: 812,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true
        }
      }
    });
    expect(validation.ok).toBe(true);
  });

  it('rejects a captureViewport command with an out-of-bounds profile', () => {
    const validation = validateMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 'cv',
      type: 'command',
      payload: {
        command: 'captureViewport',
        sessionId: 's',
        url: 'https://app.example.com',
        timeoutMs: 20_000,
        profile: {
          name: 'mobile',
          width: 999_999,
          height: 812,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true
        }
      }
    });
    expect(validation.ok).toBe(false);
  });

  it('rejects a malformed error field', () => {
    const validation = validateMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 'a',
      type: 'event',
      payload: { event: 'x' },
      error: 'not-an-object'
    });
    expect(validation.ok).toBe(false);
  });
});

describe('workerProtocol structured error propagation', () => {
  it('carries a structured error on a result frame', () => {
    const error = {
      code: 'BROWSER_NOT_INSTALLED' as const,
      category: 'browser' as const,
      message: 'missing',
      severity: 'error' as const,
      recoverable: true,
      retryable: false,
      suggestedAction: 'install',
      timestamp: new Date().toISOString()
    };
    const message = createResultMessage(
      'corr-1',
      { command: 'launch', sessionId: '', engine: 'chromium', version: '' },
      error
    );
    const parsed = parseMessage(serializeMessage(message));
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.message.type === 'result') {
      expect(parsed.message.id).toBe('corr-1');
      expect(parsed.message.error?.code).toBe('BROWSER_NOT_INSTALLED');
    }
  });
});

describe('workerProtocol framing', () => {
  it('splits multiple frames and preserves the remainder', () => {
    const buffer = '{"a":1}\n{"b":2}\n{"partial"';
    const decoded = decodeFrames(buffer);
    expect(decoded.frames).toEqual(['{"a":1}', '{"b":2}']);
    expect(decoded.remainder).toBe('{"partial"');
    expect(decoded.oversize).toBe(0);
  });

  it('handles a buffer with no complete frame', () => {
    const decoded = decodeFrames('{"partial"');
    expect(decoded.frames).toEqual([]);
    expect(decoded.remainder).toBe('{"partial"');
  });

  it('drops oversize terminated frames', () => {
    const huge = 'x'.repeat(MAX_FRAME_BYTES + 10);
    const decoded = decodeFrames(`${huge}\n`);
    expect(decoded.frames).toEqual([]);
    expect(decoded.oversize).toBe(1);
  });

  it('discards an oversize unterminated remainder', () => {
    const decoded = decodeFrames('y'.repeat(MAX_FRAME_BYTES + 5));
    expect(decoded.remainder).toBe('');
    expect(decoded.oversize).toBe(1);
  });

  it('refuses to serialize a frame over the size limit', () => {
    const oversized = {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id: 'a',
      type: 'event',
      payload: { event: 'big', data: { blob: 'z'.repeat(MAX_FRAME_BYTES + 1) } }
    } as unknown as WorkerMessage;
    expect(() => serializeMessage(oversized)).toThrowError(/exceeds/i);
  });
});

describe('workerProtocol blueprint extensions (Phase 9)', () => {
  it('accepts a well-formed captureBlueprint command', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'bp',
        type: 'command',
        payload: {
          command: 'captureBlueprint',
          sessionId: 's1',
          url: 'http://127.0.0.1:5173/blueprint',
          timeoutMs: 20_000
        }
      })
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a captureBlueprint command with caps', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'bp',
        type: 'command',
        payload: {
          command: 'captureBlueprint',
          sessionId: 's1',
          url: 'http://127.0.0.1:5173/blueprint',
          timeoutMs: 20_000,
          maxNodes: 100,
          maxBytes: 1024
        }
      })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a captureBlueprint command with a bad cap', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'bp',
        type: 'command',
        payload: {
          command: 'captureBlueprint',
          sessionId: 's1',
          url: 'http://127.0.0.1:5173/blueprint',
          timeoutMs: 20_000,
          maxNodes: 'many'
        }
      })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a captureBlueprint command missing its url', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'bp',
        type: 'command',
        payload: { command: 'captureBlueprint', sessionId: 's1', timeoutMs: 20_000 }
      })
    );
    expect(result.ok).toBe(false);
  });

  it('validates a captureBlueprint result carrying evidence', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'bp',
        type: 'result',
        payload: {
          command: 'captureBlueprint',
          sessionId: 's1',
          url: 'http://127.0.0.1:5173/blueprint',
          finalUrl: 'http://127.0.0.1:5173/blueprint',
          status: 200,
          evidence: {
            url: 'http://127.0.0.1:5173/blueprint',
            status: 200,
            capturedAt: '2026-01-01T00:00:00.000Z',
            nodes: [
              {
                id: 'n0',
                parentId: null,
                tag: 'html',
                role: '',
                semantic: [],
                text: '',
                attrs: {},
                classes: [],
                childIds: [],
                visible: true,
                bounds: { x: 0, y: 0, width: 800, height: 600 },
                styles: {
                  display: 'block',
                  position: 'static',
                  flexDirection: 'row',
                  gridTemplateColumns: 'none',
                  fontSize: '16px',
                  fontWeight: '400',
                  lineHeight: '24px',
                  color: 'rgb(0, 0, 0)',
                  backgroundColor: 'rgba(0, 0, 0, 0)',
                  borderColor: 'rgb(0, 0, 0)',
                  borderRadius: '0px',
                  boxShadow: 'none',
                  margin: '0px 0px 0px 0px',
                  padding: '0px 0px 0px 0px',
                  gap: 'normal',
                  fontFamily: 'Inter, sans-serif'
                }
              }
            ],
            cssVariables: { '--primary': '#0ea5e9' },
            fontFaces: [{ family: 'Inter', weight: '400', style: 'normal' }],
            forms: [],
            nav: [],
            headings: [],
            links: [],
            images: [],
            truncated: false,
            nodeCount: 1,
            byteLength: 100,
            limits: {
              maxNodes: 5000,
              maxBytes: 4194304,
              maxTextChars: 200,
              maxForms: 50,
              maxCssVars: 500
            }
          }
        }
      })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a captureBlueprint result with malformed evidence', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'bp',
        type: 'result',
        payload: {
          command: 'captureBlueprint',
          sessionId: 's1',
          url: 'http://x/',
          finalUrl: 'http://x/',
          status: 200,
          evidence: { url: 'http://x/', nodes: 'not-an-array' }
        }
      })
    );
    expect(result.ok).toBe(false);
  });
});

describe('workerProtocol clone extensions (Phase 8)', () => {
  it('accepts a well-formed captureAssets command', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'command',
        payload: { command: 'captureAssets', sessionId: 's1', url: 'http://x/', timeoutMs: 1000 }
      })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a captureAssets command with a bad cap', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'command',
        payload: {
          command: 'captureAssets',
          sessionId: 's1',
          url: 'http://x/',
          timeoutMs: 1000,
          maxAssets: 'many'
        }
      })
    );
    expect(result.ok).toBe(false);
  });

  it('accepts serveClone and stopClone commands', () => {
    expect(
      parseMessage(
        JSON.stringify({
          protocolVersion: WORKER_PROTOCOL_VERSION,
          id: 'a',
          type: 'command',
          payload: { command: 'serveClone', root: '/tmp/clones' }
        })
      ).ok
    ).toBe(true);
    expect(
      parseMessage(
        JSON.stringify({
          protocolVersion: WORKER_PROTOCOL_VERSION,
          id: 'b',
          type: 'command',
          payload: { command: 'stopClone' }
        })
      ).ok
    ).toBe(true);
  });

  it('validates a captureAssets result with bounded assets', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'result',
        payload: {
          command: 'captureAssets',
          sessionId: 's1',
          url: 'http://x/',
          finalUrl: 'http://x/',
          status: 200,
          assets: [
            {
              sourceUrl: 'http://x/a.png',
              mimeType: 'image/png',
              assetType: 'image',
              sizeBytes: 4,
              sha256: 'abc',
              base64: 'AAAA'
            }
          ],
          skipped: 0,
          truncated: false
        }
      })
    );
    expect(result.ok).toBe(true);
  });

  it('validates an extract result carrying rawHtml', () => {
    const result = parseMessage(
      JSON.stringify({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        id: 'a',
        type: 'result',
        payload: {
          command: 'extract',
          sessionId: 's1',
          page: {
            requestedUrl: 'http://x/',
            finalUrl: 'http://x/',
            httpStatus: 200,
            title: 'x',
            metaDescription: null,
            canonicalUrl: null,
            robotsMeta: null,
            headings: [],
            internalLinks: [],
            externalLinks: [],
            images: [],
            metrics: {},
            status: 'completed',
            errorCode: null,
            errorMessage: null,
            warnings: [],
            capturedAt: '2026-01-01T00:00:00.000Z',
            authStatus: 'none',
            loginSignals: {}
          },
          rawHtml: { html: '<html></html>', byteLength: 13, truncated: false }
        }
      })
    );
    expect(result.ok).toBe(true);
  });
});
