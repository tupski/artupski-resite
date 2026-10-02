/**
 * Generated `package.json` template - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-12-impl-plan.md section 4.3.
 *
 * Versions are pinned to the ReSite stack (React 18, Vite 5, Tailwind 3, TS 5)
 * but include NO ReSite-only dependency (`@tauri-apps/*`, `zustand`, `sql.js`,
 * `playwright`, `zod`). The generated project must build as a standalone SPA.
 */

interface PackageJsonInput {
  name: string;
}

/** Render a deterministic, dependency-minimal `package.json`. */
export function renderPackageJson({ name }: PackageJsonInput): string {
  const manifest = {
    name,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit'
    },
    dependencies: {
      clsx: '^2.1.1',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'react-router-dom': '^6.28.0',
      'tailwind-merge': '^2.5.5'
    },
    devDependencies: {
      '@types/node': '^22.10.2',
      '@types/react': '^18.3.18',
      '@types/react-dom': '^18.3.5',
      '@vitejs/plugin-react': '^4.3.4',
      autoprefixer: '^10.4.20',
      postcss: '^8.4.49',
      tailwindcss: '^3.4.17',
      typescript: '^5.7.2',
      vite: '^5.4.11'
    },
    engines: {
      node: '>=20'
    }
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
