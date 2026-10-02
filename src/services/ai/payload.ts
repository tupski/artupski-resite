/**
 * Untrusted payload isolation - Artupski ReSite
 * Source of truth: docs/specs/AI-SPEC.md sections 4.1 (sanitizePayload) and 5.2
 * (untrusted data wrapping protocol).
 *
 * Crawled HTML/CSS/text and Blueprint fragments are untrusted third-party data.
 * They are sanitized (oversized data URIs stubbed), then wrapped in a distinct
 * `<DATA_PAYLOAD>` boundary. Any embedded closing tag is escaped so scraped text
 * can never break out of the boundary and be interpreted as instructions.
 */
import { isRecord } from '../blueprint/util';

/** Boundary tags used to isolate untrusted data (AI-SPEC.md section 5.2). */
export const DATA_PAYLOAD_OPEN = '<DATA_PAYLOAD>';
export const DATA_PAYLOAD_CLOSE = '</DATA_PAYLOAD>';

/** Data URIs longer than this are replaced with a stub before estimation. */
export const MAX_DATA_URI_LENGTH = 500;

/** Recursively stub oversized `data:` strings so base64 blobs never reach a prompt. */
export function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(payload) as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.length > MAX_DATA_URI_LENGTH) {
      return '[DATA_URI_TRUNCATED]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = sanitizeValue(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Escape any embedded boundary sequence in untrusted text so it cannot close the
 * `<DATA_PAYLOAD>` wrapper early. Only the closing tag matters for breakout, but
 * escaping both keeps boundaries unambiguous.
 */
export function escapeBoundary(text: string): string {
  return text
    .split(DATA_PAYLOAD_CLOSE)
    .join('<\\/DATA_PAYLOAD>')
    .split(DATA_PAYLOAD_OPEN)
    .join('<\\DATA_PAYLOAD>');
}

/**
 * Serialize a payload and wrap it in escaped `<DATA_PAYLOAD>` boundaries. This is
 * the ONLY way untrusted content is handed to the model (AI-SPEC.md section 5.2).
 */
export function buildUserMessageContent(payload: Record<string, unknown>): string {
  const sanitized = sanitizePayload(payload);
  const body = escapeBoundary(JSON.stringify(sanitized, null, 2));
  return `${DATA_PAYLOAD_OPEN}\n${body}\n${DATA_PAYLOAD_CLOSE}`;
}
