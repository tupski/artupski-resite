/**
 * Shared, pure helpers for the Blueprint normalization engine - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.
 *
 * These helpers are deterministic by construction: ordering is always explicit
 * (sorted keys / insertion order from sorted input) so identical evidence always
 * yields an identical Blueprint. They contain no I/O and no browser access.
 */

/** Normalize an arbitrary string into a lowercase, hyphenated slug segment. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Collapse whitespace and trim; returns '' for nullish input. */
export function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** A stable, bounded id derived from a human label plus a deterministic suffix. */
export function stableId(prefix: string, label: string, suffix: string | number): string {
  const slug = slugify(label) || 'item';
  return `${prefix}_${slug}_${String(suffix)}`;
}

/** Sort an object's own keys ascending into a new record (stable ordering). */
export function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = record[key] as T;
  }
  return out;
}

/** Return a copy of `values` with duplicates removed, preserving first-seen order. */
export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** True when `value` is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a JSON string into an unknown value, or null when invalid. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Encode a string as UTF-8 bytes without a Node-only dependency. */
export function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  return new Uint8Array(bufferCtor.from(text, 'utf8'));
}

/** Decode UTF-8 bytes into a string without a Node-only dependency. */
export function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  return bufferCtor.from(bytes).toString('utf8');
}
