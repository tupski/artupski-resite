/**
 * Extraction normalization - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md sections 2.2 and 3.
 *
 * Turns raw, untrusted page evidence into a bounded `NormalizedPage`:
 *   - trims and length-caps every text field;
 *   - caps collection sizes;
 *   - resolves + normalizes every link, dedupes it, and classifies it as
 *     internal or external against the crawl scope;
 *   - classifies image references as internal/external.
 *
 * Pure: no browser, no I/O. The worker calls this before serializing a result.
 */
import { classifyLink, type CrawlScope } from '../crawlScope.ts';
import { resolveAndNormalize } from '../normalization.ts';
import { EXTRACTION_LIMITS, trimToNull, trimToString } from './limits.ts';
import type { NormalizedPage, PageExtraction, PageHeading, PageImageRef, PageStatus } from './types.ts';

export interface NormalizeContext {
  scope: CrawlScope;
  status?: PageStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** ISO timestamp; defaults to now. */
  capturedAt?: string;
}

function normalizeHeadings(headings: PageHeading[]): PageHeading[] {
  const result: PageHeading[] = [];
  for (const heading of headings.slice(0, EXTRACTION_LIMITS.maxHeadings)) {
    const text = trimToString(heading.text, EXTRACTION_LIMITS.maxHeadingTextLength);
    if (text.length === 0) {
      continue;
    }
    const level = Number.isInteger(heading.level) ? Math.min(6, Math.max(1, heading.level)) : 1;
    result.push({ level, text });
  }
  return result;
}

function normalizeLinks(
  links: string[],
  baseUrl: string,
  scope: CrawlScope
): { internal: string[]; external: string[] } {
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const raw of links.slice(0, EXTRACTION_LIMITS.maxLinks)) {
    const resolved = resolveAndNormalize(baseUrl, raw);
    if (!resolved || resolved.length > EXTRACTION_LIMITS.maxUrlLength) {
      continue;
    }
    if (classifyLink(resolved, scope) === 'internal') {
      internal.add(resolved);
    } else {
      external.add(resolved);
    }
  }
  return { internal: [...internal], external: [...external] };
}

function normalizeImages(
  images: Array<{ src: string; alt: string }>,
  baseUrl: string,
  scope: CrawlScope
): PageImageRef[] {
  const result: PageImageRef[] = [];
  const seen = new Set<string>();
  for (const image of images.slice(0, EXTRACTION_LIMITS.maxImages)) {
    const src = resolveAndNormalize(baseUrl, image.src);
    if (!src || src.length > EXTRACTION_LIMITS.maxUrlLength || seen.has(src)) {
      continue;
    }
    seen.add(src);
    result.push({
      src,
      alt: trimToString(image.alt, EXTRACTION_LIMITS.maxAltTextLength),
      internal: classifyLink(src, scope) === 'internal'
    });
  }
  return result;
}

/** Build a normalized page result from raw extraction evidence. */
export function normalizeExtraction(raw: PageExtraction, context: NormalizeContext): NormalizedPage {
  const baseUrl = raw.finalUrl || raw.requestedUrl;
  const links = normalizeLinks(raw.links, baseUrl, context.scope);
  const warnings = raw.warnings
    .slice(0, EXTRACTION_LIMITS.maxWarnings)
    .map((warning) => trimToString(warning, EXTRACTION_LIMITS.maxTextFieldLength))
    .filter((warning) => warning.length > 0);

  return {
    requestedUrl: trimToString(raw.requestedUrl, EXTRACTION_LIMITS.maxUrlLength),
    finalUrl: trimToString(raw.finalUrl, EXTRACTION_LIMITS.maxUrlLength),
    httpStatus: raw.httpStatus,
    title: trimToString(raw.title, EXTRACTION_LIMITS.maxTextFieldLength),
    metaDescription: trimToNull(raw.metaDescription, EXTRACTION_LIMITS.maxTextFieldLength),
    canonicalUrl: raw.canonicalUrl
      ? resolveAndNormalize(baseUrl, raw.canonicalUrl)
      : null,
    robotsMeta: trimToNull(raw.robotsMeta, EXTRACTION_LIMITS.maxTextFieldLength),
    headings: normalizeHeadings(raw.headings),
    internalLinks: links.internal,
    externalLinks: links.external,
    images: normalizeImages(raw.images, baseUrl, context.scope),
    metrics: {
      loadTimeMs: Math.max(0, Math.round(raw.metrics.loadTimeMs)),
      domContentLoadedTimeMs: Math.max(0, Math.round(raw.metrics.domContentLoadedTimeMs)),
      domNodeCount: Math.max(0, Math.round(raw.metrics.domNodeCount))
    },
    status: context.status ?? 'completed',
    errorCode: context.errorCode ?? null,
    errorMessage: trimToNull(context.errorMessage, EXTRACTION_LIMITS.maxTextFieldLength),
    warnings,
    capturedAt: context.capturedAt ?? new Date().toISOString()
  };
}

/** Build a normalized failure/skip page without raw evidence. */
export function buildUnavailablePage(
  url: string,
  context: NormalizeContext & { status: PageStatus; errorCode: string; errorMessage: string }
): NormalizedPage {
  return {
    requestedUrl: trimToString(url, EXTRACTION_LIMITS.maxUrlLength),
    finalUrl: trimToString(url, EXTRACTION_LIMITS.maxUrlLength),
    httpStatus: null,
    title: '',
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    metrics: { loadTimeMs: 0, domContentLoadedTimeMs: 0, domNodeCount: 0 },
    status: context.status,
    errorCode: context.errorCode,
    errorMessage: trimToNull(context.errorMessage, EXTRACTION_LIMITS.maxTextFieldLength),
    warnings: [],
    capturedAt: context.capturedAt ?? new Date().toISOString()
  };
}
