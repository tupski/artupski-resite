import { describe, expect, it } from 'vitest';
import { normalizeUrlInput, validateTargetUrl } from './url';

describe('normalizeUrlInput', () => {
  it('prepends https:// when the scheme is omitted', () => {
    expect(normalizeUrlInput('example.com')).toBe('https://example.com');
  });

  it('preserves an explicit scheme', () => {
    expect(normalizeUrlInput('http://example.com')).toBe('http://example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrlInput('  example.com  ')).toBe('https://example.com');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeUrlInput('   ')).toBe('');
  });
});

describe('validateTargetUrl', () => {
  it('accepts a bare hostname and normalizes it to https', () => {
    const result = validateTargetUrl('example.com');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.url).toBe('https://example.com');
      expect(result.host).toBe('example.com');
    }
  });

  it('accepts an explicit https URL with a path', () => {
    const result = validateTargetUrl('https://example.com/pricing');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.host).toBe('example.com');
    }
  });

  it('rejects empty input with the empty reason', () => {
    const result = validateTargetUrl('');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('empty');
    }
  });

  it('rejects non-http schemes', () => {
    const result = validateTargetUrl('ftp://example.com');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('scheme_rejected');
    }
  });

  it('rejects a host without a dot (not a real hostname)', () => {
    const result = validateTargetUrl('localhost');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('missing_host');
    }
  });

  it('trims a trailing slash from the normalized URL', () => {
    const result = validateTargetUrl('https://example.com/');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.url).toBe('https://example.com');
    }
  });
});
