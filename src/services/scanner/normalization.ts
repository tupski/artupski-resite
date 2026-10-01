/**
 * URL normalization & canonicalization - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md section 2.2.
 *
 * Deterministic normalization is what makes duplicate detection and the crawl
 * frontier reliable: the same logical page must always reduce to the same key.
 * Rules (from the spec):
 *   - strip fragments;
 *   - strip tracking query parameters (`utm_*`, `fbclid`, `gclid`, `ref`,
 *     `mc_eid`, `_ga`);
 *   - alphabetically sort the remaining query parameters;
 *   - lowercase the hostname (the `URL` parser already does this);
 *   - normalize trailing slashes (default: strip for non-root paths).
 *
 * These functions are pure and shared by the host and the worker.
 */

export interface NormalizationOptions {
  /** Strip a trailing slash from non-root paths. Default: true. */
  stripTrailingSlash?: boolean;
}

/** Query parameters that never identify a distinct page (tracking/marketing). */
const TRACKING_PARAMS = new Set(['ref', 'mc_eid', '_ga']);

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_EXACT = new Set(['fbclid', 'gclid']);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower) || TRACKING_PARAM_EXACT.has(lower)) {
    return true;
  }
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Normalize an absolute URL. Returns `null` for input that is not a valid
 * absolute URL (relative references must be resolved by the caller first).
 */
export function normalizeUrl(rawUrl: string, options: NormalizationOptions = {}): string | null {
  const stripTrailingSlash = options.stripTrailingSlash ?? true;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  parsed.hash = '';

  // Rebuild the search string with tracking params removed and the rest sorted.
  const params = [...parsed.searchParams.entries()].filter(([name]) => !isTrackingParam(name));
  params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const search = new URLSearchParams();
  for (const [name, value] of params) {
    search.append(name, value);
  }
  parsed.search = search.toString();

  if (stripTrailingSlash && parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.href;
}

/**
 * Canonical key used for duplicate detection. Two URLs that normalize to the
 * same key refer to the same crawl target and must not be enqueued twice.
 */
export function canonicalKey(rawUrl: string, options: NormalizationOptions = {}): string | null {
  const normalized = normalizeUrl(rawUrl, options);
  if (normalized === null) {
    return null;
  }
  return normalized;
}

/**
 * Resolve a possibly-relative reference against a base URL, then normalize it.
 * Returns `null` when the reference cannot be resolved to an absolute URL or
 * uses a non-hierarchical scheme the crawler cannot follow.
 */
export function resolveAndNormalize(
  baseUrl: string,
  reference: string,
  options: NormalizationOptions = {}
): string | null {
  const trimmed = reference.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Skip non-navigational schemes early (mailto:, tel:, javascript:, data:, ...).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^https?:/i.test(trimmed) && !/^\/\//.test(trimmed)) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    return normalizeUrl(resolved.href, options);
  } catch {
    return null;
  }
}
