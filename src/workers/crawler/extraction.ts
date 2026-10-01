/**
 * Worker-side extraction harness - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md sections 3 and 5.
 *
 * Runs the self-contained in-page extractor inside a Playwright page and
 * returns the raw evidence. All numeric fields are coerced defensively because
 * page content is untrusted and a hostile page can return arbitrary types.
 *
 * This module is worker-only (it imports `playwright-core` types lazily via the
 * caller). It holds no policy and no normalization - those stay pure and shared.
 */
import { PAGE_EXTRACTOR_EXPRESSION } from '../../services/scanner/extraction/inPageExtractor.ts';
import type { PageExtraction, PageTechEvidence } from '../../services/scanner/extraction/types.ts';
import { EXTRACTION_LIMITS, trimToString } from '../../services/scanner/extraction/limits.ts';

/** The minimal Playwright page surface this harness needs. */
export interface ExtractablePage {
  evaluate<T>(expression: string): Promise<T>;
}

interface RawExtraction {
  title?: unknown;
  metaDescription?: unknown;
  canonicalUrl?: unknown;
  robotsMeta?: unknown;
  headings?: unknown;
  links?: unknown;
  images?: unknown;
  metrics?: unknown;
  tech?: unknown;
  warnings?: unknown;
}

/** Worker-supplied evidence that lives on the response, not in the DOM. */
export interface ExtractionContext {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  /** Raw response headers (lower-cased name -> value). Optional. */
  responseHeaders?: Record<string, string>;
  /** Raw `set-cookie` header values; only names are retained downstream. */
  setCookieHeaders?: string[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function coerceHeadings(value: unknown): Array<{ level: number; text: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Array<{ level: number; text: string }> = [];
  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const text = asString(record.text);
      if (text.length > 0) {
        result.push({ level: Math.trunc(asNumber(record.level)) || 1, text });
      }
    }
  }
  return result;
}

function coerceLinks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function coerceImages(value: unknown): Array<{ src: string; alt: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Array<{ src: string; alt: string }> = [];
  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const src = asString(record.src);
      if (src.length > 0) {
        result.push({ src, alt: asString(record.alt) });
      }
    }
  }
  return result;
}

function coerceWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function coerceStringArray(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const entry of value.slice(0, max)) {
    const text = trimToString(typeof entry === 'string' ? entry : null, maxLength);
    if (text) {
      result.push(text);
    }
  }
  return result;
}

function coerceStringRecord(value: unknown, max: number, maxValueLength: number): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object') {
    return result;
  }
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= max) {
      break;
    }
    if (typeof raw === 'string') {
      result[key.toLowerCase()] = raw.length > maxValueLength ? raw.slice(0, maxValueLength) : raw;
      count += 1;
    }
  }
  return result;
}

function coerceBooleanRecord(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!value || typeof value !== 'object') {
    return result;
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = raw === true;
  }
  return result;
}

/**
 * Extract only the cookie NAME from a `set-cookie` header value. The value is
 * never retained (security: session cookies must not reach storage or logs).
 */
function cookieNameFromSetCookie(header: string): string | null {
  const name = header.split('=', 1)[0]?.trim();
  return name && name.length > 0 ? name : null;
}

function coerceTech(raw: unknown, context: ExtractionContext): PageTechEvidence {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const cookieNames = new Set<string>(coerceStringArray(record.cookieNames, EXTRACTION_LIMITS.maxCookieNames, 128));
  for (const header of context.setCookieHeaders ?? []) {
    const name = cookieNameFromSetCookie(header);
    if (name && cookieNames.size < EXTRACTION_LIMITS.maxCookieNames) {
      cookieNames.add(name);
    }
  }
  return {
    responseHeaders: coerceStringRecord(
      context.responseHeaders ?? record.responseHeaders,
      EXTRACTION_LIMITS.maxResponseHeaders,
      EXTRACTION_LIMITS.maxHeaderValueLength
    ),
    cookieNames: [...cookieNames],
    scriptSrcs: coerceStringArray(record.scriptSrcs, EXTRACTION_LIMITS.maxScriptSrcs, EXTRACTION_LIMITS.maxUrlLength),
    metaTags: coerceStringRecord(record.metaTags, EXTRACTION_LIMITS.maxMetaTags, EXTRACTION_LIMITS.maxMetaValueLength),
    domMarkers: coerceStringArray(record.domMarkers, EXTRACTION_LIMITS.maxDomMarkers, 128),
    jsGlobals: coerceBooleanRecord(record.jsGlobals),
    htmlSnippet: trimToString(
      typeof record.htmlSnippet === 'string' ? record.htmlSnippet : null,
      EXTRACTION_LIMITS.maxHtmlSnippetLength
    ) ?? ''
  };
}

/**
 * Execute the in-page extractor against `page` and return validated raw
 * evidence. `requestedUrl`/`finalUrl`/`httpStatus` are supplied by the caller
 * because they come from the navigation response, not the DOM.
 */
export async function extractPageEvidence(
  page: ExtractablePage,
  context: ExtractionContext
): Promise<PageExtraction> {
  const raw = await page.evaluate<RawExtraction>(PAGE_EXTRACTOR_EXPRESSION);

  const metricsRaw = raw && typeof raw.metrics === 'object' && raw.metrics !== null ? (raw.metrics as Record<string, unknown>) : {};

  return {
    requestedUrl: context.requestedUrl,
    finalUrl: context.finalUrl,
    httpStatus: context.httpStatus,
    title: asString(raw?.title),
    metaDescription: asStringOrNull(raw?.metaDescription),
    canonicalUrl: asStringOrNull(raw?.canonicalUrl),
    robotsMeta: asStringOrNull(raw?.robotsMeta),
    headings: coerceHeadings(raw?.headings),
    links: coerceLinks(raw?.links),
    images: coerceImages(raw?.images),
    metrics: {
      loadTimeMs: asNumber(metricsRaw.loadTimeMs),
      domContentLoadedTimeMs: asNumber(metricsRaw.domContentLoadedTimeMs),
      domNodeCount: asNumber(metricsRaw.domNodeCount)
    },
    tech: coerceTech(raw?.tech, context),
    warnings: coerceWarnings(raw?.warnings)
  };
}
