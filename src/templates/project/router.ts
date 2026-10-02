/**
 * Generated React Router & page templates - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-12-impl-plan.md sections 4.5 and task §8.
 *
 * The router is generated from the Blueprint route table. Only routes with a
 * resolvable page become entries; the caller resolves page → component imports
 * and passes explicit, already-safe file names. Imports are always relative, so
 * no alias resolution can break the generated build.
 */

/** One generated route, already validated by the caller. */
export interface RouteEntry {
  /** The Blueprint route path (e.g. `/`, `/about`). */
  path: string;
  /** The generated page component identifier (e.g. `AboutPage`). */
  component: string;
  /** The generated page file name (e.g. `AboutPage.tsx`) under `src/pages/`. */
  fileName: string;
  /** True for the root route (`/`), which renders at the index position. */
  index: boolean;
}

/** One generated page component to write under `src/pages/`. */
export interface PageEntry {
  component: string;
  fileName: string;
  /**
   * Component names (PascalCase) this page renders, resolved to real imports.
   * `attrs` is a pre-rendered JSX attribute string supplying neutral defaults for
   * every REQUIRED Blueprint prop, so the page type-checks (a required prop is
   * never omitted, which would break the generated build).
   */
  componentImports: { name: string; fileName: string; attrs: string }[];
  /** The Blueprint page title, rendered as an `<h1>` (evidence-grounded). */
  title: string;
}

/** Import path for a page file from `src/router.tsx`: `./pages/<file>` without `.tsx`. */
function pageImportPath(fileName: string): string {
  return `./pages/${fileName.replace(/\.tsx?$/, '')}`;
}

/**
 * Render `src/router.tsx`. The root route is placed first and rendered through a
 * shared `App` layout; every other route is a child so the shell wraps each page.
 */
export function renderRouterTsx(routes: readonly RouteEntry[]): string {
  const imports = routes
    .map((route) => `import { ${route.component} } from '${pageImportPath(route.fileName)}';`)
    .join('\n');

  const routeObjects = routes
    .filter((route) => !route.index)
    .map(
      (route) => `      { path: ${JSON.stringify(route.path)}, element: <${route.component} /> }`
    )
    .join(',\n');

  const indexRoute = routes.find((route) => route.index);
  const children: string[] = [];
  if (indexRoute) {
    children.push(`      { index: true, element: <${indexRoute.component} /> }`);
  }
  if (routeObjects.length > 0) {
    children.push(routeObjects);
  }

  return `import { createBrowserRouter } from 'react-router-dom';
import { App } from './App';
${imports}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
${children.join(',\n')}
    ]
  }
]);
`;
}

/**
 * Render one page component. The page renders the referenced synthesized
 * components (imported relatively) and the Blueprint page title. When there are
 * no components, it renders the title alone - never a fabricated widget.
 */
export function renderPageComponent(page: PageEntry): string {
  const imports = page.componentImports
    .map(
      (entry) =>
        `import { ${entry.name} } from '../components/${entry.fileName.replace(/\.tsx?$/, '')}';`
    )
    .join('\n');

  const body =
    page.componentImports.length > 0
      ? page.componentImports
          .map(
            (entry) => `      <${entry.name}${entry.attrs.length > 0 ? ` ${entry.attrs}` : ''} />`
          )
          .join('\n')
      : '      <p className="text-slate-600">Generated page.</p>';

  const header = imports.length > 0 ? `${imports}\n\n` : '';

  return `${header}export function ${page.component}() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">${escapeJsxText(page.title)}</h1>
${body}
    </section>
  );
}
`;
}

/** Escape text for JSX text content (JSON-safe, single line). */
function escapeJsxText(value: string): string {
  return value.replace(/[{}<>]/g, '');
}
