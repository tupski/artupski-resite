/**
 * Blueprint synthesis orchestrator - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 5 and 8.1.
 *
 * Composes the pure normalization modules over persisted scan evidence and
 * returns the assembled, fully-validated Blueprint document together with its
 * validation result and an honest provenance summary. It performs NO persistence
 * and touches NO UI (both are later Phase 9 subtasks): a caller supplies the
 * already-persisted rows and the sandboxed evidence-read seam.
 *
 * Honesty: a page without readable evidence is SKIPPED and counted, never
 * fabricated. Missing/conflicting/ambiguous evidence flows through the pure
 * modules as the spec's empty/uncertain representation.
 */
import type { CloneAsset, ResponsiveCapture, ScanPage, ScanTechnology } from '../../types/models';
import type { Blueprint, BlueprintLayout, BlueprintProvenance } from '../../types/blueprint';
import { BLUEPRINT_GENERATOR, assembleBlueprint } from './assemble';
import { buildAssets } from './assets';
import {
  buildAdminRequirements,
  buildAnalytics,
  buildAuthentication,
  buildInteractions,
  buildResponsiveRules
} from './analytics';
import { buildContent } from './content';
import { buildPagesAndRoutes, buildNavigation } from './routes';
import { extractDesignTokens } from './designTokens';
import { buildForms } from './forms';
import { buildInfrastructure } from './infrastructure';
import { buildSeo, buildSite } from './site';
import { buildTechnologies } from './technologies';
import { normalizeDom, type PageSegmentation } from './domNormalizer';
import {
  loadPageEvidence,
  ProvenanceCollector,
  type EvidenceIo,
  type EvidenceModel,
  type SkippedPageEvidence
} from './evidence';
import { validateAssembledBlueprint, type ValidationOutcome } from './validate';

/** The injectable seams the orchestrator depends on. */
export interface BlueprintServiceDeps {
  /** Sandboxed evidence-file read seam (implemented over Rust `blueprint_read`). */
  evidenceIo: EvidenceIo;
}

/** Everything the orchestrator needs, all already loaded from storage. */
export interface BlueprintSynthesisRequest {
  scanId: string;
  projectId: string;
  /** The scan's target/seed URL (the Blueprint `source_url`). */
  sourceUrl: string;
  pages: ScanPage[];
  assets: CloneAsset[];
  technologies: ScanTechnology[];
  responsiveCaptures: ResponsiveCapture[];
  /** Injected for deterministic output; defaults to the current time. */
  generatedAt?: string;
  generator?: { name: string; version: string };
}

/** Bounded provenance statistics recorded on the document. */
export interface BlueprintProvenanceSummary {
  pagesConsidered: number;
  pagesWithEvidence: number;
  nodesObserved: number;
  nodesTruncated: number;
  designTokensObserved: number;
  designTokensInferred: number;
  technologiesDetected: number;
}

export interface BlueprintSynthesisResult {
  blueprint: Blueprint;
  validation: ValidationOutcome;
  provenanceSummary: BlueprintProvenanceSummary;
  /** Pages whose evidence was missing or malformed (recorded honestly). */
  skippedPages: SkippedPageEvidence[];
}

/** Pages eligible for synthesis: completed pages with captured evidence. */
export function eligiblePages(pages: readonly ScanPage[]): ScanPage[] {
  return pages.filter((page) => page.status === 'completed');
}

/** Derive observed `<html lang>` / `<html dir>` from the evidence models. */
function observedHtmlAttributes(models: readonly EvidenceModel[]): { lang: string; dir: string } {
  for (const model of models) {
    const html = model.evidence.nodes.find((node) => node.tag === 'html');
    if (html) {
      return { lang: html.attrs['lang'] ?? '', dir: html.attrs['dir'] ?? '' };
    }
  }
  return { lang: '', dir: '' };
}

/**
 * Synthesize one Blueprint document for a completed scan. Deterministic for a
 * fixed `generatedAt`: identical inputs produce an identical document.
 */
