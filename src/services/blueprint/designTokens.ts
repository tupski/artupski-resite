/**
 * Design-token extraction + deterministic normalization - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.3 and
 * docs/specs/BLUEPRINT-SPEC.md section 2.9.
 *
 * Extracts colors, typography (font families/sizes/line-heights), spacing,
 * radii, and shadows from OBSERVED evidence only: CSS custom properties
 * (author-declared, highest trust), computed-style values across visible nodes,
 * and `@font-face` declarations. Nothing is invented - a token that is not
 * observed is simply absent, and visually-similar-but-distinct values (e.g.
 * `#fff` vs `#ffffff`) are kept distinct.
 *
 * Output is deterministic: every record is keyed and sorted explicitly.
 */
import type { BlueprintDesignSystem, BlueprintFontAsset } from '../../types/blueprint';
import type { BlueprintEvidenceFontFace, BlueprintEvidenceNode } from '../infra/workerProtocol';
import type { EvidenceModel } from './evidence';
import { ProvenanceCollector } from './evidence';
import { slugify, sortRecord, uniqueStrings } from './util';

/** Hard cap on the cardinality of each generated token record. */
export const MAX_TOKENS_PER_RECORD = 100;

export interface DesignTokenResult {
  designSystem: BlueprintDesignSystem;
  fonts: BlueprintFontAsset[];
  /** Tokens taken directly from observed values (CSS vars + computed styles). */
  observedCount: number;
  /** Tokens whose key is an inferred semantic name rather than a raw value. */
  inferredCount: number;
}

/** Canonical Tailwind-like font-size scale (documented mapping, observed-only). */
const FONT_SIZE_SCALE: Record<string, string> = {
  '0.75rem': 'xs',
  '0.875rem': 'sm',
  '1rem': 'base',
  '1.125rem': 'lg',
  '1.25rem': 'xl',
  '1.5rem': '2xl',
  '1.875rem': '3xl',
  '2.25rem': '4xl',
  '3rem': '5xl'
};

/** Canonical line-height names (documented mapping, observed-only). */
const LINE_HEIGHT_SCALE: Record<string, string> = {
  '1.25': 'tight',
  '1.375': 'snug',
  '1.5': 'normal',
  '1.625': 'relaxed',
  '1.75': 'relaxed',
  '2': 'loose'
};

/** Canonical spacing scale (documented mapping, observed-only). */
const SPACING_SCALE: Record<string, string> = {
  '0.25rem': '1',
  '0.5rem': '2',
  '0.75rem': '3',
  '1rem': '4',
  '1.25rem': '5',
  '1.5rem': '6',
  '2rem': '8',
  '2.5rem': '10',
  '3rem': '12',
  '4rem': '16',
  '5rem': '20',
  '6rem': '24'
};

/** Canonical radius names (documented mapping, observed-only). */
const RADIUS_SCALE: Record<string, string> = {
  '0.125rem': 'sm',
  '0.25rem': 'md',
  '0.375rem': 'md',
  '0.5rem': 'lg',
  '0.75rem': 'xl',
  '1rem': '2xl',
  '9999px': 'full',
  '50%': 'full'
};

/** Recognized CSS-variable bases mapped to semantic color keys. */
const SEMANTIC_COLOR_BASES = new Set([
  'primary',
  'secondary',
  'accent',
  'background',
  'foreground',
  'muted',
  'border',
  'card',
  'surface',
  'danger',
  'destructive',
  'success',
  'warning',
  'info',
  'ring',
  'input',
  'popover'
]);

const COLOR_IGNORE = new Set(['', 'transparent', 'rgba(0, 0, 0, 0)', 'none']);

const SPACING_IGNORE = new Set(['', '0px', 'auto', 'normal', '0', '0rem']);
const RADIUS_IGNORE = new Set(['', '0px', '0', '0rem']);
const SHADOW_IGNORE = new Set(['', 'none']);

interface ValueCount {
  value: string;
  count: number;
}

