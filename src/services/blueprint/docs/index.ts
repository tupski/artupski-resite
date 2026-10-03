/**
 * Blueprint documentation engine - public surface - Artupski ReSite
 *
 * AI-powered generation of the blueprint documentation set (7 required docs plus
 * conditional optional docs). Consumers import from here; the templates, prompt,
 * catalog, and markdown helpers stay private.
 */
export {
  generateBlueprintDocs,
  NarrativeSchema,
  DOC_TASK_PREFIX,
  MAX_NARRATIVE_NOTES,
  MAX_NARRATIVE_NOTE_CHARS,
  MAX_NARRATIVE_SUMMARY_CHARS,
  sanitizeNarrative,
  type BlueprintDocsEngine,
  type BlueprintDocsDeps,
  type BlueprintDocsEventSink
} from './generate';

export {
  runBlueprintDocs,
  type RunBlueprintDocsRequest,
  type RunBlueprintDocsResult,
  type RunBlueprintDocsDeps,
  type BlueprintDocsReadStore
} from './runBlueprintDocs';

export { planBlueprintDocs, skippedOptionalDocs, isOptionalDocRelevant, DOC_TITLES } from './catalog';
export { buildBlueprintDoc } from './templates';
export { buildDocSystemPrompt, projectDocPayload } from './prompt';
