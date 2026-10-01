/**
 * Technology detection types - Artupski ReSite
 * Source of truth: docs/specs/TECHNOLOGY-DETECTION.md sections 2-4.
 *
 * These are the pure, engine-facing shapes. They deliberately do NOT depend on
 * storage or React: the engine consumes bounded `PageTechEvidence` (Phase 5
 * workstream 1) and produces `DetectedTechnology[]`, which the persistence
 * layer maps onto `scan_technologies`.
 *
 * Documented deviation from the spec's JSON example (section 6): the spec allows
 * user-supplied custom rule files merged at runtime with an override flag. No
 * such runtime file-merge engine is implemented (a rule engine without a real
 * need is out of scope); rules are a static, data-driven table instead. See
 * `rules.ts`.
 */

/** The 9 signal vectors from TECHNOLOGY-DETECTION.md section 3. */
export type TechSignalVector =
  | 'meta'
  | 'scriptSrc'
  | 'jsGlobals'
  | 'headers'
  | 'cookies'
  | 'htmlRegex'
  | 'cssClasses'
  | 'domElements'
  | 'networkRequests';

/** The 14 fingerprinting categories from section 2. */
export type TechnologyCategory =
  | 'Frontend Framework'
  | 'Meta-Framework & SSR Engine'
  | 'Backend Framework & Server'
  | 'CMS'
  | 'Database & ORM'
  | 'Analytics & Tracking'
  | 'CDN & Infrastructure'
  | 'Hosting & PaaS'
  | 'Security & Authentication'
  | 'Payment Gateway'
  | 'Font Provider'
  | 'JS Library & UI Utilities'
  | 'CSS Framework & Component UI'
  | 'DevOps & Build Tools';

export const TECHNOLOGY_CATEGORIES: readonly TechnologyCategory[] = [
  'Frontend Framework',
  'Meta-Framework & SSR Engine',
  'Backend Framework & Server',
  'CMS',
  'Database & ORM',
  'Analytics & Tracking',
  'CDN & Infrastructure',
  'Hosting & PaaS',
  'Security & Authentication',
  'Payment Gateway',
  'Font Provider',
  'JS Library & UI Utilities',
  'CSS Framework & Component UI',
  'DevOps & Build Tools'
];

/**
 * Confidence classification (section 4.1):
 *   - `detected`  : C >= 0.75 (High Confidence)
 *   - `probable`  : 0.50 <= C < 0.75
 *   - `unknown`   : 0.20 <= C < 0.50 (low-confidence candidate, suppressed from
 *                   the final report but retained for explainability)
 */
export type ConfidenceStatus = 'detected' | 'probable' | 'unknown';

/** Version reliability classification (section 4.3). */
export type VersionStatus = 'exact' | 'major_only' | 'unavailable';

/** One matched signal, retained so a detection can be explained. */
export interface MatchedSignal {
  vector: TechSignalVector;
  /** The evidence string that matched (bounded, already trimmed). */
  evidence: string;
  /** The signal weight that was applied (section 4.2 ranges). */
  weight: number;
}

/** A single detection result for one technology on one scan. */
export interface DetectedTechnology {
  /** Stable rule id, e.g. `nextjs`. */
  technologyId: string;
  /** Normalized display name, e.g. `Next.js`. */
  name: string;
  category: TechnologyCategory;
  /** Website for attribution/links; display-only, never fetched. */
  website: string | null;
  /** Aggregate confidence in [0, 1] (section 4.1 formula). */
  confidence: number;
  confidenceStatus: ConfidenceStatus;
  /** Extracted version, or null when unavailable. */
  version: string | null;
  versionStatus: VersionStatus;
  /** Distinct evidence rows that contributed to this detection. */
  matchedSignals: MatchedSignal[];
  /** Page URLs on which evidence was found (bounded, deduped). */
  pages: string[];
  /** Human-readable limitation note when detection cannot be exact. */
  limitation: string | null;
}

/** Result of running the engine across every page of a scan. */
export interface DetectionReport {
  technologies: DetectedTechnology[];
  /** Pages that contributed evidence to at least one detection. */
  pagesWithEvidence: number;
  /** Total pages considered (bounded by the caller's page list). */
  pagesConsidered: number;
  /** True when at least one page's evidence was truncated/oversized. */
  truncatedEvidence: boolean;
}