/** Collect non-empty style values with frequencies, sorted deterministically. */
function collectStyleValues(
  nodes: readonly BlueprintEvidenceNode[],
  pick: (node: BlueprintEvidenceNode) => string,
  ignore: ReadonlySet<string>
): ValueCount[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const raw = pick(node).trim();
    if (raw.length === 0 || ignore.has(raw)) {
      continue;
    }
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Split a spacing shorthand ("16px 24px") into its distinct component values. */
function splitBoxValues(value: string): string[] {
  return uniqueStrings(value.split(/\s+/).filter((part) => part.length > 0));
}

/** Collect spacing values from margin/padding/gap across visible nodes. */
function collectSpacingValues(nodes: readonly BlueprintEvidenceNode[]): ValueCount[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const raw of [
      ...splitBoxValues(node.styles.margin),
      ...splitBoxValues(node.styles.padding),
      ...splitBoxValues(node.styles.gap)
    ]) {
      if (raw.length === 0 || SPACING_IGNORE.has(raw)) {
        continue;
      }
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Build a keyed token record from observed values, capped + deterministically keyed. */
function keyedRecord(
  values: readonly ValueCount[],
  scale: Record<string, string>,
  fallbackPrefix: string
): { record: Record<string, string>; keys: Set<string> } {
  const record: Record<string, string> = {};
  const used = new Set<string>();
  let fallback = 0;
  for (const entry of values) {
    if (Object.keys(record).length >= MAX_TOKENS_PER_RECORD) {
      break;
    }
    let key = scale[entry.value];
    if (!key) {
      fallback += 1;
      key = `${fallbackPrefix}_${fallback}`;
    }
    // Distinct observed values must never collide onto the same key.
    while (used.has(key)) {
      fallback += 1;
      key = `${key}_${fallback}`;
    }
    used.add(key);
    record[key] = entry.value;
  }
  return { record: sortRecord(record), keys: used };
}

/** Parse a CSS custom property name into a semantic base + optional scale. */
function parseColorVariable(name: string): { base: string; scale: string | null } | null {
  if (!name.startsWith('--')) {
    return null;
  }
  const body = name.slice(2);
  const match = /^([a-z0-9]+)(?:[-_]([a-z0-9]+))?$/i.exec(body);
  if (!match) {
    return { base: slugify(body) || 'color', scale: null };
  }
  const first = (match[1] ?? '').toLowerCase();
  const second = match[2] ? match[2].toLowerCase() : null;
  if (second && /^\d+$/.test(second)) {
    const base = SEMANTIC_COLOR_BASES.has(first) ? first : slugify(body.replace(/[-_]\d+$/, ''));
    return { base: base || 'color', scale: second };
  }
  if (SEMANTIC_COLOR_BASES.has(first)) {
    return { base: first, scale: null };
  }
  return { base: slugify(body) || 'color', scale: null };
}

/** Build the colors record from CSS variables (author-declared) + computed styles. */
function buildColors(
  model: EvidenceModel,
  collector: ProvenanceCollector
): { colors: BlueprintDesignSystem['colors']; observed: number; inferred: number } {
  const colors: BlueprintDesignSystem['colors'] = {};
  let observed = 0;
  let inferred = 0;

  // 1. CSS custom properties (highest trust, author-declared).
  for (const name of Object.keys(model.cssVariables).sort()) {
    const value = model.cssVariables[name];
    if (!value || value.length === 0) {
      continue;
    }
    const parsed = parseColorVariable(name);
    if (!parsed) {
      continue;
    }
    const existing = colors[parsed.base];
    if (parsed.scale) {
      const group = typeof existing === 'object' && existing !== null ? existing : {};
      group[parsed.scale] = value;
      colors[parsed.base] = group;
    } else if (typeof existing === 'string') {
      // Two distinct single-value vars mapping to the same base: keep both
      // honestly rather than overwriting one.
      colors[`${parsed.base}_2`] = value;
    } else {
      colors[parsed.base] = value;
    }
    observed += 1;
    collector.addObservation({
      kind: 'design_token',
      ref: `colors.${parsed.base}${parsed.scale ? `.${parsed.scale}` : ''}`,
      source: `css_variable:${name}`
    });
  }

  // 2. Role-based computed colors (only when not already covered by a var).
  const varValues = new Set(Object.values(model.cssVariables));
  const background = collectStyleValues(
    model.visibleNodes,
    (node) => node.styles.backgroundColor,
    COLOR_IGNORE
  );
  const foreground = collectStyleValues(
    model.visibleNodes,
    (node) => node.styles.color,
    COLOR_IGNORE
  );
  const border = collectStyleValues(
    model.visibleNodes,
    (node) => node.styles.borderColor,
    COLOR_IGNORE
  );

  const assignRole = (key: string, value: string | undefined): void => {
    if (!value || varValues.has(value) || colors[key] !== undefined) {
      return;
    }
    colors[key] = value;
    inferred += 1;
    collector.addInference({
      ref: `colors.${key}`,
      method: 'computed_style_role',
      confidence: 0.7,
      limitation: 'Role name inferred from the most frequent computed style; value is observed.'
    });
  };
  assignRole('background', background[0]?.value);
  assignRole('foreground', foreground[0]?.value);
  assignRole('border', border[0]?.value);

  // 3. Remaining distinct computed colors, deterministically keyed.
  const allColors = collectStyleValues(
    model.visibleNodes,
    (node) => node.styles.backgroundColor,
    COLOR_IGNORE
  );
  const seen = new Set(
    Object.values(colors)
      .flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry)))
      .filter((value): value is string => typeof value === 'string')
  );
  let index = 0;
  for (const entry of allColors) {
    if (seen.has(entry.value) || Object.keys(colors).length >= MAX_TOKENS_PER_RECORD) {
      continue;
    }
    index += 1;
    colors[`color_${index}`] = entry.value;
    seen.add(entry.value);
    observed += 1;
    collector.addObservation({
      kind: 'design_token',
      ref: `colors.color_${index}`,
      source: 'computed_style:backgroundColor'
    });
  }

  return { colors: sortRecord(colors), observed, inferred };
}

