/**
 * Blueprint document schema - Artupski ReSite
 * Source of truth: docs/specs/BLUEPRINT-SPEC.md sections 2-4 (authoritative) and
 * docs/impl-plan/phase-9-impl-plan.md section 4.
 *
 * This module is the single runtime validator for a `blueprint.json` document.
 * It mirrors the BLUEPRINT-SPEC.md section 4 Zod schema EXACTLY, with three
 * documented, additive-only Phase 9 decisions:
 *
 * - C9: `navigation.*` items are validated with a concrete
 *   `BlueprintNavItemSchema` instead of the spec's loose `z.array(z.any())`.
 *   The JSON shape is identical to section 3, so no consumer is broken.
 * - C8: an OPTIONAL `provenance` namespace and optional per-node `confidence`
 *   distinguish observed evidence from inferred semantic classification. They
 *   are additive; documents without them still validate and required fields are
 *   never loosened.
 * - Bounded recursion: every object is `.strict()` (unknown keys are rejected)
 *   EXCEPT the map/record fields the spec types as open records, and an optional
 *   `children` id-reference list on components lets the validator bound the
 *   component nesting depth (`MAX_COMPONENT_DEPTH`) and detect cycles.
 *
 * No permissive `z.record(z.any())`/`passthrough` is used merely to accept
 * arbitrary objects. `z.record(z.unknown())` is used only where the spec itself
 * declares `Record<string, unknown>` (structured data / analytics parameters).
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Constants & limits                                                         */
/* -------------------------------------------------------------------------- */

/** The only supported document revision. */
export const BLUEPRINT_SCHEMA_VERSION = 1 as const;

/** Canonical `$schema` URI emitted for tooling (optional in the document). */
export const BLUEPRINT_SCHEMA_ID = 'https://artupski.com/schemas/blueprint.v1.json';

/** Hard cap on component nesting depth (BLUEPRINT-SPEC risk: bloated trees). */
export const MAX_COMPONENT_DEPTH = 12;
/** Hard cap on the number of components in a document. */
export const MAX_COMPONENTS = 500;
/** Hard cap on the number of pages in a document. */
export const MAX_PAGES = 500;
/** Hard cap on the number of routes in a document. */
export const MAX_ROUTES = 500;
/** Hard cap on navigation item nesting depth. */
export const MAX_NAV_DEPTH = 10;

const confidence = z.number().min(0).max(1);
const nonEmpty = z.string().min(1);

/* -------------------------------------------------------------------------- */
/* 2.1 Site metadata                                                          */
/* -------------------------------------------------------------------------- */

