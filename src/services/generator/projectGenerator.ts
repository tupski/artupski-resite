/**
 * Full-stack project generator - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 12) and
 * docs/impl-plan/phase-12-impl-plan.md sections 4-6.
 *
 * Assembles a complete, runnable Vite + React + TypeScript + Tailwind project from
 * a validated Blueprint plus the Phase 11 synthesized components (and optional
 * hooks/assets). It is DETERMINISTIC, PATH-SAFE, BOUNDED, and provider-agnostic:
 *
 *   - it never talks to an AI engine or provider (component synthesis is upstream),
 *   - it NEVER executes generated code (only the controlled build test does),
 *   - every generated path is resolved and confined to a single target root,
 *   - every failure that would drop an artifact is reported honestly as `partial`,
 *   - it never throws past its boundary.
 *
 * Emission is staged: all files are computed and validated before any write, so a
 * validation failure never leaves a half-written project.
 */
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateBlueprint, type Blueprint } from '../../types/blueprint';
import type {
  ProjectGenerationFailure,
  ProjectGenerationReport,
  ProjectGenerationRequest,
  GeneratedRoute,
  DroppedRoute
} from '../../types/projectGen';
import {
  MAX_PROJECT_ASSETS,
  MAX_PROJECT_COMPONENTS,
  MAX_PROJECT_FILES,
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_PATH_DEPTH,
  MAX_PROJECT_TOTAL_BYTES
} from '../../types/projectGen';
import { createEvent, eventBus, type AppEvent } from '../infra/eventBus';
import type { StructuredError } from '../infra/errors';
import { createStorageError } from '../storage/errors';
import {
  renderAppTsx,
  renderIndexHtml,
  renderMainTsx,
  renderPackageJson,
  renderPageComponent,
  renderPostcssConfig,
  renderRouterTsx,
  renderTailwindConfig,
  renderTokensModule,
  renderStylesCss,
  renderTsconfig,
  renderTsconfigNode,
  renderViteConfig,
  type PageEntry,
  type TokenData
} from '../../templates/project';
import {
  pathDepth,
  resolveWithinRoot,
  safeAssetPath,
  safeComponentFileName,
  safeHookFileName,
  toPascalCase
} from './projectPaths';
import { COMPONENT_IDENTIFIER_PATTERN } from './componentSchema';

/** Bounded event sink so the generator stays testable (defaults to eventBus). */
export interface ProjectGenerationEventSink {
  emit(event: AppEvent): void;
}

export interface ProjectGeneratorDeps {
  /** Event sink override (tests). */
  events?: ProjectGenerationEventSink;
}

/** A logical generated file, already validated and confined. */
interface GeneratedFile {
  path: string;
  contents: string | Uint8Array;
}

function bytesOf(contents: string | Uint8Array): Uint8Array {
  return typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
}

/**
 * Generate a project beneath `input.targetRoot`. Always resolves; per-artifact
 * failures are isolated and reported honestly.
 */
