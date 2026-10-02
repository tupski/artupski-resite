/**
 * Blueprint normalization engine - public surface - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 5 and 8.1.
 *
 * Pure normalization modules plus the synthesis orchestrator and the read-only
 * service entrypoint. Persistence, events, and UI are later Phase 9 subtasks and
 * are intentionally NOT exported here.
 */

// Orchestration + entrypoint
export {
  synthesizeBlueprint,
  eligiblePages,
  type BlueprintServiceDeps,
  type BlueprintSynthesisRequest,
  type BlueprintSynthesisResult,
  type BlueprintProvenanceSummary
} from './blueprintService';
export {
  runBlueprint,
  type RunBlueprintRequest,
  type RunBlueprintOutcome,
  type RunBlueprintResult,
  type RunBlueprintDeps,
  type BlueprintReadStore
} from './runBlueprint';
export { defaultEvidenceIo } from './blueprintFactory';

// Lifecycle + persistence (Phase 9)
export {
  runBlueprintLifecycle,
  loadBlueprintDocument,
  defaultBlueprintFileIo,
  blueprintIdFromPath,
  blueprintDocumentId,
  nextBlueprintVersion,
  MAX_EVENT_VALIDATION_ERRORS,
  type BlueprintLifecycleDeps,
  type BlueprintLifecycleOutcome,
  type BlueprintFilePort,
  type BlueprintPersistencePort,
  type BlueprintEventSink,
  type BlueprintRunFn,
  type BlueprintDocumentView
} from './blueprintLifecycle';

// Document assembly + validation
export { assembleBlueprint, BLUEPRINT_GENERATOR, type AssembleInput } from './assemble';
export {
  validateAssembledBlueprint,
  MAX_REPORTED_ERRORS,
  type ValidationOutcome
} from './validate';

// Evidence projection
export {
  loadPageEvidence,
  parsePageEvidence,
  validateEvidenceShape,
  buildEvidenceModel,
  evidenceIdFromPath,
  ProvenanceCollector,
  type EvidenceIo,
  type EvidenceModel,
  type EvidenceLoadResult,
  type LoadedPageEvidence,
  type SkippedPageEvidence
} from './evidence';

// Normalizers
export {
  normalizeDom,
  classifyNode,
  observedBodyBackground,
  type Classification,
  type ComponentKind,
  type DomNormalizationResult,
  type PageSegmentation,
  type SegmentationPage
} from './domNormalizer';
export {
  extractDesignTokens,
  buildFontAssets,
  MAX_TOKENS_PER_RECORD,
  type DesignTokenResult
} from './designTokens';
export {
  buildPagesAndRoutes,
  buildNavigation,
  inferDynamicPatterns,
  type PagesAndRoutes,
  type NavigationResult,
  type RoutePageInput
} from './routes';
export { buildForms, toForm, toFormField } from './forms';
export { buildContent, type ContentPageInput } from './content';
export { buildAssets, type AssetInput } from './assets';
export { buildTechnologies, type TechnologyResult } from './technologies';
export { buildSite, buildSeo, titleTemplateFrom, type SiteInput } from './site';
export {
  buildAnalytics,
  buildAuthentication,
  buildResponsiveRules,
  buildInteractions,
  buildAdminRequirements
} from './analytics';
export { buildInfrastructure } from './infrastructure';
