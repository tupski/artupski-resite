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
import type {
  NormalizedPage,
  PageExtraction,
  PageHeading,
  PageImageRef,
  PageStatus,
  PageTechEvidence
} from './types.ts';

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

/**
 * Normalize technical evidence: resolve script URLs against the page, dedupe,
 * cap sizes, and lower-case header names. Header VALUES are retained because
 * they are detection evidence (e.g. `server`, `x-powered-by`); they are already
 * bounded by the worker and never include request credentials. Cookie VALUES are
 * never present in the input.
 */
function normalizeTech(tech: PageTechEvidence | undefined, baseUrl: string): PageTechEvidence {
  const responseHeaders: Record<string, string> = {};
  let headerCount = 0;
  for (const [key, value] of Object.entries(tech?.responseHeaders ?? {})) {
    if (headerCount >= EXTRACTION_LIMITS.maxResponseHeaders) {
      break;
    }
    responseHeaders[key.toLowerCase()] = trimToString(
      typeof value === 'string' ? value : null,
      EXTRACTION_LIMITS.maxHeaderValueLength
    );
    headerCount += 1;
  }

  const scriptSrcs: string[] = [];
  const seenScripts = new Set<string>();
  for (const rawSrc of (tech?.scriptSrcs ?? []).slice(0, EXTRACTION_LIMITS.maxScriptSrcs)) {
    const resolved = resolveAndNormalize(baseUrl, rawSrc);
    if (!resolved || resolved.length > EXTRACTION_LIMITS.maxUrlLength || seenScripts.has(resolved)) {
      continue;
    }
    seenScripts.add(resolved);
    scriptSrcs.push(resolved);
  }

  const metaTags: Record<string, string> = {};
  let metaCount = 0;
  for (const [key, value] of Object.entries(tech?.metaTags ?? {})) {
    if (metaCount >= EXTRACTION_LIMITS.maxMetaTags) {
      break;
    }
    metaTags[key.toLowerCase()] = trimToString(
      typeof value === 'string' ? value : null,
      EXTRACTION_LIMITS.maxMetaValueLength
    );
    metaCount += 1;
  }

  const jsGlobals: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(tech?.jsGlobals ?? {})) {
    jsGlobals[key] = value === true;
  }

  return {
    responseHeaders,
    cookieNames: (tech?.cookieNames ?? []).slice(0, EXTRACTION_LIMITS.maxCookieNames),
    scriptSrcs,
    metaTags,
    domMarkers: (tech?.domMarkers ?? []).slice(0, EXTRACTION_LIMITS.maxDomMarkers),
    jsGlobals,
    htmlSnippet: trimToString(tech?.htmlSnippet, EXTRACTION_LIMITS.maxHtmlSnippetLength) ?? ''
  };
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
    tech: normalizeTech(raw.tech, baseUrl),
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
    tech: {
      responseHeaders: {},
      cookieNames: [],
      scriptSrcs: [],
      metaTags: {},
      domMarkers: [],
      jsGlobals: {},
      htmlSnippet: ''
    },
    status: context.status,
    errorCode: context.errorCode,
    errorMessage: trimToNull(context.errorMessage, EXTRACTION_LIMITS.maxTextFieldLength),
    warnings: [],
    capturedAt: context.capturedAt ?? new Date().toISOString()
  };
}