/** Split a computed font stack into individual family names. */
function splitFontStack(stack: string): string[] {
  return stack
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, ''))
    .filter((family) => family.length > 0);
}

function isMonospaceStack(stack: string): boolean {
  const lower = stack.toLowerCase();
  return lower.includes('mono') || lower.includes('code') || lower.includes('courier');
}

/** Build typography tokens + font assets from observed stacks + @font-face. */
function buildTypography(
  model: EvidenceModel,
  collector: ProvenanceCollector
): {
  typography: BlueprintDesignSystem['typography'];
  fonts: BlueprintFontAsset[];
  observed: number;
  inferred: number;
} {
  const stacks = collectStyleValues(
    model.visibleNodes,
    (node) => node.styles.fontFamily,
    new Set([''])
  );

  const sansFamilies: string[] = [];
  const monoFamilies: string[] = [];
  for (const entry of stacks) {
    const families = splitFontStack(entry.value);
    const target = isMonospaceStack(entry.value) ? monoFamilies : sansFamilies;
    for (const family of families) {
      if (!target.includes(family)) {
        target.push(family);
      }
    }
  }

  if (stacks.length > 1) {
    collector.addInference({
      ref: 'typography.font_sans',
      method: 'computed_style_frequency',
      confidence: 0.6,
      limitation: `Observed ${stacks.length} distinct font stacks; all candidates are preserved.`
    });
  }

  const fontSizes = collectStyleValues(
    model.visibleNodes,
    (node) => node.styles.fontSize,
    new Set([''])
  );
  const lineHeights = collectStyleValues(
    model.visibleNodes,
    (node) => node.styles.lineHeight,
    new Set(['', 'normal'])
  );

  const sizes = keyedRecord(fontSizes, FONT_SIZE_SCALE, 'size');
  const lines = keyedRecord(lineHeights, LINE_HEIGHT_SCALE, 'leading');

  for (const entry of fontSizes) {
    collector.addObservation({
      kind: 'design_token',
      ref: `typography.font_sizes.${FONT_SIZE_SCALE[entry.value] ?? 'custom'}`,
      source: 'computed_style:fontSize'
    });
  }

  // Font assets from @font-face declarations (never bytes).
  const fonts = buildFontAssets(model.fontFaces);

  return {
    typography: {
      font_sans: uniqueStrings(sansFamilies).slice(0, MAX_TOKENS_PER_RECORD),
      font_mono: uniqueStrings(monoFamilies).slice(0, MAX_TOKENS_PER_RECORD),
      font_sizes: sizes.record,
      line_heights: lines.record
    },
    fonts,
    observed: fontSizes.length + lineHeights.length + sansFamilies.length + monoFamilies.length,
    inferred: 0
  };
}

/** Group `@font-face` declarations into font assets. */
export function buildFontAssets(
  fontFaces: readonly BlueprintEvidenceFontFace[]
): BlueprintFontAsset[] {
  const byFamily = new Map<string, { weights: Set<number>; styles: Set<string> }>();
  for (const face of fontFaces) {
    const family = face.family.trim();
    if (family.length === 0) {
      continue;
    }
    const entry = byFamily.get(family) ?? { weights: new Set<number>(), styles: new Set<string>() };
    const weight = Number.parseInt(face.weight, 10);
    if (Number.isFinite(weight)) {
      entry.weights.add(weight);
    }
    if (face.style.length > 0) {
      entry.styles.add(face.style);
    }
    byFamily.set(family, entry);
  }
  return [...byFamily.keys()].sort().map((family) => {
    const entry = byFamily.get(family) as { weights: Set<number>; styles: Set<string> };
    return {
      family,
      weights: [...entry.weights].sort((a, b) => a - b),
      styles: [...entry.styles].sort(),
      source: 'system' as const
    };
  });
}

