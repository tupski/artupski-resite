/**
 * Deterministic blueprint documentation templates - Artupski ReSite
 *
 * Each builder turns a validated Blueprint into a well-structured Markdown
 * document populated with REAL captured data (structure, design tokens, assets,
 * extracted content, detected technologies). Nothing is fabricated: absent
 * sections are omitted and every value traces to a Blueprint field.
 *
 * The optional AI narrative is merged by `buildBlueprintDoc` as a clearly marked
 * "Summary (AI-assisted)" section; when AI is unavailable the deterministic
 * document is emitted unchanged (graceful degradation).
 */
import type { Blueprint, BlueprintComponent } from '../../../types/blueprint';
import type { BlueprintDocName, DocNarrative } from '../../../types/blueprintDocs';
import { bullets, cell, codeSpan, fenced, hasAny, heading, recordTable, table, text } from './markdown';

/** Bound a list to `max` entries and report how many were omitted. */
function bound<T>(items: readonly T[], max: number): { items: T[]; omitted: number } {
  return { items: items.slice(0, max), omitted: Math.max(0, items.length - max) };
}

/** Flatten a design-system color map into `name -> value` rows (sorted). */
function flattenColors(colors: Blueprint['design_system']['colors']): [string, string][] {
  const rows: [string, string][] = [];
  for (const key of Object.keys(colors).sort()) {
    const value = colors[key];
    if (typeof value === 'string') {
      rows.push([key, value]);
    } else if (value && typeof value === 'object') {
      for (const shade of Object.keys(value).sort()) {
        rows.push([`${key}.${shade}`, (value as Record<string, string>)[shade] as string]);
      }
    }
  }
  return rows;
}

/** Component variant rows as `component / variant / classes`. */
function variantRows(components: readonly BlueprintComponent[]): string[][] {
  const rows: string[][] = [];
  for (const component of components) {
    const keys = Object.keys(component.variants).sort();
    if (keys.length === 0) {
      rows.push([cell(component.name), cell('default'), cell('(none)')]);
      continue;
    }
    for (const key of keys) {
      rows.push([cell(component.name), cell(key), cell(component.variants[key] as string)]);
    }
  }
  return rows;
}

/** Tech stack bullet lines derived from the detected technologies. */
function technologyLines(blueprint: Blueprint): string[] {
  const tech = blueprint.technologies;
  const lines: string[] = [];
  if (tech.frontend_framework) {
    lines.push(
      `- Frontend framework: ${codeSpan(tech.frontend_framework.name)}${
        tech.frontend_framework.version ? ` ${codeSpan(tech.frontend_framework.version)}` : ''
      } (confidence ${tech.frontend_framework.confidence.toFixed(2)})`
    );
  }
  for (const lib of tech.ui_libraries ?? []) {
    lines.push(
      `- UI library: ${codeSpan(lib.name)}${lib.version ? ` ${codeSpan(lib.version)}` : ''} (confidence ${lib.confidence.toFixed(2)})`
    );
  }
  if (tech.runtime) {
    lines.push(`- Runtime: ${codeSpan(tech.runtime.name)} (confidence ${tech.runtime.confidence.toFixed(2)})`);
  }
  if (tech.cdn) {
    lines.push(`- CDN: ${codeSpan(tech.cdn.name)} (confidence ${tech.cdn.confidence.toFixed(2)})`);
  }
  for (const analytics of tech.analytics ?? []) {
    lines.push(
      `- Analytics: ${codeSpan(analytics.name)}${analytics.id ? ` ${codeSpan(analytics.id)}` : ''}`
    );
  }
  return lines;
}

