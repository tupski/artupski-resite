/**
 * Signal matcher - Artupski ReSite
 * Source of truth: docs/specs/TECHNOLOGY-DETECTION.md sections 3 and 4.2.
 *
 * Matches ONE rule's signals against a page's derived evidence. Kept separate
 * from the engine (which aggregates across pages) and from the rules (data), so
 * matching logic lives in exactly one place.
 *
 * Anti-overmatch: at most one weight is contributed per `vector:pattern` per
 * page - a page cannot inflate a score by repeating a marker. Regexes are
 * authored narrowly in `rules.ts` and compiled once, cached by source string.
 */

import type { RuleSignal, TechnologyRule } from './rules';
import type { PageEvidence } from './evidence';
import { extractVersion, preferVersion, type VersionResult } from './version';

/** A signal that matched, with the evidence that produced it. */
export interface SignalMatch {
  vector: RuleSignal['vector'];
  /** Stable dedupe key: `vector:pattern`. */
  key: string;
  evidence: string;
  weight: number;
  version: VersionResult;
}

const regexCache = new Map<string, RegExp>();

function compiled(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached) {
    return cached;
  }
  try {
    const regex = new RegExp(pattern, 'i');
    regexCache.set(pattern, regex);
    return regex;
  } catch {
    return null;
  }
}

/**
 * Test one signal against the page's evidence. Returns the first matching
 * evidence item (deterministic order) or null. `jsGlobals` matches by exact
 * global name; `meta`/`headers`/`cookies`/`domElements` compare by exact name or
 * prefix; everything else is a regex over the vector's values.
 */
export function matchSignal(signal: RuleSignal, evidence: PageEvidence): SignalMatch | null {
  const items = evidence.vectors[signal.vector] ?? [];
  const key = `${signal.vector}:${signal.match ?? 'regex'}:${signal.pattern}`;

  for (const item of items) {
    const hit = testItem(signal, item.value);
    if (hit) {
      return {
        vector: signal.vector,
        key,
        evidence: truncateEvidence(item.value, hit),
        weight: signal.weight,
        version: extractVersion(item.value, signal.versionRegex, signal.versionKind ?? 'exact')
      };
    }
  }
  return null;
}

/** Apply the signal's match semantics to a single evidence value. */
function testItem(signal: RuleSignal, value: string): boolean {
  const mode = signal.match ?? 'regex';
  switch (mode) {
    case 'header': {
      // `/^name:/i`-style test: `name` is the header name, value ignored here.
      const separator = value.indexOf(':');
      const name = (separator >= 0 ? value.slice(0, separator) : value).trim().toLowerCase();
      return name === signal.pattern.toLowerCase();
    }
    case 'cookie':
      return value.toLowerCase().startsWith(signal.pattern.toLowerCase());
    case 'metaKey': {
      const separator = value.indexOf('=');
      const name = (separator >= 0 ? value.slice(0, separator) : '').trim().toLowerCase();
      return name === signal.pattern.toLowerCase();
    }
    case 'global':
      return value === signal.pattern;
    case 'marker':
      return value.toLowerCase() === signal.pattern.toLowerCase();
    case 'regex': {
      const regex = compiled(signal.pattern);
      return regex ? regex.test(value) : false;
    }
    default:
      return false;
  }
}

/** Keep evidence snippets short and bounded for storage/display. */
function truncateEvidence(value: string, _matched: boolean): string {
  const MAX = 256;
  return value.length > MAX ? `${value.slice(0, MAX)}...` : value;
}

export interface RuleMatchResult {
  rule: TechnologyRule;
  matches: SignalMatch[];
}

/**
 * Match a rule against a page's evidence. Every distinct signal key contributes
 * at most once (dedupe), preserving the rule's declared order for determinism.
 */
export function matchRule(rule: TechnologyRule, evidence: PageEvidence): RuleMatchResult {
  const matches: SignalMatch[] = [];
  const seen = new Set<string>();
  for (const signal of rule.signals) {
    const match = matchSignal(signal, evidence);
    if (match && !seen.has(match.key)) {
      seen.add(match.key);
      matches.push(match);
    }
  }
  return { rule, matches };
}

/** Fold a set of signal matches into a single aggregate version result. */
export function aggregateVersion(matches: readonly SignalMatch[]): VersionResult {
  let result: VersionResult = { version: null, status: 'unavailable' };
  for (const match of matches) {
    result = preferVersion(result, match.version);
  }
  return result;
}
