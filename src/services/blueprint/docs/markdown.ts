/**
 * Markdown emission helpers for the blueprint documentation generator.
 *
 * These mirror the neutralization rules of `src/services/exporter/docGenerator.ts`
 * so generated documents can never be broken by untrusted Blueprint text: pipes
 * are escaped inside table cells, a leading `#` is escaped in headings, backticks
 * use a dynamically sized code span, and newlines are collapsed. All helpers are
 * pure and dependency-free.
 */

/** Longest run of consecutive backticks in `value` (for a safe code span). */
function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/** A code span whose delimiter is longer than any backtick run in `value`. */
export function codeSpan(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ');
  const ticks = '`'.repeat(longestBacktickRun(flat) + 1);
  const padded = flat.startsWith('`') || flat.endsWith('`') ? ` ${flat} ` : flat;
  return `${ticks}${padded}${ticks}`;
}

/** Prose text: backslashes/backticks escaped, newlines collapsed. */
export function text(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Heading text: a leading `#` is escaped so it cannot start a new heading. */
export function heading(value: string): string {
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim();
  return cleaned.startsWith('#') ? `\\${cleaned}` : cleaned;
}

/** A table cell: pipes escaped, newlines collapsed, wrapped in a code span. */
export function cell(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
  return codeSpan(flat);
}

/** A fenced code block whose fence is longer than any backtick run in `body`. */
export function fenced(body: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}

/** A Markdown table from a header row and already-`cell`-escaped body rows. */
export function table(headers: readonly string[], rows: readonly string[][]): string {
  const header = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => ':---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

/** A bullet list from already-safe strings; empty input yields an empty array. */
export function bullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

/** True when `values` has at least one entry (a section should be emitted). */
export function hasAny(values: readonly unknown[]): boolean {
  return values.length > 0;
}

/** Render a `Record<string, string>` as a two-column `Key`/`Value` table. */
export function recordTable(record: Record<string, string>): string {
  const rows = Object.keys(record)
    .sort()
    .map((key) => [cell(key), cell(record[key] as string)]);
  return table(['Key', 'Value'], rows);
}
