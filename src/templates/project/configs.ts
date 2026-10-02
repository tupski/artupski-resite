/**
 * Generated Vite & TypeScript config templates - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-12-impl-plan.md sections 4.2-4.3.
 *
 * The generated config intentionally omits ReSite's Tauri-specific options
 * (fixed dev port, `src-tauri` watch ignore, `TAURI_ENV_DEBUG`) and the `@` path
 * alias - generated imports are always relative, so no alias can break.
 */

/** Render `vite.config.ts`. */
export function renderViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2022'
  }
});
`;
}

/** Render the app `tsconfig.json`. */
export function renderTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      useDefineForClassFields: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true,
      forceConsistentCasingInFileNames: true
    },
    include: ['src']
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Render the node-side `tsconfig.node.json` referenced by the Vite config. */
export function renderTsconfigNode(): string {
  const config = {
    compilerOptions: {
      composite: true,
      skipLibCheck: true,
      module: 'ESNext',
      moduleResolution: 'bundler',
      allowSyntheticDefaultImports: true,
      strict: true
    },
    include: ['vite.config.ts', 'tailwind.config.ts']
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}
