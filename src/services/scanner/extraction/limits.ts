/**
 * Extraction size limits - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md, docs/security/SECURITY.md section 4.2.
 *
 * All site data is untrusted. These hard caps bound collection sizes and field
 * lengths so a hostile page cannot exhaust worker memory or flood the host with
 * an oversized frame (the protocol already caps a frame at 64 MiB; these limits
 * keep a well-formed result comfortably below it).
 */

export const EXTRACTION_LIMITS = {
  /** Maximum characters retained for any single text field (title, meta, ...). */
  maxTextFieldLength: 512,
  /** Maximum characters retained for a link/image URL. */
  maxUrlLength: 2048,
  /** Maximum heading entries retained. */
  maxHeadings: 200,
  /** Maximum characters per heading text. */
  maxHeadingTextLength: 256,
  /** Maximum link URLs retained (before internal/external split). */
  maxLinks: 500,
  /** Maximum image references retained. */
  maxImages: 300,
  /** Maximum characters per image alt text. */
  maxAltTextLength: 512,
  /** Maximum warning strings retained. */
  maxWarnings: 50,
  /** Maximum characters retained for any single response header value. */
  maxHeaderValueLength: 512,
  /** Maximum response headers retained (technology-relevant subset). */
  maxResponseHeaders: 64,
  /** Maximum cookie names retained (values are never kept). */
  maxCookieNames: 100,
  /** Maximum script `src` URLs retained. */
  maxScriptSrcs: 200,
  /** Maximum `<meta>` tag entries retained. */
  maxMetaTags: 64,
  /** Maximum characters retained for a meta tag content value. */
  maxMetaValueLength: 512,
  /** Maximum distinctive DOM marker names retained. */
  maxDomMarkers: 100,
  /** Maximum characters retained for the structural HTML signature snippet. */
  maxHtmlSnippetLength: 8192
} as const;

/** Trim a string to a maximum length, returning null for empty results. */
export function trimToNull(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/** Trim a string to a maximum length, returning '' for empty results. */
export function trimToString(value: string | null | undefined, maxLength: number): string {
  return trimToNull(value, maxLength) ?? '';
}
