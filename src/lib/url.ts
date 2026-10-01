/**
 * URL validation & normalization - Artupski ReSite
 *
 * UI-SPEC section 2.1: "automatic protocol prepending (https://)" and
 * "immediate host validation". Pure functions so they are trivially testable.
 */

export type UrlValidationReason =
  | 'empty'
  | 'scheme_rejected'
  | 'invalid'
  | 'missing_host';

export type UrlValidationResult =
  | { valid: true; url: string; host: string }
  | { valid: false; reason: UrlValidationReason; message: string };

/** Only http(s) targets are meaningful for the scanner. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Prepend `https://` when the user omits a scheme.
 * Bare input like `example.com` becomes `https://example.com`.
 */
export function normalizeUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  // Leave an explicit scheme (valid or not) untouched so it can be rejected.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Validate and normalize a target URL.
 *
 * Returns a discriminated result so callers can render a precise message and
 * never deal with thrown exceptions on user input.
 */
export function validateTargetUrl(raw: string): UrlValidationResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: 'empty', message: 'Enter a website URL to scan.' };
  }

  const normalized = normalizeUrlInput(trimmed);

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      valid: false,
      reason: 'invalid',
      message: 'That does not look like a valid URL. Example: https://example.com',
    };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      valid: false,
      reason: 'scheme_rejected',
      message: 'Only http:// and https:// URLs are supported.',
    };
  }

  if (parsed.hostname.length === 0 || !parsed.hostname.includes('.')) {
    return {
      valid: false,
      reason: 'missing_host',
      message: 'Enter a full hostname, for example https://example.com',
    };
  }

  return {
    valid: true,
    url: parsed.href.replace(/\/$/, ''),
    host: parsed.hostname,
  };
}
