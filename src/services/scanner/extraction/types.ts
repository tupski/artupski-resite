/**
 * Page extraction contract - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md section 3 (ScannedPageModel).
 *
 * Phase 4 extracts page metadata and structure ONLY. DOM snapshots, computed
 * styles, HAR recordings, screenshots, and assets are later phases and are
 * deliberately absent here (do not invent an oversized schema).
 *
 * Two layers are kept explicitly separate:
 *   - `PageExtraction`: the RAW evidence returned by the in-page extractor
 *     (untrusted strings, possibly over-long, exactly as the page produced
 *     them). It is validated and size-bounded at the worker boundary.
 *   - `NormalizedPage`: the NORMALIZED shape the host consumes, after limits
 *     and field trimming are applied. Persistence models (a later workstream)
 *     map from this, never from the raw evidence.
 */

/** Outcome of attempting to extract one page. */
export type PageStatus = 'completed' | 'failed' | 'timeout' | 'skipped';

export interface PageHeading {
  level: number;
  text: string;
}

export interface PageImageRef {
  src: string;
  alt: string;
  /** True when the image source is on the same host as the page. */
  internal: boolean;
}

export interface PageMetrics {
  loadTimeMs: number;
  domContentLoadedTimeMs: number;
  domNodeCount: number;
}

/** Raw evidence extracted from a loaded page by the in-page script. */
export interface PageExtraction {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  headings: PageHeading[];
  links: string[];
  images: Array<{ src: string; alt: string }>;
  metrics: PageMetrics;
  /** Extraction-level warnings (e.g. "title missing"), never fatal. */
  warnings: string[];
}

/** Normalized, bounded page result consumed by the host. */
export interface NormalizedPage {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  headings: PageHeading[];
  internalLinks: string[];
  externalLinks: string[];
  images: PageImageRef[];
  metrics: PageMetrics;
  status: PageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: string[];
  capturedAt: string;
}
