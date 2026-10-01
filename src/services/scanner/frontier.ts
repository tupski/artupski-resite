/**
 * Crawl frontier - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md sections 2.1 and 2.2.
 *
 * A bounded, deterministic breadth-first frontier. It guarantees:
 *   - duplicate links collapse to a single entry (canonical-key dedupe);
 *   - depth and page limits are hard bounds (never exceeded);
 *   - ordering is deterministic (FIFO), so runs are reproducible;
 *   - loops are prevented because a URL is only ever enqueued once.
 *
 * The frontier is pure state (no browser, no I/O), so traversal rules are
 * unit-testable in isolation. Scope and URL-policy checks happen before an
 * item reaches `enqueue`.
 */
import { canonicalKey } from './normalization.ts';
import { isUrlInScope, type CrawlScope } from './crawlScope.ts';

export interface FrontierItem {
  url: string;
  depth: number;
}

export interface FrontierOptions {
  maxDepth: number;
  maxPages: number;
  /** Strip trailing slashes during canonicalization. Default: true. */
  stripTrailingSlash?: boolean;
}

export type EnqueueStatus =
  | 'enqueued'
  | 'duplicate'
  | 'invalid_url'
  | 'out_of_scope'
  | 'depth_exceeded'
  | 'page_limit_reached';

export interface EnqueueResult {
  status: EnqueueStatus;
  /** Canonical key, when the URL was valid enough to canonicalize. */
  key: string | null;
  url: string;
  depth: number;
}

export interface FrontierStats {
  discovered: number;
  scanned: number;
  queued: number;
  maxDepth: number;
  maxPages: number;
}

export class CrawlFrontier {
  private readonly maxDepth: number;
  private readonly maxPages: number;
  private readonly stripTrailingSlash: boolean;
  private readonly queue: FrontierItem[] = [];
  private readonly seen = new Set<string>();
  private scanned = 0;

  constructor(options: FrontierOptions) {
    this.maxDepth = Math.max(0, Math.floor(options.maxDepth));
    this.maxPages = Math.max(1, Math.floor(options.maxPages));
    this.stripTrailingSlash = options.stripTrailingSlash ?? true;
  }

  /**
   * Attempt to add a URL to the frontier. The scope check is optional: when a
   * scope is supplied, out-of-scope URLs are rejected here (external links are
   * catalogued elsewhere and must not enter the frontier).
   */
  enqueue(url: string, depth: number, scope?: CrawlScope): EnqueueResult {
    const key = canonicalKey(url, { stripTrailingSlash: this.stripTrailingSlash });
    if (key === null) {
      return { status: 'invalid_url', key: null, url, depth };
    }
    if (depth > this.maxDepth) {
      return { status: 'depth_exceeded', key, url, depth };
    }
    if (this.seen.has(key)) {
      return { status: 'duplicate', key, url, depth };
    }
    if (this.seen.size >= this.maxPages) {
      return { status: 'page_limit_reached', key, url, depth };
    }
    if (scope && !isUrlInScope(key, scope)) {
      return { status: 'out_of_scope', key, url, depth };
    }

    this.seen.add(key);
    this.queue.push({ url: key, depth });
    return { status: 'enqueued', key, url: key, depth };
  }

  /** Remove and return the next item (FIFO / breadth-first). */
  dequeue(): FrontierItem | null {
    return this.queue.shift() ?? null;
  }

  /** Record that a page finished scanning. */
  markScanned(): void {
    this.scanned += 1;
  }

  hasQueuedWork(): boolean {
    return this.queue.length > 0;
  }

  hasReachedPageLimit(): boolean {
    return this.scanned >= this.maxPages;
  }

  isSeen(url: string): boolean {
    const key = canonicalKey(url, { stripTrailingSlash: this.stripTrailingSlash });
    return key !== null && this.seen.has(key);
  }

  getStats(): FrontierStats {
    return {
      discovered: this.seen.size,
      scanned: this.scanned,
      queued: this.queue.length,
      maxDepth: this.maxDepth,
      maxPages: this.maxPages
    };
  }
}
