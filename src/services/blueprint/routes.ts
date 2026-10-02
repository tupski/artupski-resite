/**
 * Pages, routes, and navigation modeling - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.4 and
 * docs/specs/BLUEPRINT-SPEC.md sections 2.2, 2.3, 2.6.
 *
 * Builds the page inventory and routing topology from persisted `scan_pages`
 * (never from a guess) and the observed navigation regions. Dynamic routes are
 * inferred ONLY when at least two observed paths agree on a pattern - a single
 * page is never promoted to a dynamic route. Auth guards come from the page's
 * observed `authStatus`, not from an assumption.
 */
import type { ScanPage } from '../../types/models';
import type { BlueprintNavItem, BlueprintPage, BlueprintRoute } from '../../types/blueprint';
import { MAX_NAV_DEPTH, MAX_PAGES, MAX_ROUTES } from '../../types/blueprint';
import type { BlueprintEvidenceNav } from '../infra/workerProtocol';
import type { EvidenceModel } from './evidence';
import { ProvenanceCollector } from './evidence';
import type { PageSegmentation } from './domNormalizer';
import { slugify, uniqueStrings } from './util';

/** A page plus its segmentation, the input to page/route modeling. */
export interface RoutePageInput {
  page: ScanPage;
  segmentation: PageSegmentation;
}

export interface PagesAndRoutes {
  pages: BlueprintPage[];
  routes: BlueprintRoute[];
  /** Paths that require auth, used for protected_route_patterns. */
  protectedPatterns: string[];
  /** Page ids whose routes were inferred as dynamic. */
  dynamicPageIds: string[];
}

