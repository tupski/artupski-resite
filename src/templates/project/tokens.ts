/**
 * Generated design-token module + CSS templates - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-12-impl-plan.md sections 4.4 and §9 of the
 * task (design token integration).
 *
 * The generator projects the Blueprint `design_system` into the `TokenData` shape
 * and these templates serialize it. Nothing is invented: an absent category is an
 * empty object. `observed` vs `inferred` distinction is preserved where the
 * Blueprint carries it (colors/typography are the observed structural evidence).
 */

/** Serialized design tokens consumed by `tailwind.config.ts`. */
export interface TokenData {
  /** Flat `name -> css-value` color map (nested Blueprint scales are flattened). */
  colors: Record<string, string>;
  /** `sans` / `mono` font-family stacks. */
  fontFamily: Record<string, string[]>;
  /** `name -> css-size` font sizes. */
  fontSize: Record<string, string>;
  /** `name -> css-size` spacing scale. */
  spacing: Record<string, string>;
  /** `name -> css-radius` border radii. */
  borderRadius: Record<string, string>;
  /** `name -> css-shadow` box shadows. */
  boxShadow: Record<string, string>;
}

/** Deterministic, sorted JSON object literal for a record of primitive values. */
function recordLiteral(record: Record<string, string>, indent: string): string {
  const keys = Object.keys(record).sort();
  if (keys.length === 0) {
    return '{}';
  }
  const lines = keys.map(
    (key) => `${indent}  ${JSON.stringify(key)}: ${JSON.stringify(record[key])}`
  );
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/** Deterministic object literal for the fontFamily map (`string[]` values). */
function fontFamilyLiteral(record: Record<string, string[]>, indent: string): string {
  const keys = Object.keys(record).sort();
  if (keys.length === 0) {
    return '{}';
  }
  const lines = keys.map((key) => {
    const stack = record[key] ?? [];
    return `${indent}  ${JSON.stringify(key)}: [${stack.map((f) => JSON.stringify(f)).join(', ')}]`;
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/** Render `src/tokens.ts` - the typed token module imported by Tailwind. */
export function renderTokensModule(tokens: TokenData): string {
  return `/**
 * Generated design tokens. Derived from the source Blueprint's design_system;
 * absent categories are empty objects (never fabricated).
 */
export const tokens = {
  colors: ${recordLiteral(tokens.colors, '  ')},
  fontFamily: ${fontFamilyLiteral(tokens.fontFamily, '  ')},
  fontSize: ${recordLiteral(tokens.fontSize, '  ')},
  spacing: ${recordLiteral(tokens.spacing, '  ')},
  borderRadius: ${recordLiteral(tokens.borderRadius, '  ')},
  boxShadow: ${recordLiteral(tokens.boxShadow, '  ')}
} as const;
`;
}

/** Render `src/styles/tokens.css` - token values as CSS custom properties. */
export function renderTokensCss(tokens: TokenData): string {
  const lines: string[] = [':root {'];
  const emitColor = (key: string, value: string) => lines.push(`  --color-${key}: ${value};`);
  Object.keys(tokens.colors)
    .sort()
    .forEach((key) => emitColor(key, tokens.colors[key]!));

  if (tokens.fontFamily.sans) {
    lines.push(`  --font-sans: ${tokens.fontFamily.sans.join(', ')};`);
  }
  if (tokens.fontFamily.mono) {
    lines.push(`  --font-mono: ${tokens.fontFamily.mono.join(', ')};`);
  }

  Object.keys(tokens.spacing)
    .sort()
    .forEach((key) => lines.push(`  --spacing-${key}: ${tokens.spacing[key]};`));
  Object.keys(tokens.borderRadius)
    .sort()
    .forEach((key) => lines.push(`  --radius-${key}: ${tokens.borderRadius[key]};`));
  Object.keys(tokens.boxShadow)
    .sort()
    .forEach((key) => lines.push(`  --shadow-${key}: ${tokens.boxShadow[key]};`));
  Object.keys(tokens.fontSize)
    .sort()
    .forEach((key) => lines.push(`  --font-size-${key}: ${tokens.fontSize[key]};`));

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/**
 * Render `src/styles/index.css` - Tailwind directives + token variables.
 *
 * Token custom properties are emitted inline (not via `@import`) so the CSS
 * resolves under Vite/PostCSS without an extra import edge.
 */
export function renderStylesCss(tokens: TokenData): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
}

${renderTokensCss(tokens)}`;
}
