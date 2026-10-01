/**
 * Version extraction - Artupski ReSite
 * Source of truth: docs/specs/TECHNOLOGY-DETECTION.md section 4.3.
 *
 * Versions are only reported when a rule's matched signal carries a
 * `versionRegex` with a named `version` group AND that evidence contains a
 * concrete version string. No version is ever guessed: when extraction fails,
 * `version` is null and `versionStatus` is `unavailable`.
 *
 * The `versionRegex` patterns are authored in `rules.ts` and are all simple,
 * single-group patterns (no nesting), so catastrophic backtracking is not
 * possible.
 */

import type { VersionStatus } from './types';

export interface VersionResult {
  version: string | null;
  status: VersionStatus;
}

const UNAVAILABLE: VersionResult = { version: null, status: 'unavailable' };

/**
 * Attempt to extract a version from `evidence` using `versionRegex`. Returns the
 * first reasonable match, or `unavailable` when nothing safe was found.
 */
export function extractVersion(
  evidence: string,
  versionRegex: string | undefined,
  kind: 'exact' | 'major_only' = 'exact'
): VersionResult {
  if (!versionRegex || evidence.length === 0) {
    return UNAVAILABLE;
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(versionRegex, 'i');
  } catch {
    // A malformed rule pattern must not crash detection.
    return UNAVAILABLE;
  }
  const match = pattern.exec(evidence);
  const captured = match?.groups?.version;
  if (!captured || !isPlausibleVersion(captured)) {
    return UNAVAILABLE;
  }
  return { version: captured, status: kind };
}

/**
 * Reject captures that are clearly not versions (empty, too long, or containing
 * characters that would indicate a mis-capture). Keeps output trustworthy.
 */
export function isPlausibleVersion(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    return false;
  }
  return /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed);
}

/**
 * Merge two version results, preferring an `exact` result over `major_only`
 * over `unavailable` (a stricter extraction wins across pages).
 */
export function preferVersion(a: VersionResult, b: VersionResult): VersionResult {
  const rank: Record<VersionStatus, number> = { exact: 2, major_only: 1, unavailable: 0 };
  return rank[b.status] > rank[a.status] ? b : a;
}
