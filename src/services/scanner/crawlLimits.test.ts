import { describe, expect, it } from 'vitest';
import { DEFAULT_CRAWL_LIMITS, HARD_CRAWL_LIMITS, resolveCrawlLimits } from './crawlLimits';

describe('resolveCrawlLimits', () => {
  it('applies conservative defaults when nothing is supplied', () => {
    expect(resolveCrawlLimits()).toEqual(DEFAULT_CRAWL_LIMITS);
    expect(resolveCrawlLimits().maxConcurrency).toBe(1);
  });

  it('clamps caller values into documented hard bounds', () => {
    const limits = resolveCrawlLimits({
      maxPages: 10_000,
      maxDepth: 999,
      maxConcurrency: 64,
      navigationTimeoutMs: 999_999,
      maxRedirects: 99,
      persistenceBatchSize: 1_000_000,
      progressEveryPages: 0,
      maxPageFailures: 10_000,
      maxRetriesPerPage: 99
    });
    expect(limits.maxPages).toBe(HARD_CRAWL_LIMITS.maxPages);
    expect(limits.maxDepth).toBe(HARD_CRAWL_LIMITS.maxDepth);
    expect(limits.maxConcurrency).toBe(HARD_CRAWL_LIMITS.maxConcurrency);
    expect(limits.navigationTimeoutMs).toBeLessThanOrEqual(30_000);
    expect(limits.maxRedirects).toBeLessThanOrEqual(5);
    expect(limits.persistenceBatchSize).toBeLessThanOrEqual(HARD_CRAWL_LIMITS.persistenceBatchSize);
    expect(limits.progressEveryPages).toBeGreaterThanOrEqual(1);
    expect(limits.maxPageFailures).toBeLessThanOrEqual(HARD_CRAWL_LIMITS.maxPageFailures);
    expect(limits.maxRetriesPerPage).toBeLessThanOrEqual(HARD_CRAWL_LIMITS.maxRetriesPerPage);
  });

  it('never lets concurrency exceed 1 (single abort controller per session)', () => {
    expect(resolveCrawlLimits({ maxConcurrency: 8 }).maxConcurrency).toBe(1);
    expect(resolveCrawlLimits({ maxConcurrency: 0 }).maxConcurrency).toBe(1);
  });

  it('honours explicit values that are already within bounds', () => {
    const limits = resolveCrawlLimits({ maxPages: 12, maxDepth: 3, navigationTimeoutMs: 5000 });
    expect(limits.maxPages).toBe(12);
    expect(limits.maxDepth).toBe(3);
    expect(limits.navigationTimeoutMs).toBe(5000);
  });

  it('ignores non-finite values', () => {
    const limits = resolveCrawlLimits({ maxPages: Number.NaN, maxDepth: Infinity });
    expect(limits.maxPages).toBe(DEFAULT_CRAWL_LIMITS.maxPages);
    expect(limits.maxDepth).toBe(DEFAULT_CRAWL_LIMITS.maxDepth);
  });
});