/** Section: the deterministic H1 plus body lines (no trailing newline). */
function buildLines(name: BlueprintDocName, blueprint: Blueprint): string[] {
  switch (name) {
    case 'AGENTS.md':
      return agentsLines(blueprint);
    case 'PRD.md':
      return prdLines(blueprint);
    case 'ARCHITECTURE.md':
      return architectureLines(blueprint);
    case 'PLAN.md':
      return planLines(blueprint);
    case 'UI-SPEC.md':
      return uiSpecLines(blueprint);
    case 'ASSETS.md':
      return assetsLines(blueprint);
    case 'TESTING.md':
      return testingLines(blueprint);
    case 'DATABASE.md':
      return databaseLines(blueprint);
    case 'API.md':
      return apiLines(blueprint);
    case 'SECURITY.md':
      return securityLines(blueprint);
    case 'DEPLOYMENT.md':
      return deploymentLines(blueprint);
  }
}

/* -------------------------------------------------------------------------- */
/* AGENTS.md                                                                  */
/* -------------------------------------------------------------------------- */

function agentsLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# AGENTS.md - ${heading(blueprint.site.name)}`];
  lines.push(
    '',
    'Operating instructions for AI agents and developers working on this generated project. Every instruction below is derived from the captured Blueprint; follow it as the source of truth.'
  );

  lines.push('', '## Project Context', '');
  lines.push(`- Source site: ${codeSpan(blueprint.source_url)}`);
  lines.push(`- Site name: ${codeSpan(blueprint.site.name)}`);
  lines.push(`- Pages: ${blueprint.pages.length}`);
  lines.push(`- Routes: ${blueprint.routes.length}`);
  lines.push(`- Components: ${blueprint.components.length}`);

  const tech = technologyLines(blueprint);
  if (tech.length > 0) {
    lines.push('', '## Detected Stack', '', ...tech);
  }

  lines.push('', '## Repository Layout', '');
  lines.push('- `src/components/` - synthesized React components (one per file, PascalCase).');
  lines.push('- `src/pages/` - route page components.');
  lines.push('- `src/hooks/` - reusable hooks.');
  lines.push('- `src/tokens.ts` and `src/styles/index.css` - design tokens derived from the Blueprint.');
  lines.push('- `public/assets/` - captured static assets.');

  lines.push('', '## Commands', '');
  lines.push(fenced('npm install\nnpm run dev\nnpm run build\nnpm run preview', 'bash'));
  if (blueprint.infrastructure.build_command) {
    lines.push('', `Blueprint build command: ${codeSpan(blueprint.infrastructure.build_command)}`);
  }

  lines.push('', '## Working Agreements', '');
  lines.push('- Treat the Blueprint as authoritative; do not invent routes, components, or copy.');
  lines.push('- Keep components one-per-file and use PascalCase identifiers.');
  lines.push('- Use the design tokens in `src/tokens.ts` rather than hard-coded values.');
  lines.push('- Preserve accessibility semantics captured in the Blueprint (roles, labels, headings).');
  lines.push('- Never commit secrets; read configuration from environment variables.');

  lines.push('', '## Boundaries', '');
  lines.push('- Do not fetch from the source site at runtime; all assets are local.');
  lines.push('- Do not add analytics or third-party scripts that were not detected.');
  if (blueprint.authentication.type !== 'none') {
    lines.push(
      `- Authentication is ${codeSpan(blueprint.authentication.type)}; never weaken route protection.`
    );
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* PRD.md                                                                     */
/* -------------------------------------------------------------------------- */

function prdLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# PRD.md - ${heading(blueprint.site.name)}`];
  lines.push(
    '',
    'Product requirements reverse-engineered from the captured website.'
  );

  lines.push('', '## Overview', '');
  lines.push(
    blueprint.site.description.trim().length > 0
      ? text(blueprint.site.description)
      : 'No site description was captured; requirements below are derived from structure and content evidence.'
  );

  lines.push('', '## Goals', '');
  lines.push('- Reproduce the site structure and user journeys faithfully.');
  lines.push('- Preserve the visual design system captured in the Blueprint.');
  lines.push('- Provide a maintainable React + TypeScript codebase.');

  if (hasAny(blueprint.authentication.roles)) {
    lines.push('', '## Users & Roles', '');
    lines.push(...bullets(blueprint.authentication.roles.map((role) => codeSpan(role))));
  }

  lines.push('', '## Scope', '');
  const pages = bound(blueprint.pages, 100);
  if (pages.items.length > 0) {
    lines.push('', '### Pages', '');
    lines.push(
      table(
        ['Path', 'Title', 'Template', 'Dynamic'],
        pages.items.map((page) => [
          cell(page.path),
          cell(page.title),
          cell(page.template),
          cell(page.is_dynamic ? 'yes' : 'no')
        ])
      )
    );
    if (pages.omitted > 0) {
      lines.push('', `_${pages.omitted} additional page(s) omitted for brevity._`);
    }
  }

  const forms = blueprint.forms;
  if (hasAny(forms)) {
    lines.push('', '### Functional Requirements', '');
    for (const form of forms) {
      const required = form.fields.filter((field) => field.required).length;
      lines.push(
        `- ${codeSpan(form.name)} submits via ${codeSpan(form.method)} to ${codeSpan(form.action_endpoint)} with ${form.fields.length} field(s) (${required} required).`
      );
    }
  }

  const navLabels = blueprint.navigation.primary_menu.map((item) => item.label);
  if (hasAny(navLabels)) {
    lines.push('', '### Primary Navigation', '');
    lines.push(...bullets(navLabels.map((label) => codeSpan(label))));
  }

  const strings = Object.keys(blueprint.content.strings).sort();
  if (hasAny(strings)) {
    lines.push('', '## Captured Copy', '');
    const captured = bound(strings, 25);
    lines.push(
      table(
        ['Key', 'Text'],
        captured.items.map((key) => [cell(key), cell(blueprint.content.strings[key] as string)])
      )
    );
    if (captured.omitted > 0) {
      lines.push('', `_${captured.omitted} additional string(s) omitted for brevity._`);
    }
  }

  lines.push('', '## Out of Scope', '');
  lines.push('- Features not evidenced by the captured site (do not invent them).');
  lines.push('- Backend services beyond the detected endpoints and data models.');

  return lines;
}

