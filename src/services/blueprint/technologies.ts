/**
 * Technology projection - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.5 and
 * docs/specs/BLUEPRINT-SPEC.md section 2.14.
 *
 * Projects persisted `scan_technologies` rows into the spec's five optional
 * buckets (`frontend_framework`, `ui_libraries`, `runtime`, `cdn`, `analytics`).
 * Only `detected`/`probable` rows are surfaced (matching the detection engine's
 * own suppression of low-confidence `unknown` candidates); the detection
 * confidence is preserved verbatim. A detected technology is EVIDENCE, never a
 * proof of a component implementation - this module never upgrades a component.
 */
import type { ScanTechnology } from '../../types/models';
import type { BlueprintTechnologies } from '../../types/blueprint';
import { ProvenanceCollector } from './evidence';

/** Detection categories that map to a spec bucket. */
type Bucket = 'frontend_framework' | 'ui_libraries' | 'runtime' | 'cdn' | 'analytics';

const CATEGORY_BUCKET: Record<string, Bucket> = {
  'Frontend Framework': 'frontend_framework',
  'Meta-Framework & SSR Engine': 'frontend_framework',
  'Backend Framework & Server': 'runtime',
  'Analytics & Tracking': 'analytics',
  'CDN & Infrastructure': 'cdn',
  'Hosting & PaaS': 'cdn',
  'CSS Framework & Component UI': 'ui_libraries',
  'JS Library & UI Utilities': 'ui_libraries'
};

/** Categories intentionally omitted from the spec's five-bucket model. */
const IGNORED_CATEGORIES = new Set([
  'CMS',
  'Database & ORM',
  'Security & Authentication',
  'Payment Gateway',
  'Font Provider',
  'DevOps & Build Tools'
]);

const SURFACED_STATUSES = new Set(['detected', 'probable']);

function isSurfaced(technology: ScanTechnology): boolean {
  if (technology.confidenceStatus === null) {
    // Pre-Phase-5 rows carry no status: honour the numeric confidence threshold.
    return technology.confidence >= 0.5;
  }
  return SURFACED_STATUSES.has(technology.confidenceStatus);
}

/** Best-effort analytics container id from the detection evidence (never a secret). */
function analyticsId(technology: ScanTechnology): string | undefined {
  for (const entry of technology.evidence) {
    const match = /(G-[A-Z0-9]{4,}|GTM-[A-Z0-9]{4,}|UA-\d{4,}-\d+)/.exec(entry.evidence);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

export interface TechnologyResult {
  technologies: BlueprintTechnologies;
  /** Number of detected/probable technologies surfaced into the document. */
  detectedCount: number;
  /** Categories observed but not representable in the spec's buckets. */
  omittedCategories: string[];
}

/**
 * Project persisted technologies into the spec buckets. Deterministic: rows are
 * sorted by confidence (desc), then name, and the highest-confidence candidate
 * wins each singular bucket; all ui_libraries/analytics candidates are kept.
 */
export function buildTechnologies(
  technologies: readonly ScanTechnology[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): TechnologyResult {
  const surfaced = technologies
    .filter(isSurfaced)
    .filter((technology) => !IGNORED_CATEGORIES.has(technology.category))
    .sort(
      (a, b) =>
        b.confidence - a.confidence || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );

  const omitted = new Set<string>();
  for (const technology of technologies) {
    if (IGNORED_CATEGORIES.has(technology.category)) {
      omitted.add(technology.category);
    }
  }

  const result: BlueprintTechnologies = {};
  const uiLibraries: NonNullable<BlueprintTechnologies['ui_libraries']> = [];
  const analytics: NonNullable<BlueprintTechnologies['analytics']> = [];

  for (const technology of surfaced) {
    const bucket = CATEGORY_BUCKET[technology.category];
    if (!bucket) {
      continue;
    }
    const entry = {
      name: technology.name,
      ...(technology.version ? { version: technology.version } : {}),
      confidence: technology.confidence
    };
    switch (bucket) {
      case 'frontend_framework':
        if (!result.frontend_framework) {
          result.frontend_framework = entry;
        }
        break;
      case 'ui_libraries':
        uiLibraries.push(entry);
        break;
      case 'runtime':
        if (!result.runtime) {
          result.runtime = { name: technology.name, confidence: technology.confidence };
        }
        break;
      case 'cdn':
        if (!result.cdn) {
          result.cdn = { name: technology.name, confidence: technology.confidence };
        }
        break;
      case 'analytics': {
        const id = analyticsId(technology);
        analytics.push({ name: technology.name, ...(id ? { id } : {}) });
        break;
      }
    }
    collector.addObservation({
      kind: 'technology',
      ref: `technologies.${bucket}`,
      source: `scan_technology:${technology.technologyId ?? technology.id}`
    });
  }

  if (uiLibraries.length > 0) {
    result.ui_libraries = uiLibraries;
  }
  if (analytics.length > 0) {
    result.analytics = analytics;
  }

  for (const category of [...omitted].sort()) {
    collector.addInference({
      ref: 'technologies',
      method: 'category_not_representable',
      confidence: 1,
      limitation: `Detected category "${category}" has no bucket in the Blueprint technologies section.`
    });
  }

  return {
    technologies: result,
    detectedCount: surfaced.length,
    omittedCategories: [...omitted].sort()
  };
}
