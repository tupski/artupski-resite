/**
 * Detection engine - Artupski ReSite
 * Source of truth: docs/specs/TECHNOLOGY-DETECTION.md sections 1, 4, and 5.
 *
 * Runs the rule database against the evidence of every page in a scan and
 * produces a deduplicated, deterministic `DetectionReport`.
 *
 * Pipeline (section 1):
 *   evidence projection -> rule matching -> confidence aggregation ->
 *   version extraction -> report.
 *
 * Aggregation across pages: a technology's confidence is computed from the UNION
 * of its distinct matched signals across all pages (dedupe key `vector:pattern`),
 * so a marker seen on two pages is not double-counted but a second, different
 * signal on another page does raise confidence. Page URLs on which evidence was
 * found are retained for explainability.
 *
 * Determinism: pages are processed in the order given and results are sorted by
 * (category, name), so identical input always yields identical output.
 *
 * Empty/oversized/malformed evidence is handled by the projection and matcher;
 * an oversized HTML snippet sets `truncatedEvidence` so the UI can warn that a
 * detection may be incomplete rather than presenting it as certain.
 */

import type { PageTechEvidence } from '../scanner/extraction/types';
import { buildPageEvidence, emptyPageEvidence, VECTOR_KEYS, type PageEvidence } from './evidence';
import { aggregateVersion, matchRule, type SignalMatch } from './matcher';
import { DETECTION_RULES } from './rules';
import { classifyConfidence, computeConfidence, isReportable } from './confidence';
import type { DetectedTechnology, DetectionReport, MatchedSignal } from './types';

/** One page's URL plus its (optional) tech evidence. */
export interface DetectionInput {
  url: string;
  tech?: PageTechEvidence;
}

interface Accumulated {
  ruleId: string;
  matched: Map<string, SignalMatch>;
  pages: Set<string>;
  /** True when evidence on any contributing page was truncated. */
  truncated: boolean;
}

const MAX_PAGES_PER_TECH = 100;
const MAX_SIGNALS_REPORTED = 20;

/** Run detection across all pages and return a deduplicated report. */
export function detectTechnologies(
  inputs: readonly DetectionInput[],
  rules = DETECTION_RULES
): DetectionReport {
  const accumulated = new Map<string, Accumulated>();
  let pagesWithEvidence = 0;
  let truncatedEvidence = false;

  for (const input of inputs) {
    const evidence: PageEvidence = input.tech
      ? buildPageEvidence(input.url, input.tech)
      : emptyPageEvidence(input.url);

    if (evidence.htmlTruncated) {
      truncatedEvidence = true;
    }

    let contributed = false;
    for (const rule of rules) {
      const { matches } = matchRule(rule, evidence);
      if (matches.length === 0) {
        continue;
      }
      contributed = true;
      let entry = accumulated.get(rule.id);
      if (!entry) {
        entry = { ruleId: rule.id, matched: new Map(), pages: new Set(), truncated: false };
        accumulated.set(rule.id, entry);
      }
      if (entry.pages.size < MAX_PAGES_PER_TECH) {
        entry.pages.add(input.url);
      }
      if (evidence.htmlTruncated) {
        entry.truncated = true;
      }
      for (const match of matches) {
        // Union across pages: keep the highest-weighted occurrence per key.
        const existing = entry.matched.get(match.key);
        if (!existing || match.weight > existing.weight) {
          entry.matched.set(match.key, match);
        }
      }
    }
    if (contributed) {
      pagesWithEvidence += 1;
    }
  }

  const technologies: DetectedTechnology[] = [];
  for (const entry of accumulated.values()) {
    const rule = rules.find((candidate) => candidate.id === entry.ruleId);
    if (!rule) {
      continue;
    }
    const matches = [...entry.matched.values()];
    const confidence = computeConfidence(matches.map((match) => match.weight));
    const status = classifyConfidence(confidence);
    if (!isReportable(status)) {
      // Low-confidence candidates are suppressed from the final report.
      continue;
    }
    const version = aggregateVersion(matches);
    technologies.push({
      technologyId: rule.id,
      name: rule.name,
      category: rule.category,
      website: rule.website,
      confidence,
      confidenceStatus: status,
      version: version.version,
      versionStatus: version.status,
      matchedSignals: matches
        .slice(0, MAX_SIGNALS_REPORTED)
        .map(toReportedSignal)
        .sort((a, b) => a.vector.localeCompare(b.vector) || a.evidence.localeCompare(b.evidence)),
      pages: [...entry.pages],
      limitation: buildLimitation(rule.name, status, version.status, entry.truncated)
    });
  }

  technologies.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  return {
    technologies,
    pagesWithEvidence,
    pagesConsidered: inputs.length,
    truncatedEvidence
  };
}

function toReportedSignal(match: SignalMatch): MatchedSignal {
  return { vector: match.vector, evidence: match.evidence, weight: match.weight };
}

/** Honest, documented limitation text shown alongside a detection. */
function buildLimitation(
  name: string,
  status: DetectedTechnology['confidenceStatus'],
  versionStatus: DetectedTechnology['versionStatus'],
  truncated: boolean
): string | null {
  const notes: string[] = [];
  if (status === 'probable') {
    notes.push(`${name} was identified with partial confidence from the available signals.`);
  }
  if (versionStatus === 'unavailable') {
    notes.push('A reliable version could not be extracted from the captured evidence.');
  } else if (versionStatus === 'major_only') {
    notes.push('Only the major version could be determined.');
  }
  if (truncated) {
    notes.push('Page markup was truncated during capture, so additional signatures may be missing.');
  }
  return notes.length > 0 ? notes.join(' ') : null;
}

export { VECTOR_KEYS };
