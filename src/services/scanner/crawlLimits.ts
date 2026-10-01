/**
 * Crawl resource limits - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md section 4.2 and AGENTS.md section 4
 * ("zero headless hangs", navigation timeout max 30s).
 *
 * Every value has a documented hard ceiling. Caller-supplied configuration is
 * clamped into `[min, hardMax]`, so no input can raise a limit beyond what the
 * process is designed to sustain (bounded queues, bounded memory, bounded
 * writes). Defaults are deliberately conservative.
 */

export interface CrawlLimits {
  /** Maximum pages to crawl. */
  maxPages: number;
  /** Maximum link distance from the seed. */
  maxDepth: number;
  /**
   * Parallel extractions. Bounded to 1: the Phase 3/4 worker keeps a single
   * active abort controller per browser session, so concurrent extractions on
   * one session are unsafe. Traversal is a sequential BFS.
   */
  maxConcurrency: number;
  /** Per-navigation timeout (worker clamps to <= 30s). */
  navigationTimeoutMs: number;
  /** Redirects a single extraction may follow (worker caps at 5). */
  maxRedirects: number;
  /** Page records buffered before a single batched write. */
  persistenceBatchSize: number;
  /** Emit a coalesced progress event at most once every N scanned pages. */
  progressEveryPages: number;
  /** Abort the crawl after this many recoverable page failures. */
  maxPageFailures: number;
  /** Retries for a single page when the failure is retryable. */
  maxRetriesPerPage: number;
}

/** Absolute ceilings - never exceeded regardless of caller configuration. */
export const HARD_CRAWL_LIMITS: Readonly<CrawlLimits> = {
  maxPages: 200,
  maxDepth: 6,
  maxConcurrency: 1,
  navigationTimeoutMs: 30_000,
  maxRedirects: 5,
  persistenceBatchSize: 100,
  progressEveryPages: 50,
  maxPageFailures: 50,
  maxRetriesPerPage: 3
};

/** Conservative defaults applied when a caller supplies nothing. */
export const DEFAULT_CRAWL_LIMITS: Readonly<CrawlLimits> = {
  maxPages: 50,
  maxDepth: 2,
  maxConcurrency: 1,
  navigationTimeoutMs: 30_000,
  maxRedirects: 5,
  persistenceBatchSize: 20,
  progressEveryPages: 5,
  maxPageFailures: 20,
  maxRetriesPerPage: 1
};

/** Minimums that still make a crawl meaningful. */
const MIN_CRAWL_LIMITS: Readonly<CrawlLimits> = {
  maxPages: 1,
  maxDepth: 0,
  maxConcurrency: 1,
  navigationTimeoutMs: 100,
  maxRedirects: 0,
  persistenceBatchSize: 1,
  progressEveryPages: 1,
  maxPageFailures: 1,
  maxRetriesPerPage: 0
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Clamp a partial limit set into documented hard bounds. */
export function resolveCrawlLimits(overrides: Partial<CrawlLimits> = {}): CrawlLimits {
  const base = DEFAULT_CRAWL_LIMITS;
  const hard = HARD_CRAWL_LIMITS;
  const min = MIN_CRAWL_LIMITS;
  return {
    maxPages: clampInt(overrides.maxPages, base.maxPages, min.maxPages, hard.maxPages),
    maxDepth: clampInt(overrides.maxDepth, base.maxDepth, min.maxDepth, hard.maxDepth),
    maxConcurrency: clampInt(overrides.maxConcurrency, base.maxConcurrency, min.maxConcurrency, hard.maxConcurrency),
    navigationTimeoutMs: clampInt(
      overrides.navigationTimeoutMs,
      base.navigationTimeoutMs,
      min.navigationTimeoutMs,
      hard.navigationTimeoutMs
    ),
    maxRedirects: clampInt(overrides.maxRedirects, base.maxRedirects, min.maxRedirects, hard.maxRedirects),
    persistenceBatchSize: clampInt(
      overrides.persistenceBatchSize,
      base.persistenceBatchSize,
      min.persistenceBatchSize,
      hard.persistenceBatchSize
    ),
    progressEveryPages: clampInt(
      overrides.progressEveryPages,
      base.progressEveryPages,
      min.progressEveryPages,
      hard.progressEveryPages
    ),
    maxPageFailures: clampInt(
      overrides.maxPageFailures,
      base.maxPageFailures,
      min.maxPageFailures,
      hard.maxPageFailures
    ),
    maxRetriesPerPage: clampInt(
      overrides.maxRetriesPerPage,
      base.maxRetriesPerPage,
      min.maxRetriesPerPage,
      hard.maxRetriesPerPage
    )
  };
}
