/**
 * Evidence projection - Artupski ReSite
 * Source of truth: docs/specs/TECHNOLOGY-DETECTION.md section 3.
 *
 * Projects the bounded `PageTechEvidence` (Phase 5 workstream 1) into the nine
 * signal vectors the engine matches against. This is the ONLY place that knows
 * how a vector is derived from the raw evidence, so the matcher stays generic.
 *
 * Security: evidence is untrusted page content. Nothing here executes page
 * code; the `jsGlobals` vector is built from boolean presence probes only, and
 * every value is already size-capped by the worker/extraction limits.
 *
 * Determinism: vector entries are deduped and kept in a stable order so the
 * same page always yields the same evidence (and therefore the same report).
 */

import type { PageTechEvidence } from '../scanner/extraction/types';
import type { TechSignalVector } from './types';

/** Maximum evidence entries examined per vector (bounds matching work). */
export const EVIDENCE_BOUNDS = {
  maxScriptSrcs: 200,
  maxCssClasses: 2000,
  maxHtmlChars: 8192,
  maxNetworkUrls: 300
} as const;

/** A single derived evidence item for one vector. */
export interface EvidenceItem {
  /** The value the rule pattern is tested against. */
  value: string;
}

/** The full, derived evidence set for one page. */
export interface PageEvidence {
  pageUrl: string;
  vectors: Record<TechSignalVector, EvidenceItem[]>;
  /** True when the HTML snippet was capped and may hide later signatures. */
  htmlTruncated: boolean;
}

const VECTOR_KEYS: readonly TechSignalVector[] = [
  'meta',
  'scriptSrc',
  'jsGlobals',
  'headers',
  'cookies',
  'htmlRegex',
  'cssClasses',
  'domElements',
  'networkRequests'
];

/** Extract distinct class tokens from the HTML snippet (bounded). */
function extractCssClasses(html: string): string[] {
  const classes = new Set<string>();
  const classAttr = /class="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = classAttr.exec(html)) !== null && classes.size < EVIDENCE_BOUNDS.maxCssClasses) {
    for (const token of match[1]!.split(/\s+/)) {
      if (token.length > 0 && classes.size < EVIDENCE_BOUNDS.maxCssClasses) {
        classes.add(token);
      }
    }
  }
  return [...classes];
}

/** Extract distinct same-origin/absolute URLs referenced by the HTML (bounded). */
function extractNetworkUrls(html: string): string[] {
  const urls = new Set<string>();
  const urlAttr = /(?:href|src|action)="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = urlAttr.exec(html)) !== null && urls.size < EVIDENCE_BOUNDS.maxNetworkUrls) {
    const value = match[1]!.trim();
    if (value.length > 0 && !value.startsWith('data:') && !value.startsWith('javascript:')) {
      urls.add(value);
    }
  }
  return [...urls];
}

function toItems(values: readonly string[]): EvidenceItem[] {
  return values.map((value) => ({ value }));
}

/**
 * Build the nine-vector evidence set for one page. `networkRequests` is derived
 * from the HTML's `href`/`src`/`action` attributes (the Phase 4 crawler does not
 * yet record a HAR); this is documented as a limitation, not a silent gap.
 */
export function buildPageEvidence(pageUrl: string, tech: PageTechEvidence): PageEvidence {
  const html = tech.htmlSnippet ?? '';
  const htmlTruncated = html.length >= EVIDENCE_BOUNDS.maxHtmlChars;

  const vectors: Record<TechSignalVector, EvidenceItem[]> = {
    meta: toItems(
      Object.entries(tech.metaTags ?? {}).map(([key, value]) => `${key}=${value}`)
    ),
    scriptSrc: toItems((tech.scriptSrcs ?? []).slice(0, EVIDENCE_BOUNDS.maxScriptSrcs)),
    jsGlobals: toItems(
      Object.entries(tech.jsGlobals ?? {})
        .filter(([, present]) => present)
        .map(([name]) => name)
    ),
    headers: toItems(
      Object.entries(tech.responseHeaders ?? {}).map(([name, value]) => `${name}:${value}`)
    ),
    cookies: toItems(tech.cookieNames ?? []),
    htmlRegex: toItems(html.length > 0 ? [html] : []),
    cssClasses: toItems(extractCssClasses(html)),
    domElements: toItems(tech.domMarkers ?? []),
    networkRequests: toItems(extractNetworkUrls(html))
  };

  return { pageUrl, vectors, htmlTruncated };
}

/** Empty evidence for a page (used when a page has no tech evidence). */
export function emptyPageEvidence(pageUrl: string): PageEvidence {
  const vectors = {} as Record<TechSignalVector, EvidenceItem[]>;
  for (const key of VECTOR_KEYS) {
    vectors[key] = [];
  }
  return { pageUrl, vectors, htmlTruncated: false };
}

export { VECTOR_KEYS };
