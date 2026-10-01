/**
 * Extraction size limits - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md, docs/security/SECURITY.md section 4.2.
 *
 * All site data is untrusted. These hard caps bound collection sizes and field
 * lengths so a hostile page cannot exhaust worker memory or flood the host with
 * an oversized frame (the protocol already caps a frame at 1 MiB; these limits
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
  maxWarnings: 50
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
