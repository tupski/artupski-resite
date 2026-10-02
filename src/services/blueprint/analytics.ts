/**
 * Analytics, authentication, responsive rules, interactions, admin requirements
 * - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.5 and
 * docs/specs/BLUEPRINT-SPEC.md sections 2.10, 2.11, 2.13, 2.16, 2.18.
 *
 * These sections are derived from OBSERVED evidence only:
 *   - analytics providers from detected analytics technologies;
 *   - authentication from per-page auth classification (never from a guess);
 *   - responsive rules from captured breakpoints + observed grid changes;
 *   - interactions from observed controls with an explicit `aria-*` state;
 *   - admin requirements are empty unless a CRUD-like table is observed.
 */
import type { ResponsiveCapture, ScanPage, ScanTechnology } from '../../types/models';
import type {
  BlueprintAdminRequirements,
  BlueprintAnalytics,
  BlueprintAuthentication,
  BlueprintInteraction,
  BlueprintResponsiveRules
} from '../../types/blueprint';
import type { EvidenceModel } from './evidence';
import { ProvenanceCollector } from './evidence';
import { slugify } from './util';

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

/** Build the analytics section from detected analytics technologies. */
export function buildAnalytics(
  technologies: readonly ScanTechnology[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintAnalytics {
  const providers: BlueprintAnalytics['providers'] = [];
  const seen = new Set<string>();
  const ordered = technologies
    .filter((technology) => technology.category === 'Analytics & Tracking')
    .filter(
      (technology) =>
        technology.confidenceStatus === null || technology.confidenceStatus !== 'unknown'
    )
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  for (const technology of ordered) {
    const key = technology.technologyId ?? technology.name;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const container = technology.evidence
      .map((entry) => /(G-[A-Z0-9]{4,}|GTM-[A-Z0-9]{4,}|UA-\d{4,}-\d+)/.exec(entry.evidence)?.[1])
      .find((value): value is string => typeof value === 'string');
    providers.push({
      provider: technology.technologyId ?? slugify(technology.name),
      ...(container ? { container_id: container } : {}),
      page_view_tracking: true
    });
    collector.addObservation({
      kind: 'analytics_provider',
      ref: technology.technologyId ?? technology.name,
      source: `scan_technology:${technology.id}`
    });
  }

  return { providers, custom_events: [] };
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

const LOGIN_PATTERN = /\/(login|signin|sign-in|auth)(\/|$)/i;
const LOGOUT_PATTERN = /\/(logout|signout|sign-out)(\/|$)/i;
const DASHBOARD_PATTERN = /\/(dashboard|admin|account|app)(\/|$)/i;

/**
 * Build the authentication section from per-page classification. `type` is
 * `cookie_session` only when an auth-guarded page was observed, otherwise
 * `none` (the honest default when no auth evidence exists).
 */
export function buildAuthentication(
  pages: readonly ScanPage[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintAuthentication {
  const protectedPatterns: string[] = [];
  const guardedPaths: string[] = [];
  for (const page of pages) {
    if (page.authStatus === 'auth_required' || page.authStatus === 'blocked') {
      protectedPatterns.push(page.path);
      guardedPaths.push(page.path);
    }
  }
  protectedPatterns.sort();
  guardedPaths.sort();

  const findPath = (pattern: RegExp): string | undefined =>
    guardedPaths.find((path) => pattern.test(path));

  const auth: BlueprintAuthentication = {
    type: guardedPaths.length > 0 ? 'cookie_session' : 'none',
    roles: [],
    protected_route_patterns: [...new Set(protectedPatterns)]
  };

  const loginRoute = findPath(LOGIN_PATTERN);
  const logoutRoute = findPath(LOGOUT_PATTERN);
  const dashboardRoute = findPath(DASHBOARD_PATTERN);
  if (loginRoute) {
    auth.login_route = loginRoute;
  }
  if (logoutRoute) {
    auth.logout_route = logoutRoute;
  }
  if (dashboardRoute) {
    auth.dashboard_route = dashboardRoute;
  }

  if (guardedPaths.length > 0) {
    collector.addObservation({
      kind: 'authentication',
      ref: 'authentication.protected_route_patterns',
      source: `scan_page:${guardedPaths.length}`
    });
  }

  return auth;
}

/* -------------------------------------------------------------------------- */
/* Responsive rules                                                           */
/* -------------------------------------------------------------------------- */

/** Build responsive rules from captured breakpoints + observed grid changes. */
export function buildResponsiveRules(
  captures: readonly ResponsiveCapture[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintResponsiveRules {
  const breakpointValues = new Set<number>();
  for (const capture of captures) {
    for (const breakpoint of capture.detectedBreakpoints) {
      if (Number.isFinite(breakpoint) && breakpoint > 0) {
        breakpointValues.add(Math.round(breakpoint));
      }
    }
  }
  const sorted = [...breakpointValues].sort((a, b) => a - b);
  const names = ['sm', 'md', 'lg', 'xl', '2xl', '3xl'];
  const breakpoints: Record<string, string> = {};
  sorted.forEach((value, index) => {
    breakpoints[names[index] ?? `bp_${index + 1}`] = `${value}px`;
  });

  if (sorted.length > 0) {
    collector.addObservation({
      kind: 'responsive_breakpoints',
      ref: 'responsive_rules.breakpoints',
      source: `responsive_captures:${captures.length}`
    });
  }

  return { breakpoints, overrides: [] };
}

/* -------------------------------------------------------------------------- */
/* Interactions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build interactions from observed disclosure controls (`aria-expanded`,
 * `aria-haspopup`) only. No client-side behaviour is executed or inferred from
 * script; a control without an explicit state attribute produces nothing. The
 * trigger must resolve to a real component via the node index, so an
 * interaction never references a non-existent component.
 */
export function buildInteractions(
  models: readonly EvidenceModel[],
  nodeComponentIndex: ReadonlyMap<string, string>,
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintInteraction[] {
  const ordered = [...models].sort((a, b) => a.url.localeCompare(b.url));
  const interactions: BlueprintInteraction[] = [];
  const seen = new Set<string>();

  for (const model of ordered) {
    for (const node of model.visibleNodes) {
      const hasPopup = node.attrs['aria-haspopup'];
      const expanded = node.attrs['aria-expanded'];
      if (!hasPopup && expanded === undefined) {
        continue;
      }
      const trigger = nodeComponentIndex.get(node.id);
      if (!trigger) {
        continue;
      }
      const action = hasPopup ? 'open_menu' : 'toggle_expanded';
      const id = `int_${slugify(node.id)}_${interactions.length + 1}`;
      const key = `${trigger}:${action}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      interactions.push({
        id,
        trigger_component_id: trigger,
        event: 'onClick',
        action,
        confidence: 0.6
      });
      collector.addInference({
        ref: id,
        method: 'aria_state',
        confidence: 0.6,
        limitation:
          'Interaction inferred from an observed ARIA state attribute; runtime behaviour was not executed.'
      });
    }
  }

  return interactions;
}

/* -------------------------------------------------------------------------- */
/* Admin requirements                                                         */
/* -------------------------------------------------------------------------- */

/** Build admin requirements only when a CRUD-like table is observed. */
export function buildAdminRequirements(
  models: readonly EvidenceModel[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintAdminRequirements {
  const entities: BlueprintAdminRequirements['entities'] = [];
  const seen = new Set<string>();

  for (const model of [...models].sort((a, b) => a.url.localeCompare(b.url))) {
    for (const node of model.visibleNodes) {
      if (node.tag !== 'table') {
        continue;
      }
      const name = slugify(node.attrs['id'] ?? node.classes[0] ?? 'entity') || 'entity';
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      entities.push({
        name,
        plural: `${name}s`,
        fields: [],
        capabilities: ['read']
      });
      collector.addInference({
        ref: `admin_requirements.${name}`,
        method: 'table_heuristic',
        confidence: 0.5,
        limitation:
          'A table was observed; entity fields and CRUD capabilities cannot be inferred from structure alone.'
      });
    }
  }

  return { entities };
}
