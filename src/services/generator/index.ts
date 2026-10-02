/**
 * Component synthesis engine - public surface - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-11-impl-plan.md section 3.
 *
 * Consumers import from here; the internal modules stay private. The engine seam
 * (`ComponentSynthesisEngine`) is structurally satisfied by the Phase 10
 * `AiEngine`, so no vendor or provider is imported by this module tree.
 */
export {
  synthesizeComponents,
  selectTargets,
  sanitizeFileName,
  COMPONENT_SYNTHESIS_TASK,
  type ComponentSynthesisEngine,
  type ComponentSynthesisEventSink,
  type ComponentSynthesizerDeps,
  type ComponentSynthesisInput
} from './componentSynthesizer';

export {
  projectComponentPayload,
  projectDesignTokens,
  toComponentIdentifier,
  MAX_PAYLOAD_VARIANTS,
  MAX_PAYLOAD_PROPS,
  MAX_PAYLOAD_TOKENS,
  MAX_FRAGMENT_CHARS,
  type ComponentPayloadSources
} from './componentPayload';

export {
  ComponentOutputSchema,
  COMPONENT_IDENTIFIER_PATTERN,
  type ComponentOutput
} from './componentSchema';

export {
  validateTsxStructure,
  assessCleanliness,
  optimizeJsx,
  evaluateGeneratedComponent,
  hasBalancedDelimiters,
  maxBraceDepth,
  declaresComponent,
  hasUnusedImports,
  type TsxAssessment
} from './jsxCleanliness';
