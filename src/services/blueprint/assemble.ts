/**
 * Blueprint document assembler - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 5-6 and
 * docs/specs/BLUEPRINT-SPEC.md sections 2-4.
 *
 * Pure function that composes every normalized section into the root document.
 * ALL required sections are always present; a section with no evidence uses the
 * spec's empty representation (`[]`/`{}`/`''`/`null`) rather than being omitted
 * or fabricated. Provenance is attached only when it carries content.
 */
import type {
  Blueprint,
  BlueprintAdminRequirements,
  BlueprintAnalytics,
  BlueprintAssets,
  BlueprintAuthentication,
  BlueprintComponent,
  BlueprintContent,
  BlueprintDesignSystem,
  BlueprintForm,
  BlueprintInfrastructure,
  BlueprintInteraction,
  BlueprintLayout,
  BlueprintNavigation,
  BlueprintPage,
  BlueprintResponsiveRules,
  BlueprintRoute,
  BlueprintSeo,
  BlueprintSite,
  BlueprintTechnologies
} from '../../types/blueprint';
import { BLUEPRINT_SCHEMA_ID, BLUEPRINT_SCHEMA_VERSION } from '../../types/blueprint';
import type { BlueprintProvenance } from '../../types/blueprint';

/** The default generator identity emitted into every document. */
export const BLUEPRINT_GENERATOR = { name: 'Artupski ReSite Engine', version: '1.0.0' } as const;

export interface AssembleInput {
  generatedAt: string;
  sourceUrl: string;
  generator: { name: string; version: string };
  site: BlueprintSite;
  seo: BlueprintSeo;
  pages: BlueprintPage[];
  routes: BlueprintRoute[];
  components: BlueprintComponent[];
  layout: BlueprintLayout;
  navigation: BlueprintNavigation;
  content: BlueprintContent;
  assets: BlueprintAssets;
  designSystem: BlueprintDesignSystem;
  responsiveRules: BlueprintResponsiveRules;
  interactions: BlueprintInteraction[];
  forms: BlueprintForm[];
  authentication: BlueprintAuthentication;
  technologies: BlueprintTechnologies;
  analytics: BlueprintAnalytics;
  infrastructure: BlueprintInfrastructure;
  adminRequirements: BlueprintAdminRequirements;
  provenance?: BlueprintProvenance;
}

/** Assemble the root Blueprint document from its normalized sections. */
export function assembleBlueprint(input: AssembleInput): Blueprint {
  const document: Blueprint = {
    $schema: BLUEPRINT_SCHEMA_ID,
    blueprint_version: BLUEPRINT_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    source_url: input.sourceUrl,
    generator: input.generator,
    site: input.site,
    pages: input.pages,
    routes: input.routes,
    components: input.components,
    layout: input.layout,
    navigation: input.navigation,
    content: input.content,
    assets: input.assets,
    design_system: input.designSystem,
    responsive_rules: input.responsiveRules,
    interactions: input.interactions,
    forms: input.forms,
    authentication: input.authentication,
    technologies: input.technologies,
    seo: input.seo,
    analytics: input.analytics,
    infrastructure: input.infrastructure,
    admin_requirements: input.adminRequirements
  };
  if (input.provenance) {
    document.provenance = input.provenance;
  }
  return document;
}
