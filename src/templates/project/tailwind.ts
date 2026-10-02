/**
 * Generated Tailwind + PostCSS config templates - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-12-impl-plan.md sections 4.2-4.3 and
 * docs/impl-plan/phase-12-impl-plan.md section 4.4 (token integration).
 *
 * The Tailwind theme extends the Blueprint design tokens by importing the
 * generated `src/tokens.ts` data. No token value is invented here; the template
 * only wires whatever the caller derived from the Blueprint.
 */

/** Render `postcss.config.js` (Tailwind + autoprefixer). */
export function renderPostcssConfig(): string {
  return `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
`;
}

/** Render `tailwind.config.ts`, extending the generated design tokens. */
export function renderTailwindConfig(): string {
  return `import type { Config } from 'tailwindcss';
import { tokens } from './src/tokens';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: tokens.colors,
      fontFamily: tokens.fontFamily,
      fontSize: tokens.fontSize,
      spacing: tokens.spacing,
      borderRadius: tokens.borderRadius,
      boxShadow: tokens.boxShadow
    }
  },
  plugins: []
};

export default config;
`;
}
