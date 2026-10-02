/**
 * Generated project templates - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 12) and
 * docs/impl-plan/phase-12-impl-plan.md sections 4.2-4.3.
 *
 * Each export returns the exact text of one boilerplate file for the generated
 * Vite + React + TypeScript + Tailwind project. Templates are pure: they take the
 * already-derived inputs (project name, token data, route table, component import
 * entries) and return a string. No ReSite dependency, no Tauri API, no store, and
 * no local database import appears in any emitted file.
 */
export { renderPackageJson } from './packageJson';
export { renderTsconfig, renderTsconfigNode, renderViteConfig } from './configs';
export { renderTailwindConfig, renderPostcssConfig } from './tailwind';
export { renderIndexHtml, renderMainTsx, renderAppTsx } from './entry';
export { renderTokensModule, renderTokensCss, renderStylesCss, type TokenData } from './tokens';
export { renderRouterTsx, renderPageComponent, type RouteEntry, type PageEntry } from './router';