/** Build a stable, unique page id from a path. */
function pageIdFor(path: string, used: Set<string>): string {
  const base = path === '/' ? 'page_home' : `page_${slugify(path) || 'root'}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

/** Tokenize a pathname into non-empty segments. */
function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** A deterministic, honest parameter name for a dynamic path position. */
function paramNameFor(position: number, total: number, observed: readonly string[]): string {
  const isLast = position === total - 1;
  if (observed.every((value) => /^\d+$/.test(value))) {
    return isLast ? 'id' : `param${position + 1}`;
  }
  return isLast ? 'slug' : `param${position + 1}`;
}

interface DynamicPattern {
  pattern: string;
  params: string[];
  pageIds: string[];
}

/**
 * Infer dynamic route patterns: within a fixed path depth, group paths that
 * share every segment except one position; a group with >= 2 distinct values at
 * that position yields a `:param` pattern. Deterministic (sorted iteration).
 */
export function inferDynamicPatterns(paths: readonly string[]): DynamicPattern[] {
  const ordered = uniqueStrings([...paths].sort());
  const byDepth = new Map<number, string[]>();
  for (const path of ordered) {
    const depth = segmentsOf(path).length;
    if (depth === 0) {
      continue;
    }
    const list = byDepth.get(depth) ?? [];
    list.push(path);
    byDepth.set(depth, list);
  }

  const patterns: DynamicPattern[] = [];
  const consumed = new Set<string>();

  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const group = byDepth.get(depth) ?? [];
    for (let position = 0; position < depth; position += 1) {
      const buckets = new Map<string, string[]>();
      for (const path of group) {
        const segments = segmentsOf(path);
        const key = segments.filter((_, index) => index !== position).join('/');
        const list = buckets.get(key) ?? [];
        list.push(path);
        buckets.set(key, list);
      }
      for (const key of [...buckets.keys()].sort()) {
        const bucket = buckets.get(key) ?? [];
        const values = uniqueStrings(bucket.map((path) => segmentsOf(path)[position] ?? ''));
        if (bucket.length < 2 || values.length < 2) {
          continue;
        }
        if (bucket.some((path) => consumed.has(path))) {
          continue;
        }
        const templateSegments = segmentsOf(bucket[0] as string);
        const param = paramNameFor(position, depth, values);
        templateSegments[position] = `:${param}`;
        const pattern = `/${templateSegments.join('/')}`;
        patterns.push({ pattern, params: [param], pageIds: bucket });
        for (const path of bucket) {
          consumed.add(path);
        }
      }
    }
  }

  return patterns.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

function routeAuth(page: ScanPage): { authRequired: boolean; roles: string[] } {
  const authRequired = page.authStatus === 'auth_required' || page.authStatus === 'blocked';
  return { authRequired, roles: [] };
}

/**
 * Build the page inventory and routes from observed pages. Routes are emitted in
 * page order; a dynamic pattern produces one route (the first page wins) so a
 * pattern is never duplicated.
 */
export function buildPagesAndRoutes(
  inputs: RoutePageInput[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): PagesAndRoutes {
  const ordered = [...inputs].sort(
    (a, b) => a.page.path.localeCompare(b.page.path) || a.page.id.localeCompare(b.page.id)
  );

  const patterns = inferDynamicPatterns(ordered.map((input) => input.page.path));
  const patternByPath = new Map<string, DynamicPattern>();
  for (const pattern of patterns) {
    for (const path of pattern.pageIds) {
      patternByPath.set(path, pattern);
    }
    collector.addInference({
      ref: `routes.${pattern.pattern}`,
      method: 'dynamic_route_inference',
      confidence: 0.75,
      limitation: `Pattern inferred from ${pattern.pageIds.length} observed paths; parameter type is unknown.`
    });
  }

  const usedIds = new Set<string>();
  const pages: BlueprintPage[] = [];
  const routes: BlueprintRoute[] = [];
  const emittedRoutePaths = new Set<string>();
  const protectedPatterns: string[] = [];
  const dynamicPageIds: string[] = [];

  for (const input of ordered.slice(0, MAX_PAGES)) {
    const { page, segmentation } = input;
    const id = pageIdFor(page.path, usedIds);
    const pattern = patternByPath.get(page.path);
    const isDynamic = pattern !== undefined;
    const routePath = isDynamic && pattern ? pattern.pattern : page.path;
    const meta: Record<string, string> = {};
    if (page.metaDescription) {
      meta.description = page.metaDescription;
    }
    if (page.robotsMeta) {
      meta.robots = page.robotsMeta;
    }
    if (page.canonicalUrl) {
      meta.canonical = page.canonicalUrl;
    }

    pages.push({
      id,
      path: page.path,
      title: page.title ?? '',
      layout_id: segmentation.layoutId,
      template: segmentation.template,
      is_dynamic: isDynamic,
      dynamic_param_names: isDynamic && pattern ? pattern.params : [],
      meta,
      root_component_ids: segmentation.rootComponentIds
    });

    collector.addObservation({
      kind: 'page',
      ref: id,
      source: `scan_page:${page.id}`
    });

    if (isDynamic) {
      dynamicPageIds.push(id);
    }

    if (emittedRoutePaths.has(routePath) || routes.length >= MAX_ROUTES) {
      continue;
    }
    emittedRoutePaths.add(routePath);
    const auth = routeAuth(page);
    if (auth.authRequired) {
      protectedPatterns.push(routePath);
    }
    const route: BlueprintRoute = {
      path: routePath,
      page_id: id,
      auth_required: auth.authRequired,
      allowed_roles: auth.roles,
      redirect_to: null,
      ...(isDynamic && pattern
        ? { route_params: pattern.params.map((name) => ({ name, type: 'string' })) }
        : {})
    };
    routes.push(route);
  }

  if (ordered.length > MAX_PAGES) {
    collector.addInference({
      ref: 'pages',
      method: 'page_cap',
      confidence: 0.5,
      limitation: `Page list capped at ${MAX_PAGES}; ${ordered.length - MAX_PAGES} pages were dropped.`
    });
  }

  return { pages, routes, protectedPatterns, dynamicPageIds };
}

/** A target path is auth-guarded when its concrete route requires auth. */
function requiresAuth(href: string, protectedPatterns: readonly string[]): boolean {
  if (href.length === 0) {
    return false;
  }
  let path = href;
  try {
    path = new URL(href, 'http://localhost').pathname;
  } catch {
    // keep the raw href
  }
  return protectedPatterns.some((pattern) => {
    const prefix = pattern.replace(/\/:[^/]+$/, '');
    return path === pattern || path.startsWith(`${prefix}/`);
  });
}

function isUserMenuLabel(label: string): boolean {
  return /sign in|sign out|log in|logout|log out|profile|account|settings|dashboard|my account/i.test(
    label
  );
}

interface NavBuildNode {
  item: BlueprintNavItem;
  depth: number;
}

/** Convert flat, depth-tagged nav items into a nested menu (bounded depth). */
function buildMenuItems(
  region: BlueprintEvidenceNav,
  protectedPatterns: readonly string[]
): BlueprintNavItem[] {
  const roots: BlueprintNavItem[] = [];
  const stack: NavBuildNode[] = [];
  let index = 0;

  for (const raw of region.items) {
    if (raw.href.length === 0 && raw.text.length === 0) {
      continue;
    }
    index += 1;
    const depth = Math.max(0, Math.min(raw.depth, MAX_NAV_DEPTH - 1));
    const label = raw.text.length > 0 ? raw.text : raw.href;
    const item: BlueprintNavItem = {
      id: `nav_${slugify(label) || 'item'}_${index}`,
      label
    };
    if (raw.href.length > 0) {
      item.href = raw.href;
    }
    if (raw.target === '_blank' || raw.target === '_self') {
      item.target = raw.target;
    }
    const authRequired = requiresAuth(raw.href, protectedPatterns);
    if (authRequired) {
      item.requires_auth = true;
    }

    while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent && depth > 0) {
      parent.item.children = parent.item.children ?? [];
      parent.item.children.push(item);
    } else {
      roots.push(item);
    }
    stack.push({ item, depth });
  }

  return roots;
}

export interface NavigationResult {
  navigation: {
    primary_menu: BlueprintNavItem[];
    footer_menu: BlueprintNavItem[];
    user_menu: BlueprintNavItem[];
  };
  userMenuObserved: boolean;
}

/**
 * Build the navigation menus from observed nav regions. Regions are merged
 * deterministically (region, then label); the user menu is only populated when
 * account-like items are actually observed.
 */
export function buildNavigation(
  models: readonly EvidenceModel[],
  protectedPatterns: readonly string[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): NavigationResult {
  const ordered = [...models].sort((a, b) => a.url.localeCompare(b.url));
  const primary: BlueprintNavItem[] = [];
  const footer: BlueprintNavItem[] = [];
  const user: BlueprintNavItem[] = [];
  const seen = new Set<string>();

  for (const model of ordered) {
    for (const region of model.nav) {
      const isFooter = region.region.toLowerCase() === 'footer';
      const items = buildMenuItems(region, protectedPatterns);
      const target = isFooter ? footer : primary;
      for (const item of items) {
        const key = `${item.href ?? item.action ?? item.label}`;
        const destination = isUserMenuLabel(item.label) ? user : target;
        const destinationKey = `${isFooter ? 'footer' : 'primary'}:${key}`;
        if (destination === user ? seen.has(`user:${key}`) : seen.has(destinationKey)) {
          continue;
        }
        if (destination === user) {
          seen.add(`user:${key}`);
        } else {
          seen.add(destinationKey);
        }
        destination.push(item);
      }
      if (region.items.length > 0) {
        collector.addObservation({
          kind: 'navigation',
          ref: `nav.${region.region}${region.label ? `.${slugify(region.label)}` : ''}`,
          source: `evidence_nav:${model.pageId}`
        });
      }
    }
  }

  return {
    navigation: { primary_menu: primary, footer_menu: footer, user_menu: user },
    userMenuObserved: user.length > 0
  };
}
