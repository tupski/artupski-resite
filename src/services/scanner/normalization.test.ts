import { describe, expect, it } from 'vitest';
import { canonicalKey, normalizeUrl, resolveAndNormalize } from './normalization';

describe('normalizeUrl', () => {
  it('strips fragments', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('strips tracking query parameters', () => {
    expect(normalizeUrl('https://example.com/p?utm_source=x&id=5&fbclid=y&gclid=z&ref=r&_ga=g&mc_eid=m')).toBe(
      'https://example.com/p?id=5'
    );
  });

  it('sorts remaining query parameters deterministically', () => {
    expect(normalizeUrl('https://example.com/p?b=2&a=1')).toBe('https://example.com/p?a=1&b=2');
    expect(normalizeUrl('https://example.com/p?a=1&b=2')).toBe('https://example.com/p?a=1&b=2');
  });

  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/Path')).toBe('https://example.com/Path');
  });

  it('strips a trailing slash on non-root paths but keeps root', () => {
    expect(normalizeUrl('https://example.com/about/')).toBe('https://example.com/about');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns null for invalid input', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('canonicalKey', () => {
  it('collapses equivalent URLs to one key', () => {
    const a = canonicalKey('https://example.com/about/');
    const b = canonicalKey('https://example.com/about#team');
    const c = canonicalKey('https://example.com/about?utm_source=x');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('keeps distinct functional query params distinct', () => {
    expect(canonicalKey('https://example.com/p?page=1')).not.toBe(canonicalKey('https://example.com/p?page=2'));
  });
});

describe('resolveAndNormalize', () => {
  it('resolves relative references', () => {
    expect(resolveAndNormalize('https://example.com/a/b', '../c')).toBe('https://example.com/c');
    expect(resolveAndNormalize('https://example.com/a/', 'd')).toBe('https://example.com/a/d');
  });

  it('resolves protocol-relative URLs to the base scheme', () => {
    expect(resolveAndNormalize('https://example.com/', '//cdn.example.com/x.js')).toBe('https://cdn.example.com/x.js');
  });

  it('returns null for non-navigational schemes', () => {
    expect(resolveAndNormalize('https://example.com/', 'mailto:x@example.com')).toBeNull();
    expect(resolveAndNormalize('https://example.com/', 'javascript:alert(1)')).toBeNull();
    expect(resolveAndNormalize('https://example.com/', 'tel:+15550100')).toBeNull();
  });

  it('returns null for an empty reference', () => {
    expect(resolveAndNormalize('https://example.com/', '   ')).toBeNull();
  });
});
