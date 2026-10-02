/**
 * Blueprint -> bounded per-component payload projection - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-11-impl-plan.md sections 4-5, 11 and
 * docs/specs/AI-SPEC.md section 3.2 (chunking & deconstruction strategy).
 *
 * This module is DETERMINISTIC and pure. It slices the (untrusted) Blueprint
 * evidence down to exactly what one component needs, so a massive DOM tree cannot
 * blow the model context window (PLAN.md Phase 11 risk). It selects:
 *   - the component's own definition (id/name/category/variants/props/slots),
 *   - the identifiers (not the bodies) of its child components,
 *   - the design tokens that are actually relevant (bounded, sorted),
 *   - an optional observed markup fragment for this component,
 *   - the relevant responsive overrides and interactions.
 *
 * It NEVER fabricates values: a token/override that is not in the Blueprint is
 * simply absent. All strings remain untrusted and are wrapped as data downstream.
 */
import type {
  BlueprintComponent,
  BlueprintDesignSystem,
  BlueprintInteraction,
  BlueprintResponsiveRules
} from '../../types/blueprint';
import { slugify, sortRecord, uniqueStrings } from '../blueprint/util';

/** Caps that keep a single component payload within a predictable size. */
export const MAX_PAYLOAD_VARIANTS = 25;
export const MAX_PAYLOAD_PROPS = 40;
export const MAX_PAYLOAD_TOKENS = 40;
export const MAX_FRAGMENT_CHARS = 8_000;

/** The already-validated Blueprint evidence slices a single projection may read. */
export interface ComponentPayloadSources {
  designSystem: BlueprintDesignSystem;
  responsiveRules?: BlueprintResponsiveRules;
  interactions?: readonly BlueprintInteraction[];
  fragment?: string;
}

/**
 * Project a single Blueprint component into a bounded, JSON-safe payload record.
 * The result is intended to be passed verbatim as `GenerationTask.payload`; the
 * pipeline sanitizes and wraps it in `<DATA_PAYLOAD>`.
 */
export function projectComponentPayload(
  component: BlueprintComponent,
  sources: ComponentPayloadSources,
  byId: ReadonlyMap<string, BlueprintComponent>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    component_id: component.id,
    name: component.name,
    category: component.category,
    variants: pickRecord(component.variants, MAX_PAYLOAD_VARIANTS),
    props: component.props.slice(0, MAX_PAYLOAD_PROPS).map((prop) => ({
      name: prop.name,
      type: prop.type,
      required: prop.required,
      ...(prop.options ? { options: prop.options.slice(0, 20) } : {}),
      ...(prop.default !== undefined ? { default: prop.default } : {})
    })),
    children_slots: component.children_slots.slice(0, 20)
  };

  // Child component NAMES (not bodies) so the model can reason about composition
  // without us shipping the entire subtree into context.
  const childNames = (component.children ?? [])
    .map((childId) => byId.get(childId)?.name)
    .filter((name): name is string => Boolean(name));
  if (childNames.length > 0) {
    payload.child_components = uniqueStrings(childNames);
  }

  if (component.dependencies.length > 0) {
    payload.dependencies = component.dependencies.slice(0, 20);
  }
  if (component.confidence !== undefined) {
    payload.classification_confidence = component.confidence;
  }

  const tokens = projectDesignTokens(sources.designSystem);
  if (Object.keys(tokens).length > 0) {
    payload.design_system = tokens;
  }

  const overrides = (sources.responsiveRules?.overrides ?? []).filter(
    (override) => override.component_id === component.id
  );
  if (overrides.length > 0) {
    payload.responsive_overrides = overrides.slice(0, 20).map((override) => ({
      breakpoint: override.breakpoint,
      action: override.action,
      ...(override.target_slot ? { target_slot: override.target_slot } : {})
    }));
  }

  const interactions = (sources.interactions ?? []).filter(
    (interaction) => interaction.trigger_component_id === component.id
  );
  if (interactions.length > 0) {
    payload.interactions = interactions.slice(0, 20).map((interaction) => ({
      event: interaction.event,
      action: interaction.action,
      ...(interaction.target_component_id
        ? { target_component_id: interaction.target_component_id }
        : {})
    }));
  }

  if (sources.fragment) {
    payload.observed_markup = truncate(sources.fragment, MAX_FRAGMENT_CHARS);
  }

  return payload;
}

/**
 * Bound the design-system tokens to the most relevant, sorted subset. We keep at
 * most `MAX_PAYLOAD_TOKENS` entries per record so the payload stays small and
 * deterministic across runs.
 */
export function projectDesignTokens(designSystem: BlueprintDesignSystem): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const colors = pickColorRecord(designSystem.colors);
  if (Object.keys(colors).length > 0) {
    out.colors = colors;
  }

  const typography: Record<string, unknown> = {};
  if (designSystem.typography.font_sans.length > 0) {
    typography.font_sans = designSystem.typography.font_sans.slice(0, 10);
  }
  if (designSystem.typography.font_mono.length > 0) {
    typography.font_mono = designSystem.typography.font_mono.slice(0, 10);
  }
  if (Object.keys(designSystem.typography.font_sizes).length > 0) {
    typography.font_sizes = pickRecord(designSystem.typography.font_sizes, MAX_PAYLOAD_TOKENS);
  }
  if (Object.keys(designSystem.typography.line_heights).length > 0) {
    typography.line_heights = pickRecord(designSystem.typography.line_heights, MAX_PAYLOAD_TOKENS);
  }
  if (Object.keys(typography).length > 0) {
    out.typography = typography;
  }

  for (const key of ['spacing', 'radii', 'shadows'] as const) {
    const record = designSystem[key];
    if (Object.keys(record).length > 0) {
      out[key] = pickRecord(record, MAX_PAYLOAD_TOKENS);
    }
  }

  return out;
}

/** Sort keys and cap cardinality deterministically. */
function pickRecord(record: Record<string, string>, cap: number): Record<string, string> {
  const sorted = sortRecord(record);
  const out: Record<string, string> = {};
  for (const key of Object.keys(sorted).slice(0, cap)) {
    out[key] = sorted[key] as string;
  }
  return out;
}

/** Colors may be a flat string or a nested scale record (BLUEPRINT-SPEC 2.9). */
function pickColorRecord(
  colors: BlueprintDesignSystem['colors']
): Record<string, string | Record<string, string>> {
  const sorted = sortRecord(colors);
  const out: Record<string, string | Record<string, string>> = {};
  for (const key of Object.keys(sorted).slice(0, MAX_PAYLOAD_TOKENS)) {
    const value = sorted[key] as string | Record<string, string> | undefined;
    if (typeof value === 'string') {
      out[key] = value;
    } else if (value) {
      out[key] = pickRecord(value, 20);
    }
  }
  return out;
}

/** Truncate a string to a hard cap without splitting surrogate pairs. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n<!-- TRUNCATED -->`;
}

/**
 * Derive a deterministic PascalCase React identifier from a Blueprint component
 * name. Non-alphanumeric runs collapse to a single boundary; a leading digit is
 * prefixed with `Component`. Falls back to the slugified id when the name is
 * empty so the identifier is always usable.
 */
export function toComponentIdentifier(name: string, fallbackId: string): string {
  const source = name.trim() || fallbackId;
  const words = source
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const pascal = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  const safe = pascal.replace(/[^a-zA-Z0-9]/g, '') || pascalFromSlug(fallbackId);
  if (!safe) {
    return 'Component';
  }
  return /^[0-9]/.test(safe) ? `Component${safe}` : safe;
}

function pascalFromSlug(value: string): string {
  return slugify(value)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