export async function synthesizeBlueprint(
  request: BlueprintSynthesisRequest,
  deps: BlueprintServiceDeps
): Promise<BlueprintSynthesisResult> {
  const collector = new ProvenanceCollector();
  const pages = eligiblePages(request.pages);
  const evidence = await loadPageEvidence(pages, deps.evidenceIo);
  const models = evidence.loaded.map((loaded) => loaded.model);

  // 1. DOM segmentation + semantic component classification.
  const segmentation = normalizeDom(
    evidence.loaded.map((loaded) => ({
      pageId: loaded.pageId,
      url: loaded.url,
      path: pages.find((page) => page.id === loaded.pageId)?.path ?? '/',
      title: pages.find((page) => page.id === loaded.pageId)?.title ?? null,
      model: loaded.model
    })),
    collector
  );

  // 2. Pages, routes, navigation.
  const segmentationByPage = new Map<string, PageSegmentation>();
  for (const segment of segmentation.pages) {
    segmentationByPage.set(segment.pageId, segment);
  }
  const routeInputs = pages
    .filter((page) => segmentationByPage.has(page.id))
    .map((page) => ({ page, segmentation: segmentationByPage.get(page.id) as PageSegmentation }));
  const {
    pages: blueprintPages,
    routes,
    protectedPatterns
  } = buildPagesAndRoutes(routeInputs, collector);
  const { navigation } = buildNavigation(models, protectedPatterns, collector);

  // 3. Design tokens, assets, forms, content.
  const designTokens = extractDesignTokens(models, collector);
  const assets = buildAssets({ assets: request.assets, models }, collector);
  const forms = buildForms(models, collector);
  const content = buildContent(
    evidence.loaded.flatMap((loaded) => {
      const page = pages.find((candidate) => candidate.id === loaded.pageId);
      return page ? [{ page, model: loaded.model }] : [];
    }),
    collector
  );

  // 4. Technologies + derived sections.
  const technologyResult = buildTechnologies(request.technologies, collector);
  const analytics = buildAnalytics(request.technologies, collector);
  const authentication = buildAuthentication(pages, collector);
  const responsiveRules = buildResponsiveRules(request.responsiveCaptures, collector);
  const interactions = buildInteractions(models, segmentation.nodeComponentIndex, collector);
  const adminRequirements = buildAdminRequirements(models, collector);
  const infrastructure = buildInfrastructure(request.technologies, collector);

  // 5. Site + SEO from observed metadata.
  const htmlAttributes = observedHtmlAttributes(models);
  const siteInput = {
    sourceUrl: request.sourceUrl,
    pages,
    lang: htmlAttributes.lang,
    dir: htmlAttributes.dir,
    themeColor: '',
    faviconUrl: ''
  };
  const site = buildSite(siteInput);
  const seo = buildSeo(siteInput);

  // 6. Layout from the segmented layout definitions.
  const layout: BlueprintLayout = {
    default_layout_id: segmentation.defaultLayoutId,
    definitions: segmentation.layouts
  };

  // 7. Provenance summary + document.
  const provenanceSummary: BlueprintProvenanceSummary = {
    pagesConsidered: pages.length,
    pagesWithEvidence: evidence.loaded.length,
    nodesObserved: evidence.loaded.reduce((total, loaded) => total + loaded.nodesObserved, 0),
    nodesTruncated: evidence.loaded.filter((loaded) => loaded.truncated).length,
    designTokensObserved: designTokens.observedCount,
    designTokensInferred: designTokens.inferredCount,
    technologiesDetected: technologyResult.detectedCount
  };

  const provenance: BlueprintProvenance = {
    observations: collector.observations(),
    inferences: collector.inferences(),
    evidence_summary: provenanceSummary
  };

  const blueprint = assembleBlueprint({
    generatedAt: request.generatedAt ?? new Date().toISOString(),
    sourceUrl: request.sourceUrl,
    generator: request.generator ?? { ...BLUEPRINT_GENERATOR },
    site,
    seo,
    pages: blueprintPages,
    routes,
    components: segmentation.components,
    layout,
    navigation,
    content,
    assets,
    designSystem: designTokens.designSystem,
    responsiveRules,
    interactions,
    forms,
    authentication,
    technologies: technologyResult.technologies,
    analytics,
    infrastructure,
    adminRequirements,
    provenance
  });

  const validation = validateAssembledBlueprint(blueprint);

  return {
    blueprint,
    validation,
    provenanceSummary,
    skippedPages: evidence.skipped
  };
}