/**
 * Extract + normalize the design system from every page's evidence model.
 * Pages are merged deterministically (sorted by URL); conflicting candidates
 * are preserved and noted rather than silently dropped.
 */
export function extractDesignTokens(
  models: readonly EvidenceModel[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): DesignTokenResult {
  const ordered = [...models].sort((a, b) => a.url.localeCompare(b.url));

  const colors: BlueprintDesignSystem['colors'] = {};
  let observed = 0;
  let inferred = 0;
  const fontSans: string[] = [];
  const fontMono: string[] = [];
  const fontSizeValues: ValueCount[] = [];
  const lineHeightValues: ValueCount[] = [];
  const spacingValues: ValueCount[] = [];
  const radiusValues: ValueCount[] = [];
  const shadowValues: ValueCount[] = [];
  const fontFaces: BlueprintEvidenceFontFace[] = [];

  for (const model of ordered) {
    const pageColors = buildColors(model, collector);
    for (const key of Object.keys(pageColors.colors)) {
      if (colors[key] === undefined) {
        colors[key] = pageColors.colors[key] as string | Record<string, string>;
      }
    }
    observed += pageColors.observed;
    inferred += pageColors.inferred;

    const typography = buildTypography(model, collector);
    for (const family of typography.typography.font_sans) {
      if (!fontSans.includes(family)) {
        fontSans.push(family);
      }
    }
    for (const family of typography.typography.font_mono) {
      if (!fontMono.includes(family)) {
        fontMono.push(family);
      }
    }
    for (const entry of collectStyleValues(
      model.visibleNodes,
      (node) => node.styles.fontSize,
      new Set([''])
    )) {
      fontSizeValues.push(entry);
    }
    for (const entry of collectStyleValues(
      model.visibleNodes,
      (node) => node.styles.lineHeight,
      new Set(['', 'normal'])
    )) {
      lineHeightValues.push(entry);
    }
    for (const entry of collectSpacingValues(model.visibleNodes)) {
      spacingValues.push(entry);
    }
    for (const entry of collectStyleValues(
      model.visibleNodes,
      (node) => node.styles.borderRadius,
      RADIUS_IGNORE
    )) {
      radiusValues.push(entry);
    }
    for (const entry of collectStyleValues(
      model.visibleNodes,
      (node) => node.styles.boxShadow,
      SHADOW_IGNORE
    )) {
      shadowValues.push(entry);
    }
    for (const face of model.fontFaces) {
      fontFaces.push(face);
    }
  }

  const merge = (values: ValueCount[]): ValueCount[] => {
    const counts = new Map<string, number>();
    for (const entry of values) {
      counts.set(entry.value, (counts.get(entry.value) ?? 0) + entry.count);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };

  const sizes = keyedRecord(merge(fontSizeValues), FONT_SIZE_SCALE, 'size');
  const lines = keyedRecord(merge(lineHeightValues), LINE_HEIGHT_SCALE, 'leading');
  const spacing = keyedRecord(merge(spacingValues), SPACING_SCALE, 'space');
  const radii = keyedRecord(merge(radiusValues), RADIUS_SCALE, 'radius');
  const shadows = keyedRecord(merge(shadowValues), {}, 'shadow');

  observed +=
    sizes.keys.size + lines.keys.size + spacing.keys.size + radii.keys.size + shadows.keys.size;
  if (sizes.keys.size === 0 && merge(fontSizeValues).length > 0) {
    inferred += 1;
  }

  if (Object.keys(colors).length === 0) {
    collector.addInference({
      ref: 'design_system.colors',
      method: 'missing_evidence',
      confidence: 0.5,
      limitation: 'No colour evidence was observed; colours is empty.'
    });
  }

  return {
    designSystem: {
      colors: sortRecord(colors),
      typography: {
        font_sans: uniqueStrings(fontSans).slice(0, MAX_TOKENS_PER_RECORD),
        font_mono: uniqueStrings(fontMono).slice(0, MAX_TOKENS_PER_RECORD),
        font_sizes: sizes.record,
        line_heights: lines.record
      },
      spacing: spacing.record,
      radii: radii.record,
      shadows: shadows.record
    },
    fonts: buildFontAssets(fontFaces),
    observedCount: observed,
    inferredCount: inferred
  };
}
