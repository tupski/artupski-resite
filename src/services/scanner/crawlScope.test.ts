import { describe, expect, it } from 'vitest';
import { classifyLink, createCrawlScope, isHostInScope, isPathInScope, isUrlInScope } from './crawlScope';

describe('createCrawlScope', () => {
  it('derives host and base path from the seed', () => {
    const scope = createCrawlScope('https://example.com/docs/intro');
    expect(scope?.host).toBe('example.com');
    expect(scope?.basePath).toBe('/');
  });

  it('returns null for an invalid seed', () => {
    expect(createCrawlScope('not a url')).toBeNull();
  });
});

describe('scope classification', () => {
  const scope = createCrawlScope('https://example.com/')!;

  it('treats the exact host as internal', () => {
    expect(isUrlInScope('https://example.com/page', scope)).toBe(true);
    expect(classifyLink('https://example.com/page', scope)).toBe('internal');
  });

  it('treats a subdomain as external by default', () => {
    expect(classifyLink('https://blog.example.com/post', scope)).toBe('external');
  });

  it('treats a subdomain as internal when configured', () => {
    const withSubs = createCrawlScope('https://example.com/', { includeSubdomains: true })!;
    expect(classifyLink('https://blog.example.com/post', withSubs)).toBe('internal');
  });

  it('treats a different origin as external', () => {
    expect(classifyLink('https://external.example.com/x', scope)).toBe('external');
  });

  it('treats a different scheme/port origin as external', () => {
    expect(classifyLink('http://example.com/x', scope)).toBe('external');
  });

  it('reports invalid URLs', () => {
    expect(classifyLink('not a url', scope)).toBe('invalid');
  });
});

describe('base path scope', () => {
  const scope = createCrawlScope('https://example.com/docs/', { basePath: '/docs' })!;

  it('keeps paths under the base path in scope', () => {
    expect(isPathInScope('/docs', scope)).toBe(true);
    expect(isPathInScope('/docs/intro', scope)).toBe(true);
    expect(isPathInScope('/blog', scope)).toBe(false);
    expect(isUrlInScope('https://example.com/blog', scope)).toBe(false);
  });
});

describe('host scope helpers', () => {
  const scope = createCrawlScope('https://example.com/')!;
  it('checks host membership', () => {
    expect(isHostInScope('example.com', scope)).toBe(true);
    expect(isHostInScope('evil.com', scope)).toBe(false);
  });
});
