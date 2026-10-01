/**
 * Detector public surface - Artupski ReSite
 *
 * Everything above the detection engine imports from here. Rules, matcher, and
 * confidence internals stay private to this module tree.
 */
export {
  detectTechnologies,
  type DetectionInput
} from './engine';

export {
  TECHNOLOGY_CATEGORIES,
  type ConfidenceStatus,
  type DetectedTechnology,
  type DetectionReport,
  type MatchedSignal,
  type TechSignalVector,
  type TechnologyCategory,
  type VersionStatus
} from './types';

export { computeConfidence, classifyConfidence, isReportable } from './confidence';
export { extractVersion, isPlausibleVersion, preferVersion, type VersionResult } from './version';
export { DETECTION_RULES, type RuleSignal, type TechnologyRule } from './rules';
export { buildPageEvidence, emptyPageEvidence, EVIDENCE_BOUNDS, type PageEvidence } from './evidence';