/* -------------------------------------------------------------------------- */
/* ARCHITECTURE.md                                                            */
/* -------------------------------------------------------------------------- */

function architectureLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# Architecture.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'System design derived from the Blueprint.');

  const tech = technologyLines(blueprint);
  lines.push('', '## Technology Stack', '');
  if (tech.length > 0) {
    lines.push(...tech);
  } else {
    lines.push('No technologies were detected with confidence.');
  }

  if (hasAny(blueprint.routes)) {
    lines.push('', '## Routing', '');
    lines.push(
      table(
        ['Path', 'Page', 'Auth', 'Redirect'],
        blueprint.routes.map((route) => [
          cell(route.path),
          cell(route.page_id),
          cell(route.auth_required ? 'required' : 'public'),
          cell(route.redirect_to ?? '-')
        ])
      )
    );
  }

  if (hasAny(blueprint.components)) {
    lines.push('', '## Component Hierarchy', '');
    lines.push(
      table(
        ['Component', 'Category', 'Variants', 'Slots'],
        blueprint.components.map((component) => [
          cell(component.name),
          cell(component.category),
          cell(String(Object.keys(component.variants).length)),
          cell(component.children_slots.join(', '))
        ])
      )
    );
  }

  if (hasAny(blueprint.layout.definitions)) {
    lines.push('', '## Layout', '');
    lines.push(
      table(
        ['Layout', 'Container', 'Slots'],
        blueprint.layout.definitions.map((definition) => [
          cell(definition.name),
          cell(definition.container_width),
          cell(definition.slots.join(', '))
        ])
      )
    );
  }

  if (hasAny(blueprint.interactions)) {
    lines.push('', '## Interactions', '');
    lines.push(
      table(
        ['Event', 'Action', 'Target'],
        blueprint.interactions.map((interaction) => [
          cell(interaction.event),
          cell(interaction.action),
          cell(interaction.target_component_id ?? '-')
        ])
      )
    );
  }

  if (hasAny(blueprint.analytics.providers)) {
    lines.push('', '## Analytics', '');
    lines.push(
      table(
        ['Provider', 'Container', 'Page views'],
        blueprint.analytics.providers.map((provider) => [
          cell(provider.provider),
          cell(provider.container_id ?? '-'),
          cell(provider.page_view_tracking ? 'yes' : 'no')
        ])
      )
    );
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* PLAN.md                                                                    */
/* -------------------------------------------------------------------------- */

function planLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# PLAN.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'Implementation plan for rebuilding the captured site as a React project.');

  lines.push('', '## Phase 1 - Scaffold', '');
  lines.push('- Initialize the Vite + React + TypeScript + Tailwind project.');
  lines.push('- Add the router and the base layout shell.');

  lines.push('', '## Phase 2 - Design Tokens', '');
  lines.push('- Emit the captured colors, typography, spacing, radii, and shadows.');
  lines.push('- Wire tokens into Tailwind and global styles.');

  lines.push('', '## Phase 3 - Components', '');
  const components = bound(blueprint.components, 50);
  if (components.items.length > 0) {
    for (const component of components.items) {
      lines.push(`- Build ${codeSpan(component.name)} (${codeSpan(component.category)}).`);
    }
    if (components.omitted > 0) {
      lines.push(`- _${components.omitted} additional component(s) omitted for brevity._`);
    }
  } else {
    lines.push('- No components were captured; create primitives as pages require them.');
  }

  lines.push('', '## Phase 4 - Pages & Routing', '');
  const pages = bound(blueprint.pages, 50);
  if (pages.items.length > 0) {
    for (const page of pages.items) {
      lines.push(`- Implement route ${codeSpan(page.path)} (${text(page.title) || 'untitled'}).`);
    }
    if (pages.omitted > 0) {
      lines.push(`- _${pages.omitted} additional page(s) omitted for brevity._`);
    }
  }

  if (hasAny(blueprint.forms)) {
    lines.push('', '## Phase 5 - Forms', '');
    for (const form of blueprint.forms) {
      lines.push(`- Implement ${codeSpan(form.name)} with client-side validation.`);
    }
  }

  if (hasAny(blueprint.assets.images) || hasAny(blueprint.assets.icons) || hasAny(blueprint.assets.fonts)) {
    lines.push('', '## Phase 6 - Assets', '');
    lines.push('- Place captured images, icons, and fonts under `public/assets/`.');
  }

  lines.push('', '## Phase 7 - Verification', '');
  lines.push('- Run the project build and fix type errors.');
  lines.push('- Verify routes, forms, and responsive breakpoints against the Blueprint.');
  lines.push('- See `TESTING.md` for the test strategy.');

  return lines;
}

