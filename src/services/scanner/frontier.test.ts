import { describe, expect, it } from 'vitest';
import { CrawlFrontier } from './frontier';
import { createCrawlScope } from './crawlScope';

const scope = createCrawlScope('https://example.com/')!;

describe('CrawlFrontier ordering and dedupe', () => {
  it('dequeues in FIFO (breadth-first) order', () => {
    const frontier = new CrawlFrontier({ maxDepth: 3, maxPages: 50 });
    frontier.enqueue('https://example.com/a', 0);
    frontier.enqueue('https://example.com/b', 0);
    frontier.enqueue('https://example.com/c', 1);
    expect(frontier.dequeue()?.url).toBe('https://example.com/a');
    expect(frontier.dequeue()?.url).toBe('https://example.com/b');
    expect(frontier.dequeue()?.url).toBe('https://example.com/c');
    expect(frontier.dequeue()).toBeNull();
  });

  it('rejects duplicate links (including normalized equivalents)', () => {
    const frontier = new CrawlFrontier({ maxDepth: 3, maxPages: 50 });
    expect(frontier.enqueue('https://example.com/a', 0).status).toBe('enqueued');
    expect(frontier.enqueue('https://example.com/a/', 0).status).toBe('duplicate');
    expect(frontier.enqueue('https://example.com/a#frag', 0).status).toBe('duplicate');
    expect(frontier.enqueue('https://example.com/a?utm_source=x', 0).status).toBe('duplicate');
  });

  it('prevents loops because a URL is only ever enqueued once', () => {
    const frontier = new CrawlFrontier({ maxDepth: 10, maxPages: 50 });
    frontier.enqueue('https://example.com/loop', 0);
    frontier.dequeue();
    frontier.markScanned();
    frontier.enqueue('https://example.com/loop', 1);
    expect(frontier.hasQueuedWork()).toBe(false);
  });
});

describe('CrawlFrontier limits', () => {
  it('enforces the depth limit', () => {
    const frontier = new CrawlFrontier({ maxDepth: 1, maxPages: 50 });
    expect(frontier.enqueue('https://example.com/a', 0).status).toBe('enqueued');
    expect(frontier.enqueue('https://example.com/b', 1).status).toBe('enqueued');
    expect(frontier.enqueue('https://example.com/c', 2).status).toBe('depth_exceeded');
  });

  it('enforces the page limit', () => {
    const frontier = new CrawlFrontier({ maxDepth: 5, maxPages: 2 });
    expect(frontier.enqueue('https://example.com/a', 0).status).toBe('enqueued');
    expect(frontier.enqueue('https://example.com/b', 0).status).toBe('enqueued');
    expect(frontier.enqueue('https://example.com/c', 0).status).toBe('page_limit_reached');
  });

  it('rejects out-of-scope URLs when a scope is provided', () => {
    const frontier = new CrawlFrontier({ maxDepth: 5, maxPages: 10 });
    expect(frontier.enqueue('https://example.com/a', 0, scope).status).toBe('enqueued');
    expect(frontier.enqueue('https://external.example.com/b', 0, scope).status).toBe('out_of_scope');
  });

  it('rejects invalid URLs', () => {
    const frontier = new CrawlFrontier({ maxDepth: 5, maxPages: 10 });
    expect(frontier.enqueue('not a url', 0).status).toBe('invalid_url');
  });

  it('reports bounded statistics', () => {
    const frontier = new CrawlFrontier({ maxDepth: 2, maxPages: 10 });
    frontier.enqueue('https://example.com/a', 0);
    frontier.enqueue('https://example.com/b', 0);
    frontier.dequeue();
    frontier.markScanned();
    const stats = frontier.getStats();
    expect(stats.discovered).toBe(2);
    expect(stats.scanned).toBe(1);
    expect(stats.queued).toBe(1);
  });
});