export const BlueprintSiteSchema = z
  .object({
    name: nonEmpty,
    domain: nonEmpty,
    canonical_url: z.string().url(),
    default_locale: z.string().min(2),
    supported_locales: z.array(z.string()),
    direction: z.enum(['ltr', 'rtl']),
    favicon_url: z.string(),
    theme_color: z.string(),
    description: z.string()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.2 Pages                                                                  */
/* -------------------------------------------------------------------------- */

export const BlueprintPageSchema = z
  .object({
    id: nonEmpty,
    path: z.string().startsWith('/'),
    title: z.string(),
    layout_id: z.string(),
    template: z.string(),
    is_dynamic: z.boolean(),
    dynamic_param_names: z.array(z.string()),
    meta: z.record(z.string()),
    root_component_ids: z.array(z.string()),
    /** Phase 9 additive (C8): optional inferred-classification confidence. */
    confidence: confidence.optional()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.3 Routes                                                                 */
/* -------------------------------------------------------------------------- */

export const BlueprintRouteParamSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    pattern: z.string().optional()
  })
  .strict();

export const BlueprintRouteSchema = z
  .object({
    path: z.string().startsWith('/'),
    page_id: z.string(),
    auth_required: z.boolean(),
    allowed_roles: z.array(z.string()),
    route_params: z.array(BlueprintRouteParamSchema).optional(),
    redirect_to: z.string().nullable(),
    /** Phase 9 additive (C8): optional inferred-classification confidence. */
    confidence: confidence.optional()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.4 Components                                                             */
/* -------------------------------------------------------------------------- */

export const BlueprintComponentPropSchema = z
  .object({
    name: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'enum', 'object', 'array']),
    options: z.array(z.string()).optional(),
    required: z.boolean(),
    default: z.unknown().optional()
  })
  .strict();

export const BlueprintComponentSchema = z
  .object({
    id: nonEmpty,
    name: nonEmpty,
    category: z.enum(['ui_primitive', 'composite', 'layout', 'data_display', 'form']),
    variants: z.record(z.string()),
    props: z.array(BlueprintComponentPropSchema),
    children_slots: z.array(z.string()),
    dependencies: z.array(z.string()),
    /**
     * Phase 9 additive: child component id references. The spec's component
     * registry is a flat array; this optional list expresses the nesting the
     * plan's section 5.2 tree describes and lets the validator bound depth.
     * Documents without it validate unchanged.
     */
    children: z.array(z.string()).optional(),
    /** Phase 9 additive (C8): optional inferred-classification confidence. */
    confidence: confidence.optional()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.5 Layout                                                                 */
/* -------------------------------------------------------------------------- */

export const BlueprintLayoutDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    header_component_id: z.string().nullable(),
    footer_component_id: z.string().nullable(),
    sidebar_component_id: z.string().nullable(),
    container_width: z.string(),
    body_bg_color: z.string(),
    slots: z.array(z.string())
  })
  .strict();

export const BlueprintLayoutSchema = z
  .object({
    default_layout_id: z.string(),
    definitions: z.array(BlueprintLayoutDefinitionSchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.6 Navigation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Navigation item (section 3). Recursive, so the type is declared explicitly
 * and the schema is wrapped in `z.lazy`; the shape matches the spec interface
 * exactly (plus the optional C8 `confidence`).
 */
export interface BlueprintNavItem {
  id: string;
  label: string;
  href?: string;
  action?: string;
  target?: '_self' | '_blank';
  requires_auth?: boolean;
  children?: BlueprintNavItem[];
  confidence?: number;
}

export const BlueprintNavItemSchema: z.ZodType<BlueprintNavItem> = z.lazy(() =>
  z
    .object({
      id: nonEmpty,
      label: z.string(),
      href: z.string().optional(),
      action: z.string().optional(),
      target: z.enum(['_self', '_blank']).optional(),
      requires_auth: z.boolean().optional(),
      children: z.array(BlueprintNavItemSchema).optional(),
      confidence: confidence.optional()
    })
    .strict()
);

export const BlueprintNavigationSchema = z
  .object({
    primary_menu: z.array(BlueprintNavItemSchema),
    footer_menu: z.array(BlueprintNavItemSchema),
    user_menu: z.array(BlueprintNavItemSchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.7 Content                                                                */
/* -------------------------------------------------------------------------- */

export const BlueprintContentBlockSchema = z
  .object({
    id: z.string(),
    type: z.enum(['markdown', 'html', 'json']),
    content: z.string()
  })
  .strict();

export const BlueprintContentSchema = z
  .object({
    strings: z.record(z.string()),
    blocks: z.array(BlueprintContentBlockSchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.8 Assets                                                                 */
/* -------------------------------------------------------------------------- */

export const BlueprintImageAssetSchema = z
  .object({
    id: z.string(),
    source_url: z.string(),
    local_path: z.string(),
    mime_type: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    sha256: z.string()
  })
  .strict();

export const BlueprintIconAssetSchema = z
  .object({
    id: z.string(),
    type: z.enum(['inline_svg', 'font_icon', 'image']),
    svg_content: z.string().optional(),
    glyph_name: z.string().optional()
  })
  .strict();

export const BlueprintFontAssetSchema = z
  .object({
    family: z.string(),
    weights: z.array(z.number()),
    styles: z.array(z.string()),
    source: z.enum(['google_fonts', 'custom_file', 'system']),
    files: z.array(z.string()).optional()
  })
  .strict();

export const BlueprintAssetsSchema = z
  .object({
    images: z.array(BlueprintImageAssetSchema),
    icons: z.array(BlueprintIconAssetSchema),
    fonts: z.array(BlueprintFontAssetSchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.9 Design system                                                          */
/* -------------------------------------------------------------------------- */

export const BlueprintTypographySchema = z
  .object({
    font_sans: z.array(z.string()),
    font_mono: z.array(z.string()),
    font_sizes: z.record(z.string()),
    line_heights: z.record(z.string())
  })
  .strict();

export const BlueprintDesignSystemSchema = z
  .object({
    colors: z.record(z.union([z.string(), z.record(z.string())])),
    typography: BlueprintTypographySchema,
    spacing: z.record(z.string()),
    radii: z.record(z.string()),
    shadows: z.record(z.string())
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.10 Responsive rules                                                      */
/* -------------------------------------------------------------------------- */

export const BlueprintResponsiveOverrideSchema = z
  .object({
    component_id: z.string(),
    breakpoint: z.string(),
    action: z.string(),
    value: z.unknown().optional(),
    target_slot: z.string().optional()
  })
  .strict();

export const BlueprintResponsiveRulesSchema = z
  .object({
    breakpoints: z.record(z.string()),
    overrides: z.array(BlueprintResponsiveOverrideSchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.11 Interactions                                                          */
/* -------------------------------------------------------------------------- */

export const BlueprintInteractionAnimationSchema = z
  .object({
    type: z.string(),
    duration_ms: z.number()
  })
  .strict();

export const BlueprintInteractionSchema = z
  .object({
    id: z.string(),
    trigger_component_id: z.string(),
    event: z.string(),
    action: z.string(),
    target_component_id: z.string().optional(),
    animation: BlueprintInteractionAnimationSchema.optional(),
    /** Phase 9 additive (C8): optional inferred-classification confidence. */
    confidence: confidence.optional()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.12 Forms                                                                 */
/* -------------------------------------------------------------------------- */

export const BlueprintFormFieldOptionSchema = z
  .object({
    label: z.string(),
    value: z.string()
  })
  .strict();

export const BlueprintFormFieldValidationSchema = z
  .object({
    rule: z.string(),
    value: z.unknown().optional(),
    message: z.string()
  })
  .strict();

export const BlueprintFormFieldSchema = z
  .object({
    name: z.string(),
    label: z.string(),
    type: z.string(),
    required: z.boolean(),
    placeholder: z.string().optional(),
    options: z.array(BlueprintFormFieldOptionSchema).optional(),
    validations: z.array(BlueprintFormFieldValidationSchema).optional()
  })
  .strict();

export const BlueprintFormSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
    action_endpoint: z.string(),
    fields: z.array(BlueprintFormFieldSchema),
    submit_button_label: z.string(),
    success_message: z.string().optional(),
    error_message: z.string().optional(),
    /** Phase 9 additive (C8): optional inferred-classification confidence. */
    confidence: confidence.optional()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.13 Authentication                                                        */
/* -------------------------------------------------------------------------- */

export const BlueprintAuthenticationSchema = z
  .object({
    type: z.enum(['none', 'jwt', 'cookie_session', 'oauth', 'basic']),
    login_route: z.string().optional(),
    logout_route: z.string().optional(),
    dashboard_route: z.string().optional(),
    session_storage_type: z.string().optional(),
    cookie_names: z.array(z.string()).optional(),
    roles: z.array(z.string()),
    protected_route_patterns: z.array(z.string())
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.14 Technologies (all inner buckets optional)                             */
/* -------------------------------------------------------------------------- */

export const BlueprintTechnologyEntrySchema = z
  .object({
    name: z.string(),
    version: z.string().optional(),
    confidence: z.number()
  })
  .strict();

export const BlueprintRuntimeTechnologySchema = z
  .object({
    name: z.string(),
    confidence: z.number()
  })
  .strict();

export const BlueprintAnalyticsTechnologySchema = z
  .object({
    name: z.string(),
    id: z.string().optional()
  })
  .strict();

export const BlueprintTechnologiesSchema = z
  .object({
    frontend_framework: BlueprintTechnologyEntrySchema.optional(),
    ui_libraries: z.array(BlueprintTechnologyEntrySchema).optional(),
    runtime: BlueprintRuntimeTechnologySchema.optional(),
    cdn: BlueprintRuntimeTechnologySchema.optional(),
    analytics: z.array(BlueprintAnalyticsTechnologySchema).optional()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.15 SEO                                                                   */
/* -------------------------------------------------------------------------- */

export const BlueprintStructuredDataSchema = z
  .object({
    type: z.string(),
    data: z.record(z.unknown())
  })
  .strict();

export const BlueprintSeoSchema = z
  .object({
    default_title_template: z.string(),
    open_graph: z.record(z.string()),
    twitter: z.record(z.string()),
    structured_data: z.array(BlueprintStructuredDataSchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.16 Analytics                                                             */
/* -------------------------------------------------------------------------- */

export const BlueprintAnalyticsProviderSchema = z
  .object({
    provider: z.string(),
    container_id: z.string().optional(),
    page_view_tracking: z.boolean()
  })
  .strict();

export const BlueprintAnalyticsEventSchema = z
  .object({
    event_name: z.string(),
    trigger_component_id: z.string(),
    parameters: z.record(z.unknown())
  })
  .strict();

export const BlueprintAnalyticsSchema = z
  .object({
    providers: z.array(BlueprintAnalyticsProviderSchema),
    custom_events: z.array(BlueprintAnalyticsEventSchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.17 Infrastructure                                                        */
/* -------------------------------------------------------------------------- */

export const BlueprintEnvVariableSchema = z
  .object({
    key: z.string(),
    required: z.boolean(),
    secret: z.boolean(),
    default: z.string().optional(),
    description: z.string()
  })
  .strict();

export const BlueprintInfrastructureSchema = z
  .object({
    node_version: z.string(),
    package_manager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
    recommended_target: z.enum(['vercel', 'cloudflare_pages', 'netlify', 'docker', 'static_spa']),
    env_variables: z.array(BlueprintEnvVariableSchema),
    build_command: z.string(),
    output_directory: z.string()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 2.18 Admin requirements                                                    */
/* -------------------------------------------------------------------------- */

export const BlueprintAdminEntityFieldSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    primary_key: z.boolean().optional(),
    searchable: z.boolean().optional(),
    sortable: z.boolean().optional(),
    options: z.array(z.string()).optional()
  })
  .strict();

export const BlueprintAdminEntitySchema = z
  .object({
    name: z.string(),
    plural: z.string(),
    fields: z.array(BlueprintAdminEntityFieldSchema),
    capabilities: z.array(z.enum(['create', 'read', 'update', 'delete', 'export_csv']))
  })
  .strict();

export const BlueprintAdminRequirementsSchema = z
  .object({
    entities: z.array(BlueprintAdminEntitySchema)
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Additive provenance extension (decision C8)                                */
/* -------------------------------------------------------------------------- */

export const BlueprintObservationSchema = z
  .object({
    kind: nonEmpty,
    ref: nonEmpty,
    source: nonEmpty
  })
  .strict();

export const BlueprintInferenceSchema = z
  .object({
    ref: nonEmpty,
    method: nonEmpty,
    confidence: confidence,
    limitation: z.string().optional()
  })
  .strict();

export const BlueprintEvidenceSummarySchema = z
  .object({
    pagesConsidered: z.number().int().nonnegative(),
    pagesWithEvidence: z.number().int().nonnegative(),
    nodesObserved: z.number().int().nonnegative(),
    nodesTruncated: z.number().int().nonnegative(),
    designTokensObserved: z.number().int().nonnegative(),
    designTokensInferred: z.number().int().nonnegative(),
    technologiesDetected: z.number().int().nonnegative()
  })
  .strict();

export const BlueprintProvenanceSchema = z
  .object({
    observations: z.array(BlueprintObservationSchema).optional(),
    inferences: z.array(BlueprintInferenceSchema).optional(),
    evidence_summary: BlueprintEvidenceSummarySchema.optional()
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Bounded-recursion refinements                                              */
/* -------------------------------------------------------------------------- */

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

/** Validate the optional component id-reference forest (depth + cycles + refs). */
function refineComponentGraph(components: BlueprintComponent[], ctx: z.RefinementCtx): void {
  const byId = new Map<string, BlueprintComponent>();
  for (const component of components) {
    if (byId.has(component.id)) {
      addIssue(ctx, ['components'], `Duplicate component id "${component.id}".`);
    } else {
      byId.set(component.id, component);
    }
  }

  for (const component of components) {
    for (const childId of component.children ?? []) {
      if (!byId.has(childId)) {
        addIssue(
          ctx,
          ['components'],
          `Component "${component.id}" references unknown child component "${childId}".`
        );
      }
    }
  }

  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const memo = depthMemo.get(id);
    if (memo !== undefined) {
      return memo;
    }
    if (visiting.has(id)) {
      addIssue(ctx, ['components'], `Component nesting cycle detected at "${id}".`);
      return 1;
    }
    visiting.add(id);
    const node = byId.get(id);
    let depth = 1;
    for (const childId of node?.children ?? []) {
      if (byId.has(childId)) {
        depth = Math.max(depth, 1 + depthOf(childId));
      }
    }
    visiting.delete(id);
    depthMemo.set(id, depth);
    return depth;
  };

  let maxDepth = 0;
  for (const component of components) {
    maxDepth = Math.max(maxDepth, depthOf(component.id));
  }
  if (maxDepth > MAX_COMPONENT_DEPTH) {
    addIssue(
      ctx,
      ['components'],
      `Component nesting depth ${maxDepth} exceeds the maximum of ${MAX_COMPONENT_DEPTH}.`
    );
  }
}

/** Maximum nesting depth of a navigation menu (iterative, stack-safe). */
function maxNavigationDepth(items: BlueprintNavItem[]): number {
  let maxDepth = 0;
  const stack: { item: BlueprintNavItem; depth: number }[] = items.map((item) => ({
    item,
    depth: 1
  }));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    maxDepth = Math.max(maxDepth, current.depth);
    for (const child of current.item.children ?? []) {
      stack.push({ item: child, depth: current.depth + 1 });
    }
  }
  return maxDepth;
}

/* -------------------------------------------------------------------------- */
/* Root document                                                              */
/* -------------------------------------------------------------------------- */

export const BlueprintSchema = z
  .object({
    $schema: z.string().optional(),
    blueprint_version: z.literal(BLUEPRINT_SCHEMA_VERSION),
    generated_at: z.string().datetime(),
    source_url: z.string().url(),
    generator: z
      .object({
        name: nonEmpty,
        version: nonEmpty
      })
      .strict(),
    site: BlueprintSiteSchema,
    pages: z.array(BlueprintPageSchema),
    routes: z.array(BlueprintRouteSchema),
    components: z.array(BlueprintComponentSchema),
    layout: BlueprintLayoutSchema,
    navigation: BlueprintNavigationSchema,
    content: BlueprintContentSchema,
    assets: BlueprintAssetsSchema,
    design_system: BlueprintDesignSystemSchema,
    responsive_rules: BlueprintResponsiveRulesSchema,
    interactions: z.array(BlueprintInteractionSchema),
    forms: z.array(BlueprintFormSchema),
    authentication: BlueprintAuthenticationSchema,
    technologies: BlueprintTechnologiesSchema,
    seo: BlueprintSeoSchema,
    analytics: BlueprintAnalyticsSchema,
    infrastructure: BlueprintInfrastructureSchema,
    admin_requirements: BlueprintAdminRequirementsSchema,
    /** Phase 9 additive (C8); absent documents still validate. */
    provenance: BlueprintProvenanceSchema.optional()
  })
  .strict()
  .superRefine((document, ctx) => {
    if (document.pages.length > MAX_PAGES) {
      addIssue(
        ctx,
        ['pages'],
        `Document has ${document.pages.length} pages; the maximum is ${MAX_PAGES}.`
      );
    }
    if (document.routes.length > MAX_ROUTES) {
      addIssue(
        ctx,
        ['routes'],
        `Document has ${document.routes.length} routes; the maximum is ${MAX_ROUTES}.`
      );
    }
    if (document.components.length > MAX_COMPONENTS) {
      addIssue(
        ctx,
        ['components'],
        `Document has ${document.components.length} components; the maximum is ${MAX_COMPONENTS}.`
      );
      return;
    }
    refineComponentGraph(document.components, ctx);

    const menuDepth = Math.max(
      maxNavigationDepth(document.navigation.primary_menu),
      maxNavigationDepth(document.navigation.footer_menu),
      maxNavigationDepth(document.navigation.user_menu)
    );
    if (menuDepth > MAX_NAV_DEPTH) {
      addIssue(
        ctx,
        ['navigation'],
        `Navigation nesting depth ${menuDepth} exceeds the maximum of ${MAX_NAV_DEPTH}.`
      );
    }
  });

/* -------------------------------------------------------------------------- */
/* Derived TypeScript types (z.infer)                                         */
/* -------------------------------------------------------------------------- */

export type Blueprint = z.infer<typeof BlueprintSchema>;
/** Alias matching the BLUEPRINT-SPEC.md section 3 name. */
export type BlueprintRoot = Blueprint;
export type BlueprintSite = z.infer<typeof BlueprintSiteSchema>;
export type BlueprintPage = z.infer<typeof BlueprintPageSchema>;
export type BlueprintRouteParam = z.infer<typeof BlueprintRouteParamSchema>;
export type BlueprintRoute = z.infer<typeof BlueprintRouteSchema>;
export type BlueprintComponentProp = z.infer<typeof BlueprintComponentPropSchema>;
export type BlueprintComponent = z.infer<typeof BlueprintComponentSchema>;
export type BlueprintLayoutDefinition = z.infer<typeof BlueprintLayoutDefinitionSchema>;
export type BlueprintLayout = z.infer<typeof BlueprintLayoutSchema>;
export type BlueprintNavigation = z.infer<typeof BlueprintNavigationSchema>;
export type BlueprintContentBlock = z.infer<typeof BlueprintContentBlockSchema>;
export type BlueprintContent = z.infer<typeof BlueprintContentSchema>;
export type BlueprintImageAsset = z.infer<typeof BlueprintImageAssetSchema>;
export type BlueprintIconAsset = z.infer<typeof BlueprintIconAssetSchema>;
export type BlueprintFontAsset = z.infer<typeof BlueprintFontAssetSchema>;
export type BlueprintAssets = z.infer<typeof BlueprintAssetsSchema>;
export type BlueprintTypography = z.infer<typeof BlueprintTypographySchema>;
export type BlueprintDesignSystem = z.infer<typeof BlueprintDesignSystemSchema>;
export type BlueprintResponsiveOverride = z.infer<typeof BlueprintResponsiveOverrideSchema>;
export type BlueprintResponsiveRules = z.infer<typeof BlueprintResponsiveRulesSchema>;
export type BlueprintInteraction = z.infer<typeof BlueprintInteractionSchema>;
export type BlueprintFormField = z.infer<typeof BlueprintFormFieldSchema>;
export type BlueprintForm = z.infer<typeof BlueprintFormSchema>;
export type BlueprintAuthentication = z.infer<typeof BlueprintAuthenticationSchema>;
export type BlueprintTechnologies = z.infer<typeof BlueprintTechnologiesSchema>;
export type BlueprintSeo = z.infer<typeof BlueprintSeoSchema>;
export type BlueprintAnalytics = z.infer<typeof BlueprintAnalyticsSchema>;
export type BlueprintInfrastructure = z.infer<typeof BlueprintInfrastructureSchema>;
export type BlueprintAdminRequirements = z.infer<typeof BlueprintAdminRequirementsSchema>;
export type BlueprintProvenance = z.infer<typeof BlueprintProvenanceSchema>;

/* -------------------------------------------------------------------------- */
/* Validation entry point                                                     */
/* -------------------------------------------------------------------------- */

/** Error codes reserved in `src/services/infra/errors.ts`. */
export type BlueprintValidationErrorCode = 'BLUEPRINT_VALIDATION_FAILED' | 'UNSUPPORTED_VERSION';

export interface BlueprintValidationError {
  code: BlueprintValidationErrorCode;
  /** Dot-joined issue path (`(root)` when the issue is on the whole document). */
  path: string;
  message: string;
}

export type BlueprintValidationResult =
  { success: true; data: Blueprint } | { success: false; errors: BlueprintValidationError[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an unknown value as a Blueprint document.
 *
 * An unsupported `blueprint_version` is reported as `UNSUPPORTED_VERSION`
 * (before schema parsing); every other failure is reported as
 * `BLUEPRINT_VALIDATION_FAILED` with an actionable, dot-joined path.
 */
export function validateBlueprint(input: unknown): BlueprintValidationResult {
  if (isRecord(input)) {
    const version = input.blueprint_version;
    if (version !== undefined && version !== BLUEPRINT_SCHEMA_VERSION) {
      return {
        success: false,
        errors: [
          {
            code: 'UNSUPPORTED_VERSION',
            path: 'blueprint_version',
            message: `Unsupported blueprint_version ${JSON.stringify(
              version
            )}; only version ${BLUEPRINT_SCHEMA_VERSION} is supported.`
          }
        ]
      };
    }
  }

  const parsed = BlueprintSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  return {
    success: false,
    errors: parsed.error.issues.map((issue) => ({
      code: 'BLUEPRINT_VALIDATION_FAILED' as const,
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message
    }))
  };
}