/* -------------------------------------------------------------------------- */
/* UI-SPEC.md                                                                 */
/* -------------------------------------------------------------------------- */

function uiSpecLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# UI-SPEC.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'UI and design specification derived from captured computed styles and components.');

  const design = blueprint.design_system;
  const colors = flattenColors(design.colors);
  if (colors.length > 0) {
    lines.push('', '## Colors', '');
    lines.push(table(['Token', 'Value'], colors.map(([key, value]) => [cell(key), cell(value)])));
  }

  lines.push('', '## Typography', '');
  lines.push(
    table(
      ['Token', 'Value'],
      [
        ['font_sans', cell(design.typography.font_sans.join(', ') || '(none)')],
        ['font_mono', cell(design.typography.font_mono.join(', ') || '(none)')]
      ]
    )
  );
  const sizes = Object.keys(design.typography.font_sizes).sort();
  if (sizes.length > 0) {
    lines.push('', '### Font Sizes', '');
    lines.push(
      table(
        ['Size', 'Value'],
        sizes.map((key) => [cell(key), cell(design.typography.font_sizes[key] as string)])
      )
    );
  }
  const lineHeights = Object.keys(design.typography.line_heights).sort();
  if (lineHeights.length > 0) {
    lines.push('', '### Line Heights', '');
    lines.push(
      table(
        ['Token', 'Value'],
        lineHeights.map((key) => [cell(key), cell(design.typography.line_heights[key] as string)])
      )
    );
  }

  if (Object.keys(design.spacing).length > 0) {
    lines.push('', '## Spacing', '', recordTable(design.spacing));
  }
  if (Object.keys(design.radii).length > 0) {
    lines.push('', '## Radii', '', recordTable(design.radii));
  }
  if (Object.keys(design.shadows).length > 0) {
    lines.push('', '## Shadows', '', recordTable(design.shadows));
  }

  if (hasAny(blueprint.components)) {
    lines.push('', '## Component Variants', '');
    lines.push(table(['Component', 'Variant', 'Classes'], variantRows(blueprint.components)));
  }

  if (Object.keys(blueprint.responsive_rules.breakpoints).length > 0) {
    lines.push('', '## Breakpoints', '', recordTable(blueprint.responsive_rules.breakpoints));
  }
  if (hasAny(blueprint.responsive_rules.overrides)) {
    lines.push('', '### Responsive Overrides', '');
    lines.push(
      table(
        ['Component', 'Breakpoint', 'Action', 'Value'],
        blueprint.responsive_rules.overrides.map((override) => [
          cell(override.component_id),
          cell(override.breakpoint),
          cell(override.action),
          cell(override.value === undefined ? '-' : String(override.value))
        ])
      )
    );
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* ASSETS.md                                                                  */
/* -------------------------------------------------------------------------- */

function assetsLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# ASSETS.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'Inventory of assets captured from the source site.');

  lines.push('', '## Images', '');
  if (hasAny(blueprint.assets.images)) {
    lines.push(
      table(
        ['Id', 'Local path', 'Type', 'Dimensions', 'Source'],
        blueprint.assets.images.map((image) => [
          cell(image.id),
          cell(image.local_path),
          cell(image.mime_type),
          cell(image.width && image.height ? `${image.width}x${image.height}` : '-'),
          cell(image.source_url)
        ])
      )
    );
  } else {
    lines.push('No images were captured.');
  }

  lines.push('', '## Icons', '');
  if (hasAny(blueprint.assets.icons)) {
    lines.push(
      table(
        ['Id', 'Type', 'Reference'],
        blueprint.assets.icons.map((icon) => [
          cell(icon.id),
          cell(icon.type),
          cell(icon.glyph_name ?? (icon.svg_content ? 'inline svg' : '-'))
        ])
      )
    );
  } else {
    lines.push('No icons were captured.');
  }

  lines.push('', '## Fonts', '');
  if (hasAny(blueprint.assets.fonts)) {
    lines.push(
      table(
        ['Family', 'Weights', 'Styles', 'Source'],
        blueprint.assets.fonts.map((font) => [
          cell(font.family),
          cell(font.weights.join(', ') || '-'),
          cell(font.styles.join(', ') || '-'),
          cell(font.source)
        ])
      )
    );
  } else {
    lines.push('No fonts were captured.');
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* TESTING.md                                                                 */
/* -------------------------------------------------------------------------- */

function testingLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# TESTING.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'Test strategy for the generated project.');

  lines.push('', '## Scope', '');
  lines.push('- Verify every captured route renders without errors.');
  lines.push('- Verify captured components render with representative props.');
  lines.push('- Verify form validation rules match the Blueprint.');
  lines.push('- Verify responsive breakpoints behave as specified.');

  lines.push('', '## Test Types', '');
  lines.push('- Unit tests for pure utilities and token mapping.');
  lines.push('- Component tests for each synthesized component.');
  lines.push('- Route smoke tests for each page.');

  const pages = bound(blueprint.pages, 50);
  if (pages.items.length > 0) {
    lines.push('', '## Route Smoke Tests', '');
    lines.push(
      table(
        ['Route', 'Expectation'],
        pages.items.map((page) => [
          cell(page.path),
          cell(`renders ${text(page.title) || 'the page'}`)
        ])
      )
    );
  }

  if (hasAny(blueprint.components)) {
    lines.push('', '## Component Tests', '');
    lines.push(
      table(
        ['Component', 'Cases'],
        blueprint.components.map((component) => [
          cell(component.name),
          cell(`renders; variants: ${Object.keys(component.variants).sort().join(', ') || 'default'}`)
        ])
      )
    );
  }

  const forms = blueprint.forms;
  if (hasAny(forms)) {
    lines.push('', '## Form Validation', '');
    for (const form of forms) {
      const rules = form.fields
        .flatMap((field) => field.validations ?? [])
        .map((validation) => validation.rule);
      lines.push(
        `- ${codeSpan(form.name)}: required fields and rules (${rules.length > 0 ? rules.join(', ') : 'none captured'}).`
      );
    }
  }

  lines.push('', '## Accessibility', '');
  lines.push('- Assert landmarks, heading order, and labelled controls.');
  lines.push('- Check keyboard focus order for interactive components.');

  return lines;
}

/* -------------------------------------------------------------------------- */
/* DATABASE.md (optional)                                                     */
/* -------------------------------------------------------------------------- */

function databaseLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# DATABASE.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'Data model inferred from captured admin/CRUD requirements.');

  const entities = blueprint.admin_requirements.entities;
  if (hasAny(entities)) {
    lines.push('', '## Entities', '');
    lines.push(
      table(
        ['Entity', 'Plural', 'Capabilities'],
        entities.map((entity) => [
          cell(entity.name),
          cell(entity.plural),
          cell(entity.capabilities.join(', '))
        ])
      )
    );
    for (const entity of entities) {
      lines.push('', `### ${heading(entity.name)}`, '');
      lines.push(
        table(
          ['Field', 'Type', 'Primary', 'Searchable', 'Sortable'],
          entity.fields.map((field) => [
            cell(field.name),
            cell(field.type),
            cell(field.primary_key ? 'yes' : 'no'),
            cell(field.searchable ? 'yes' : 'no'),
            cell(field.sortable ? 'yes' : 'no')
          ])
        )
      );
    }
  } else {
    lines.push('', 'No data entities were inferred from the captured evidence.');
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* API.md (optional)                                                          */
/* -------------------------------------------------------------------------- */

function apiLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# API.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'API endpoints detected from captured forms.');

  if (hasAny(blueprint.forms)) {
    lines.push(
      '',
      '## Endpoints',
      '',
      table(
        ['Method', 'Endpoint', 'Form'],
        blueprint.forms.map((form) => [
          cell(form.method),
          cell(form.action_endpoint),
          cell(form.name)
        ])
      )
    );
    for (const form of blueprint.forms) {
      lines.push('', `### ${heading(form.name)}`, '');
      lines.push(
        table(
          ['Field', 'Type', 'Required'],
          form.fields.map((field) => [
            cell(field.name),
            cell(field.type),
            cell(field.required ? 'yes' : 'no')
          ])
        )
      );
      if (form.success_message) {
        lines.push('', `Success: ${text(form.success_message)}`);
      }
      if (form.error_message) {
        lines.push('', `Error: ${text(form.error_message)}`);
      }
    }
  } else {
    lines.push('', 'No API endpoints were detected.');
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* SECURITY.md (optional)                                                     */
/* -------------------------------------------------------------------------- */

function securityLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# SECURITY.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'Security posture inferred from captured authentication evidence.');

  const auth = blueprint.authentication;
  lines.push('', '## Authentication', '');
  lines.push(`- Type: ${codeSpan(auth.type)}`);
  if (auth.login_route) {
    lines.push(`- Login route: ${codeSpan(auth.login_route)}`);
  }
  if (auth.logout_route) {
    lines.push(`- Logout route: ${codeSpan(auth.logout_route)}`);
  }
  if (auth.session_storage_type) {
    lines.push(`- Session storage: ${codeSpan(auth.session_storage_type)}`);
  }
  if (auth.cookie_names && auth.cookie_names.length > 0) {
    lines.push(`- Cookies: ${auth.cookie_names.map((name) => codeSpan(name)).join(', ')}`);
  }

  if (hasAny(auth.roles)) {
    lines.push('', '## Roles', '', ...bullets(auth.roles.map((role) => codeSpan(role))));
  }
  if (hasAny(auth.protected_route_patterns)) {
    lines.push('', '## Protected Routes', '');
    lines.push(...bullets(auth.protected_route_patterns.map((pattern) => codeSpan(pattern))));
  }

  const passwordForms = blueprint.forms.filter((form) =>
    form.fields.some((field) => field.type === 'password')
  );
  if (hasAny(passwordForms)) {
    lines.push('', '## Sensitive Inputs', '');
    lines.push('- Forms with password fields must be submitted over HTTPS only.');
  }

  lines.push('', '## Recommendations', '');
  lines.push('- Enforce authentication on every protected route pattern above.');
  lines.push('- Never log credentials, session cookies, or tokens.');
  lines.push('- Store secrets in environment variables, not in source.');

  return lines;
}

/* -------------------------------------------------------------------------- */
/* DEPLOYMENT.md (optional)                                                   */
/* -------------------------------------------------------------------------- */

function deploymentLines(blueprint: Blueprint): string[] {
  const lines: string[] = [`# DEPLOYMENT.md - ${heading(blueprint.site.name)}`];
  lines.push('', 'Deployment configuration inferred from the captured infrastructure.');

  const infra = blueprint.infrastructure;
  lines.push('', '## Build', '');
  lines.push(`- Package manager: ${codeSpan(infra.package_manager)}`);
  lines.push(`- Node version: ${codeSpan(infra.node_version || 'unspecified')}`);
  lines.push(`- Build command: ${codeSpan(infra.build_command || 'npm run build')}`);
  lines.push(`- Output directory: ${codeSpan(infra.output_directory || 'dist')}`);
  lines.push(`- Recommended target: ${codeSpan(infra.recommended_target)}`);

  if (hasAny(infra.env_variables)) {
    lines.push('', '## Environment Variables', '');
    lines.push(
      table(
        ['Key', 'Required', 'Secret', 'Default', 'Description'],
        infra.env_variables.map((variable) => [
          cell(variable.key),
          cell(variable.required ? 'yes' : 'no'),
          cell(variable.secret ? 'yes' : 'no'),
          cell(variable.default ?? '-'),
          cell(variable.description)
        ])
      )
    );
  }

  lines.push('', '## Steps', '');
  lines.push('1. Install dependencies with the detected package manager.');
  lines.push('2. Provide the required environment variables above.');
  lines.push(`3. Run ${codeSpan(infra.build_command || 'npm run build')}.`);
  lines.push(`4. Deploy ${codeSpan(infra.output_directory || 'dist')} to the target.`);

  return lines;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the deterministic Markdown for one document. When `narrative` is
 * supplied (from a successful AI call) it is merged as a clearly labelled
 * "Summary (AI-assisted)" section; otherwise the document is purely
 * data-derived.
 */
export function buildBlueprintDoc(
  name: BlueprintDocName,
  blueprint: Blueprint,
  narrative?: DocNarrative
): string {
  const lines = buildLines(name, blueprint);
  if (narrative && (narrative.summary.trim().length > 0 || narrative.notes.length > 0)) {
    const [first, ...rest] = lines;
    const inserted: string[] = [];
    if (narrative.summary.trim().length > 0) {
      inserted.push('', '## Summary (AI-assisted)', '', text(narrative.summary));
    }
    if (narrative.notes.length > 0) {
      inserted.push('', ...bullets(narrative.notes.map((note) => text(note))));
    }
    return [first ?? '', ...inserted, ...rest].join('\n') + '\n';
  }
  return lines.join('\n') + '\n';
}
