/**
 * Generated HTML & React entry templates - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-12-impl-plan.md section 4.2.
 *
 * `index.html` is the Vite HTML entry; `main.tsx` mounts the router; `App.tsx`
 * owns the layout shell and renders the router outlet.
 */

interface IndexHtmlInput {
  title: string;
}

const APOS_ENTITY = '&#x27;';
const HTML_ESCAPES: Record<string, string> = {
  '&': '&',
  '<': '<',
  '>': '>',
  '"': '"',
  "'": APOS_ENTITY
};

/** Escape a value for safe interpolation into HTML text/attribute context. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Render `index.html`. */
export function renderIndexHtml({ title }: IndexHtmlInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

/** Render `src/main.tsx`. */
export function renderMainTsx(): string {
  return `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
`;
}

/** Render `src/App.tsx`, the layout shell around the nested routes. */
export function renderAppTsx(): string {
  return `import { Outlet } from 'react-router-dom';

export function App() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
`;
}
