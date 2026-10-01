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

/**
 * Bounded technology-detection evidence captured from a page (Phase 5).
 *
 * All fields are untrusted page content and are size-capped by
 * `EXTRACTION_LIMITS` before they leave the worker. They are carried on the
 * normalized page so the detection engine can run on already-collected,
 * bounded evidence without any additional network access.
 *
 * `jsGlobals` holds only boolean presence probes (never evaluated values), so
 * no site script is executed to build this record.
 */
export interface PageTechEvidence {
  /** Lower-cased response header name -> value (values may be trimmed). */
  responseHeaders: Record<string, string>;
  /** Cookie name -> value length only; raw values are never retained. */
  cookieNames: string[];
  /** Absolute or page-relative script `src` URLs, deduped and capped. */
  scriptSrcs: string[];
  /** `<meta name|property>` -> content for technology-relevant meta tags. */
  metaTags: Record<string, string>;
  /** Known custom-element / distinctive element markers present on the page. */
  domMarkers: string[];
  /** Boolean presence probes of well-known JS globals (never their values). */
  jsGlobals: Record<string, boolean>;
  /** Bounded structural HTML signature snippet (head/first N bytes), no body text. */
  htmlSnippet: string;
}

/** An all-empty evidence record (used for failure/skip pages and fixtures). */
export function createEmptyTechEvidence(): PageTechEvidence {
  return {
    responseHeaders: {},
    cookieNames: [],
    scriptSrcs: [],
    metaTags: {},
    domMarkers: [],
    jsGlobals: {},
    htmlSnippet: ''
  };
}

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
  /** Phase 5 detection evidence (bounded; see `PageTechEvidence`). */
  tech: PageTechEvidence;
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
  /** Bounded Phase 5 detection evidence; absent on failure/skip pages. */
  tech?: PageTechEvidence;
  status: PageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: string[];
  capturedAt: string;
}