export async function generateProject(
  deps: ProjectGeneratorDeps,
  input: ProjectGenerationRequest
): Promise<ProjectGenerationReport> {
  const events = deps.events ?? { emit: (event) => eventBus.emit(event) };
  const options = input.options ?? {};
  const maxFiles = options.maxFiles ?? MAX_PROJECT_FILES;
  const maxFileBytes = options.maxFileBytes ?? MAX_PROJECT_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_PROJECT_TOTAL_BYTES;
  const maxComponents = options.maxComponents ?? MAX_PROJECT_COMPONENTS;
  const maxAssets = options.maxAssets ?? MAX_PROJECT_ASSETS;

  const empty = (): Pick<
    ProjectGenerationReport,
    'files' | 'routes' | 'droppedRoutes' | 'components' | 'assets' | 'skipped'
  > => ({ files: [], routes: [], droppedRoutes: [], components: [], assets: [], skipped: [] });

  // --- 1. Validate the Blueprint; refuse invalid input without writing. -------
  const validation = resolveBlueprint(input.blueprint);
  if (!validation.ok) {
    return {
      ok: false,
      targetRoot: input.targetRoot,
      ...empty(),
      summary: {
        filesWritten: 0,
        bytesWritten: 0,
        componentsWritten: 0,
        assetsWritten: 0,
        routesWritten: 0,
        routesDropped: 0,
        partial: false,
        aborted: false
      },
      error: {
        kind: 'route',
        id: '(blueprint)',
        code: 'BLUEPRINT_VALIDATION_FAILED',
        message: 'The Blueprint document is invalid; no project was generated.'
      }
    };
  }
  const blueprint = validation.blueprint;

  // --- 2. Validate the target root boundary. ----------------------------------
  const rootCheck = validateTargetRoot(input.targetRoot);
  if (!rootCheck.ok) {
    return {
      ok: false,
      targetRoot: input.targetRoot,
      ...empty(),
      summary: {
        filesWritten: 0,
        bytesWritten: 0,
        componentsWritten: 0,
        assetsWritten: 0,
        routesWritten: 0,
        routesDropped: 0,
        partial: false,
        aborted: false
      },
      error: rootCheck.error
    };
  }

  if (input.options?.signal?.aborted) {
    return abortedReport(input.targetRoot, empty());
  }

  const skipped: ProjectGenerationFailure[] = [];

  // --- 3. Assemble components (bounded; malformed ones skipped honestly). -----
  const componentFiles: GeneratedFile[] = [];
  const componentImports: { componentId: string; name: string; fileName: string; attrs: string }[] =
    [];
  const usedFileNames = new Set<string>();
  let componentsWritten = 0;

  const blueprintComponentById = new Map(blueprint.components.map((entry) => [entry.id, entry]));
  for (const component of input.components.slice(0, maxComponents)) {
    const name = component.name;
    if (!COMPONENT_IDENTIFIER_PATTERN.test(name)) {
      skipped.push({
        kind: 'component',
        id: component.componentId,
        code: 'INVALID_COMPONENT_NAME',
        message: `Component name ${JSON.stringify(name)} is not a valid PascalCase identifier.`
      });
      continue;
    }
    const fileName = dedupeFileName(safeComponentFileName(component.fileName, name), usedFileNames);
    if (bytesOf(component.code).byteLength === 0) {
      skipped.push({
        kind: 'component',
        id: component.componentId,
        code: 'EMPTY_COMPONENT',
        message: 'Component source is empty.'
      });
      continue;
    }
    componentFiles.push({ path: `src/components/${fileName}`, contents: component.code });
    componentImports.push({
      componentId: component.componentId,
      name,
      fileName,
      attrs: renderRequiredProps(blueprintComponentById.get(component.componentId))
    });
    componentsWritten += 1;
  }
  if (input.components.length > maxComponents) {
    skipped.push({
      kind: 'component',
      id: '(component-cap)',
      code: 'COMPONENT_LIMIT_EXCEEDED',
      message: `${input.components.length} components exceed the ${maxComponents} cap.`
    });
  }

  // --- 4. Hooks (bounded, sanitized). -----------------------------------------
  const hookFiles: GeneratedFile[] = [];
  for (const hook of input.hooks ?? []) {
    if (bytesOf(hook.code).byteLength === 0) {
      skipped.push({
        kind: 'hook',
        id: hook.name,
        code: 'EMPTY_HOOK',
        message: 'Hook source is empty.'
      });
      continue;
    }
    const fileName = safeHookFileName(hook.fileName, hook.name);
    hookFiles.push({ path: `src/hooks/${fileName}`, contents: hook.code });
  }

  // --- 5. Static assets (bounded; missing bytes skipped honestly). ------------
  const assetFiles: GeneratedFile[] = [];
  const assetReport: { id: string; path: string }[] = [];
  const usedAssetPaths = new Set<string>();
  for (const asset of (input.assets ?? []).slice(0, maxAssets)) {
    if (!asset.bytes) {
      skipped.push({
        kind: 'asset',
        id: asset.id,
        code: 'ASSET_BYTES_MISSING',
        message: `Asset ${JSON.stringify(asset.id)} has no bytes; it was not written.`
      });
      continue;
    }
    const path = safeAssetPath(asset.path, asset.mimeType, usedAssetPaths);
    assetFiles.push({ path, contents: asset.bytes });
    assetReport.push({ id: asset.id, path });
  }
  if ((input.assets ?? []).length > maxAssets) {
    skipped.push({
      kind: 'asset',
      id: '(asset-cap)',
      code: 'ASSET_LIMIT_EXCEEDED',
      message: `${(input.assets ?? []).length} assets exceed the ${maxAssets} cap.`
    });
  }

  // --- 6. Routes & pages from the Blueprint (never fabricated). ---------------
  const { routes, droppedRoutes, pageFiles } = buildRoutes(blueprint, componentImports);

  // --- 7. Design tokens (Blueprint-derived only). -----------------------------
  const tokenData = projectTokens(blueprint);

  // --- 8. Boilerplate. --------------------------------------------------------
  const projectName = sanitizeProjectName(options.projectName ?? 'resite-generated-app');
  const siteTitle = blueprint.site.name.length > 0 ? blueprint.site.name : 'Generated Site';
  const boilerplate: GeneratedFile[] = [
    { path: 'index.html', contents: renderIndexHtml({ title: siteTitle }) },
    { path: 'package.json', contents: renderPackageJson({ name: projectName }) },
    { path: 'tsconfig.json', contents: renderTsconfig() },
    { path: 'tsconfig.node.json', contents: renderTsconfigNode() },
    { path: 'vite.config.ts', contents: renderViteConfig() },
    { path: 'tailwind.config.ts', contents: renderTailwindConfig() },
    { path: 'postcss.config.js', contents: renderPostcssConfig() },
    { path: '.gitignore', contents: renderGitignore() },
    { path: 'src/main.tsx', contents: renderMainTsx() },
    { path: 'src/App.tsx', contents: renderAppTsx() },
    { path: 'src/router.tsx', contents: renderRouterTsx(routes) },
    { path: 'src/tokens.ts', contents: renderTokensModule(tokenData) },
    { path: 'src/styles/index.css', contents: renderStylesCss(tokenData) }
  ];

  const files: GeneratedFile[] = [
    ...boilerplate,
    ...componentFiles,
    ...hookFiles,
    ...pageFiles,
    ...assetFiles
  ];

  // --- 9. Resource-limit validation BEFORE any write. -------------------------
  const limitError = enforceLimits(files, maxFiles, maxFileBytes, maxTotalBytes);
  if (limitError) {
    return {
      ok: false,
      targetRoot: input.targetRoot,
      ...empty(),
      summary: {
        filesWritten: 0,
        bytesWritten: 0,
        componentsWritten: 0,
        assetsWritten: 0,
        routesWritten: 0,
        routesDropped: 0,
        partial: false,
        aborted: false
      },
      error: limitError
    };
  }

  // --- 10. Resolve every path within the root BEFORE any write. ---------------
  const planned: { file: GeneratedFile; absolute: string }[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const absolute = resolveWithinRoot(input.targetRoot, file.path);
    if (absolute === null) {
      return {
        ok: false,
        targetRoot: input.targetRoot,
        ...empty(),
        summary: {
          filesWritten: 0,
          bytesWritten: 0,
          componentsWritten: 0,
          assetsWritten: 0,
          routesWritten: 0,
          routesDropped: 0,
          partial: false,
          aborted: false
        },
        error: {
          kind: 'route',
          id: file.path,
          code: 'UNSAFE_GENERATED_PATH',
          message: `Generated path ${JSON.stringify(file.path)} escapes the target root.`
        }
      };
    }
    if (!seen.has(absolute)) {
      seen.add(absolute);
      planned.push({ file, absolute });
    }
  }

  events.emit(
    createEvent('project.started', {
      files: planned.length,
      components: componentsWritten,
      routes: routes.length
    })
  );

  // --- 11. Write atomically, honoring cancellation. ---------------------------
  let bytesWritten = 0;
  const written: string[] = [];
  try {
    for (const { file, absolute } of planned) {
      if (options.signal?.aborted) {
        if (!options.keepPartial) {
          await fs.rm(input.targetRoot, { recursive: true, force: true });
        }
        return abortedReport(input.targetRoot, {
          files: written,
          routes,
          droppedRoutes,
          components: componentImports.map((entry) => ({
            name: entry.name,
            path: `src/components/${entry.fileName}`
          })),
          assets: assetReport,
          skipped
        });
      }
      await fs.mkdir(dirname(absolute), { recursive: true });
      const data = bytesOf(file.contents);
      await writeAtomic(absolute, data);
      bytesWritten += data.byteLength;
      written.push(file.path);
      events.emit(
        createEvent('project.file_generated', { path: file.path, bytes: data.byteLength })
      );
    }
  } catch (error) {
    return {
      ok: false,
      targetRoot: input.targetRoot,
      files: written,
      routes,
      droppedRoutes,
      components: componentImports.map((entry) => ({
        name: entry.name,
        path: `src/components/${entry.fileName}`
      })),
      assets: assetReport,
      skipped,
      summary: {
        filesWritten: written.length,
        bytesWritten,
        componentsWritten,
        assetsWritten: assetReport.length,
        routesWritten: routes.length,
        routesDropped: droppedRoutes.length,
        partial: true,
        aborted: false
      },
      error: {
        kind: 'route',
        id: '(io)',
        code: 'PROJECT_WRITE_FAILED',
        message: `Failed to write the generated project: ${errorMessage(error)}`
      }
    };
  }

  const partial = skipped.length > 0 || droppedRoutes.length > 0;
  events.emit(
    createEvent('project.completed', {
      files: written.length,
      bytes: bytesWritten,
      partial
    })
  );

  return {
    ok: true,
    targetRoot: input.targetRoot,
    files: written,
    routes,
    droppedRoutes,
    components: componentImports.map((entry) => ({
      name: entry.name,
      path: `src/components/${entry.fileName}`
    })),
    assets: assetReport,
    skipped,
    summary: {
      filesWritten: written.length,
      bytesWritten,
      componentsWritten,
      assetsWritten: assetReport.length,
      routesWritten: routes.length,
      routesDropped: droppedRoutes.length,
      partial,
      aborted: false
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function resolveBlueprint(
  input: Blueprint | unknown
): { ok: true; blueprint: Blueprint } | { ok: false } {
  if (isBlueprintLike(input)) {
    return { ok: true, blueprint: input };
  }
  const result = validateBlueprint(input);
  return result.success ? { ok: true, blueprint: result.data } : { ok: false };
}

/** A Blueprint is "like" a valid one when it carries the top-level version key. */
function isBlueprintLike(value: unknown): value is Blueprint {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { blueprint_version?: unknown }).blueprint_version === 1 &&
    Array.isArray((value as { components?: unknown }).components)
  );
}

function validateTargetRoot(
  targetRoot: string
): { ok: true } | { ok: false; error: ProjectGenerationFailure } {
  if (typeof targetRoot !== 'string' || targetRoot.trim().length === 0) {
    return {
      ok: false,
      error: {
        kind: 'route',
        id: '(target)',
        code: 'INVALID_TARGET_ROOT',
        message: 'A non-empty target root is required.'
      }
    };
  }
  return { ok: true };
}

function enforceLimits(
  files: readonly GeneratedFile[],
  maxFiles: number,
  maxFileBytes: number,
  maxTotalBytes: number
): ProjectGenerationFailure | null {
  if (files.length > maxFiles) {
    return {
      kind: 'route',
      id: '(limits)',
      code: 'FILE_COUNT_LIMIT_EXCEEDED',
      message: `${files.length} files exceed the ${maxFiles}-file cap.`
    };
  }
  let total = 0;
  for (const file of files) {
    const size = bytesOf(file.contents).byteLength;
    if (size > maxFileBytes) {
      return {
        kind: 'route',
        id: file.path,
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
        message: `${JSON.stringify(file.path)} exceeds the ${maxFileBytes}-byte cap.`
      };
    }
    if (pathDepth(file.path) > MAX_PROJECT_PATH_DEPTH) {
      return {
        kind: 'route',
        id: file.path,
        code: 'PATH_DEPTH_LIMIT_EXCEEDED',
        message: `${JSON.stringify(file.path)} exceeds the ${MAX_PROJECT_PATH_DEPTH}-segment cap.`
      };
    }
    total += size;
  }
  if (total > maxTotalBytes) {
    return {
      kind: 'route',
      id: '(limits)',
      code: 'TOTAL_SIZE_LIMIT_EXCEEDED',
      message: `Generated output exceeds the ${maxTotalBytes}-byte cap.`
    };
  }
  return null;
}

/**
 * Render neutral JSX attributes for a generated component's REQUIRED props so a
 * page that mounts it still type-checks. Values come from the Blueprint prop's
 * `default` when present; otherwise a type-appropriate neutral is used. This
 * never invents brand copy: strings become an empty string, numbers 0, booleans
 * false, enums their first option.
 */
function renderRequiredProps(component: Blueprint['components'][number] | undefined): string {
  if (!component) {
    return '';
  }
  return component.props
    .filter((prop) => prop.required)
    .map((prop) => `${prop.name}={${defaultLiteral(prop)}}`)
    .join(' ');
}

/** A JSX expression literal for a required prop, from its default or its type. */
function defaultLiteral(prop: Blueprint['components'][number]['props'][number]): string {
  if (prop.default !== undefined) {
    return JSON.stringify(prop.default);
  }
  switch (prop.type) {
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    case 'enum':
      return JSON.stringify(prop.options?.[0] ?? '');
    default:
      return '""';
  }
}

/** Build router routes and page components from the Blueprint. */
function buildRoutes(
  blueprint: Blueprint,
  componentImports: readonly {
    componentId: string;
    name: string;
    fileName: string;
    attrs: string;
  }[]
): { routes: GeneratedRoute[]; droppedRoutes: DroppedRoute[]; pageFiles: GeneratedFile[] } {
  const pageById = new Map(blueprint.pages.map((page) => [page.id, page]));
  const routes: GeneratedRoute[] = [];
  const droppedRoutes: DroppedRoute[] = [];
  const pageFiles: GeneratedFile[] = [];
  const seenPaths = new Set<string>();
  const seenPages = new Set<string>();

  const effectiveRoutes =
    blueprint.routes.length > 0
      ? blueprint.routes.map((route) => ({
          path: route.path,
          pageId: route.page_id,
          auth: route.auth_required
        }))
      : // No explicit routes: fall back to the page paths (Blueprints may omit routes).
        blueprint.pages.map((page) => ({ path: page.path, pageId: page.id, auth: false }));

  for (const route of effectiveRoutes) {
    if (!route.path.startsWith('/')) {
      droppedRoutes.push({ path: route.path, reason: 'invalid_path' });
      continue;
    }
    const page = pageById.get(route.pageId);
    if (!page) {
      droppedRoutes.push({ path: route.path, reason: 'missing_page' });
      continue;
    }
    if (seenPaths.has(route.path)) {
      droppedRoutes.push({ path: route.path, reason: 'duplicate_path' });
      continue;
    }
    seenPaths.add(route.path);

    const component = pageComponentName(page.id, page.title);
    const fileName = `${component}.tsx`;
    const isRoot = route.path === '/';

    if (!seenPages.has(page.id)) {
      seenPages.add(page.id);
      const referenced = page.root_component_ids.flatMap((id) => {
        const match = componentImports.find((entry) => entry.componentId === id);
        return match ? [{ name: match.name, fileName: match.fileName, attrs: match.attrs }] : [];
      });
      const pageEntry: PageEntry = {
        component,
        fileName,
        componentImports: referenced,
        title: page.title
      };
      pageFiles.push({ path: `src/pages/${fileName}`, contents: renderPageComponent(pageEntry) });
    }

    routes.push({
      path: route.path,
      component,
      fileName,
      authRequired: route.auth,
      index: isRoot
    });
  }

  // The router requires exactly one index route; promote `/` when absent.
  if (routes.length > 0 && !routes.some((route) => route.index)) {
    routes[0] = { ...routes[0]!, index: true };
  }

  // Stable ordering: index first, then by path.
  routes.sort((a, b) => (a.index === b.index ? a.path.localeCompare(b.path) : a.index ? -1 : 1));

  return { routes, droppedRoutes, pageFiles };
}

/** A valid page component identifier, unique per Blueprint page id. */
function pageComponentName(pageId: string, title: string): string {
  const fromTitle = toPascalCase(title);
  const base = COMPONENT_IDENTIFIER_PATTERN.test(fromTitle) ? fromTitle : toPascalCase(pageId);
  return `${base}Page`;
}

/** Deterministically de-duplicate a component file name. */
function dedupeFileName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let suffix = 2;
  let candidate = `${stem}${suffix}${ext}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${stem}${suffix}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** Project Blueprint design tokens into the generated token shape (no invention). */
function projectTokens(blueprint: Blueprint): TokenData {
  const ds = blueprint.design_system;
  const colors: Record<string, string> = {};
  for (const key of Object.keys(ds.colors).sort()) {
    const value = ds.colors[key];
    if (typeof value === 'string') {
      colors[key] = value;
    } else if (value && typeof value === 'object') {
      for (const shade of Object.keys(value).sort()) {
        colors[`${key}-${shade}`] = value[shade]!;
      }
    }
  }

  const fontFamily: Record<string, string[]> = {};
  if (ds.typography.font_sans.length > 0) {
    fontFamily.sans = [...ds.typography.font_sans];
  }
  if (ds.typography.font_mono.length > 0) {
    fontFamily.mono = [...ds.typography.font_mono];
  }

  return {
    colors,
    fontFamily,
    fontSize: { ...ds.typography.font_sizes },
    spacing: { ...ds.spacing },
    borderRadius: { ...ds.radii },
    boxShadow: { ...ds.shadows }
  };
}

function sanitizeProjectName(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'resite-generated-app';
}

function renderGitignore(): string {
  return `node_modules
dist
*.local
.DS_Store
`;
}

/** Write bytes atomically (temp file + rename in the same directory). */
async function writeAtomic(target: string, data: Uint8Array): Promise<void> {
  const temp = `${target}.tmp-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, target);
}

function abortedReport(
  targetRoot: string,
  partial: Pick<
    ProjectGenerationReport,
    'files' | 'routes' | 'droppedRoutes' | 'components' | 'assets' | 'skipped'
  >
): ProjectGenerationReport {
  return {
    ok: false,
    targetRoot,
    ...partial,
    summary: {
      filesWritten: partial.files.length,
      bytesWritten: 0,
      componentsWritten: partial.components.length,
      assetsWritten: partial.assets.length,
      routesWritten: partial.routes.length,
      routesDropped: partial.droppedRoutes.length,
      partial: true,
      aborted: true
    },
    error: {
      kind: 'route',
      id: '(aborted)',
      code: 'USER_CANCELLED',
      message: 'Project generation was cancelled.'
    }
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'unknown error';
}

/** Reserved for callers that need the structured io error type. */
export type ProjectGenerationError = StructuredError;

/** Re-exported so a factory can build a storage-shaped IO error consistently. */
export function createProjectIoError(message: string): StructuredError {
  return createStorageError('STORAGE_WRITE_FAILED', { message });
}

// `join` is retained for callers that pre-resolve paths in tests.
export { join as joinProjectPath };
