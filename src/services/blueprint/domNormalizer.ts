/**
 * DOM segmentation + semantic component classification - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.2 and
 * docs/specs/BLUEPRINT-SPEC.md sections 2.2-2.5.
 *
 * Deterministic, rule-based segmentation of the observed semantic DOM tree into
 * Blueprint components. Classification comes from OBSERVED evidence only -
 * semantic tags, ARIA roles, landmark structure, and tag/class heuristics. A
 * detected technology never upgrades a component's category to a specific
 * implementation, and an uncertain node is never forced into a named component.
 *
 * Provenance (decision C8) distinguishes:
 *   - observed classification (explicit role / semantic landmark tag)
 *   - inferred classification (class-name heuristics, repetition grouping)
 * Both record a confidence and (for inferences) a limitation note.
 */
import type { BlueprintComponent, BlueprintLayoutDefinition } from '../../types/blueprint';
import { MAX_COMPONENTS, MAX_COMPONENT_DEPTH } from '../../types/blueprint';
import type { BlueprintEvidenceNode } from '../infra/workerProtocol';
import type { EvidenceModel } from './evidence';
import { ProvenanceCollector } from './evidence';
import { slugify, sortRecord, uniqueStrings } from './util';

type ComponentCategory = BlueprintComponent['category'];

/** The recognized component kinds (the spec's named set + honest fallbacks). */
export type ComponentKind =
  | 'Header'
  | 'Footer'
  | 'Navbar'
  | 'Main'
  | 'Sidebar'
  | 'Form'
  | 'Modal'
  | 'Card'
  | 'Hero'
  | 'Button'
  | 'Table'
  | 'List'
  | 'Section'
  | 'Article'
  | 'Unknown';

export interface Classification {
  kind: ComponentKind;
  name: string;
  category: ComponentCategory;
  confidence: number;
  /** How the classification was reached (recorded as inference method). */
  method: string;
  /** True when the classification is directly observed (role/landmark tag). */
  observed: boolean;
}

export interface PageSegmentation {
  pageId: string;
  url: string;
  path: string;
  layoutId: string;
  template: string;
  rootComponentIds: string[];
}

export interface DomNormalizationResult {
  components: BlueprintComponent[];
  pages: PageSegmentation[];
  layouts: BlueprintLayoutDefinition[];
  defaultLayoutId: string;
  /** True when the component cap was reached (honest truncation flag). */
  truncated: boolean;
  /** Map from an observed evidence node id to the component it produced. */
  nodeComponentIndex: Map<string, string>;
}

/** One page's inputs to segmentation (evidence model + persisted page facts). */
export interface SegmentationPage {
  pageId: string;
  url: string;
  path: string;
  title: string | null;
  model: EvidenceModel;
}

/** Tags eligible for repeated-sibling grouping. */
const REPEATABLE_TAGS = new Set([
  'article',
  'li',
  'div',
  'section',
  'a',
  'button',
  'tr',
  'figure',
  'option'
]);

const MAX_REPEAT_GROUP = 50;

const ROLE_CLASSIFICATION: Record<string, { kind: ComponentKind; category: ComponentCategory }> = {
  banner: { kind: 'Header', category: 'layout' },
  contentinfo: { kind: 'Footer', category: 'layout' },
  navigation: { kind: 'Navbar', category: 'layout' },
  main: { kind: 'Main', category: 'layout' },
  complementary: { kind: 'Sidebar', category: 'layout' },
  dialog: { kind: 'Modal', category: 'composite' },
  alertdialog: { kind: 'Modal', category: 'composite' },
  form: { kind: 'Form', category: 'form' },
  search: { kind: 'Form', category: 'form' },
  button: { kind: 'Button', category: 'ui_primitive' },
  table: { kind: 'Table', category: 'data_display' },
  grid: { kind: 'Table', category: 'data_display' },
  list: { kind: 'List', category: 'data_display' }
};

const TAG_CLASSIFICATION: Record<string, { kind: ComponentKind; category: ComponentCategory }> = {
  header: { kind: 'Header', category: 'layout' },
  footer: { kind: 'Footer', category: 'layout' },
  nav: { kind: 'Navbar', category: 'layout' },
  main: { kind: 'Main', category: 'layout' },
  aside: { kind: 'Sidebar', category: 'layout' },
  form: { kind: 'Form', category: 'form' },
  dialog: { kind: 'Modal', category: 'composite' },
  table: { kind: 'Table', category: 'data_display' },
  ul: { kind: 'List', category: 'data_display' },
  ol: { kind: 'List', category: 'data_display' },
  section: { kind: 'Section', category: 'composite' },
  article: { kind: 'Article', category: 'composite' }
};

/** Class-name keyword heuristics (inferred, never asserted as an implementation). */
const CLASS_KEYWORDS: Array<{ match: RegExp; kind: ComponentKind; category: ComponentCategory }> = [
  { match: /(^|[-_])modal($|[-_])|(^|[-_])dialog($|[-_])/, kind: 'Modal', category: 'composite' },
  { match: /(^|[-_])card($|[-_])/, kind: 'Card', category: 'composite' },
  { match: /(^|[-_])hero($|[-_])|(^|[-_])banner($|[-_])/, kind: 'Hero', category: 'composite' },
  { match: /navbar|(^|[-_])nav($|[-_])|menu/, kind: 'Navbar', category: 'layout' },
  { match: /(^|[-_])header($|[-_])/, kind: 'Header', category: 'layout' },
  { match: /(^|[-_])footer($|[-_])/, kind: 'Footer', category: 'layout' },
  { match: /(^|[-_])sidebar($|[-_])/, kind: 'Sidebar', category: 'layout' },
  { match: /(^|[-_])btn($|[-_])|(^|[-_])button($|[-_])/, kind: 'Button', category: 'ui_primitive' },
  { match: /(^|[-_])table($|[-_])/, kind: 'Table', category: 'data_display' }
];

/** True when a node is a candidate for a named component (not a plain wrapper). */
function classKeywordKind(classes: readonly string[]): Classification | null {
  // Match each class token independently so a token like `product-card` or
  // `card--a` is recognized without requiring string-boundary anchoring.
  const tokens = classes.map((token) => token.toLowerCase());
  for (const entry of CLASS_KEYWORDS) {
    if (tokens.some((token) => entry.match.test(token))) {
      return {
        kind: entry.kind,
        name: entry.kind,
        category: entry.category,
        confidence: 0.6,
        method: 'class_heuristic',
        observed: false
      };
    }
  }
  return null;
}

/**
 * Classify one observed node. Precedence: ARIA role → semantic landmark tag →
 * class-name heuristic. Returns null when the node is not a named component
 * candidate (the caller then treats it as a transparent wrapper).
 */
export function classifyNode(node: BlueprintEvidenceNode): Classification | null {
  const role = node.role.toLowerCase();
  if (role && ROLE_CLASSIFICATION[role]) {
    const entry = ROLE_CLASSIFICATION[role];
    return {
      kind: entry.kind,
      name: entry.kind,
      category: entry.category,
      confidence: 0.95,
      method: 'aria_role',
      observed: true
    };
  }
  if (node.attrs['aria-modal'] === 'true') {
    return {
      kind: 'Modal',
      name: 'Modal',
      category: 'composite',
      confidence: 0.85,
      method: 'aria_attribute',
      observed: true
    };
  }
  const tag = node.tag.toLowerCase();
  const byTag = TAG_CLASSIFICATION[tag];
  if (byTag) {
    // A plain anchor is content, not a component; only role=button is a Button.
    if (tag === 'a') {
      return null;
    }
    return {
      kind: byTag.kind,
      name: byTag.kind,
      category: byTag.category,
      confidence: 0.9,
      method: 'semantic_tag',
      observed: true
    };
  }
  return classKeywordKind(node.classes);
}

/**
 * A structural signature used for repeat grouping. It intentionally ignores
 * class differences so sibling instances that differ only by a variant class
 * (e.g. `card--a` vs `card--b`) still collapse into ONE composite; the class
 * differences become the component's `variants`.
 */
function structuralSignature(node: BlueprintEvidenceNode, kind: ComponentKind): string {
  return `${kind}|${node.tag}|${node.role}`;
}

interface ComponentRegistry {
  components: BlueprintComponent[];
  /** Repeated-sibling signatures already collapsed into one composite. */
  bySignature: Map<string, BlueprintComponent>;
  /** Maps an observed evidence node id to the component it produced. */
  nodeIndex: Map<string, string>;
  truncated: boolean;
}

/**
 * Create a new component. The id is a deterministic sequential slug
 * (`cmp_<name>_<n>`) so it is stable across runs and never collides across pages
 * or nested instances (no component can become its own ancestor).
 */
function createComponent(
  registry: ComponentRegistry,
  name: string,
  category: ComponentCategory,
  confidence: number,
  nodeId: string
): BlueprintComponent | null {
  if (registry.components.length >= MAX_COMPONENTS) {
    registry.truncated = true;
    return null;
  }
  const index = registry.components.length + 1;
  const component: BlueprintComponent = {
    id: `cmp_${slugify(name) || 'component'}_${index}`,
    name,
    category,
    variants: {},
    props: [],
    children_slots: [],
    dependencies: [],
    children: [],
    confidence
  };
  registry.nodeIndex.set(nodeId, component.id);
  registry.components.push(component);
  return component;
}

interface RepeatInstance {
  node: BlueprintEvidenceNode;
  classification: Classification;
}

/** Derive variant names from the class differences across repeated instances. */
function deriveVariants(instances: RepeatInstance[]): Record<string, string> {
  if (instances.length < 2) {
    return {};
  }
  const classSets = instances.map((instance) => new Set(instance.node.classes));
  const intersection = new Set(instances[0] ? instances[0].node.classes : ([] as string[]));
  for (const set of classSets) {
    for (const token of [...intersection]) {
      if (!set.has(token)) {
        intersection.delete(token);
      }
    }
  }
  const variants: Record<string, string> = {};
  for (const instance of instances) {
    const extra = instance.node.classes.filter((token) => !intersection.has(token));
    if (extra.length === 0) {
      continue;
    }
    // A variant token is the most specific extra class (the last one).
    const variantName = extra[extra.length - 1] ?? 'default';
    variants[variantName] = extra.join(' ');
  }
  return sortRecord(variants);
}

function templateFor(page: SegmentationPage): string {
  const model = page.model;
  const tags = new Set(model.evidence.nodes.map((node) => node.tag.toLowerCase()));
  const hasSidebar = model.evidence.nodes.some(
    (node) => node.tag === 'aside' || node.role === 'complementary'
  );
  const sectionCount = model.evidence.nodes.filter((node) => node.tag === 'section').length;
  if (model.forms.length > 0 && sectionCount <= 1) {
    return 'form';
  }
  if (hasSidebar || tags.has('table')) {
    return 'app';
  }
  if (sectionCount >= 2) {
    return 'landing';
  }
  return 'content';
}

interface PageWalkContext {
  model: EvidenceModel;
  registry: ComponentRegistry;
  collector: ProvenanceCollector;
  layout: { header: string | null; footer: string | null; sidebar: string | null };
  template: string;
  rootComponentIds: string[];
}

/** Attach a child component id to a parent component (idempotent, ordered). */
function attachChild(parent: BlueprintComponent | null, childId: string): void {
  if (!parent) {
    return;
  }
  const children = parent.children ?? [];
  if (!children.includes(childId)) {
    children.push(childId);
    parent.children = children;
  }
}

function recordClassification(
  context: PageWalkContext,
  component: BlueprintComponent,
  node: BlueprintEvidenceNode,
  classification: Classification
): void {
  context.collector.addObservation({
    kind: 'component',
    ref: component.id,
    source: `dom_node:${node.id}`
  });
  context.collector.addInference({
    ref: component.id,
    method: classification.method,
    confidence: classification.confidence,
    ...(classification.observed
      ? {}
      : { limitation: 'Classification inferred from tag/class heuristics, not an explicit role.' })
  });
}

/** Find the first node matching a predicate, in evidence order. */
function firstNode(
  model: EvidenceModel,
  predicate: (node: BlueprintEvidenceNode) => boolean
): BlueprintEvidenceNode | null {
  for (const node of model.evidence.nodes) {
    if (predicate(node)) {
      return node;
    }
  }
  return null;
}

/**
 * Process a node's children: collapse repeated-sibling structures into a single
 * composite component, then classify each remaining significant child. Transparent
 * wrappers are descended into so their significant descendants still surface.
 */
function processChildren(
  context: PageWalkContext,
  parentNode: BlueprintEvidenceNode,
  parentComponent: BlueprintComponent | null,
  depth: number
): void {
  const children = context.model.childrenOf(parentNode.id);
  const grouped = new Set<string>();

  // Pass 1: repeated-sibling grouping by structural signature.
  const groups = new Map<string, BlueprintEvidenceNode[]>();
  for (const child of children) {
    if (!REPEATABLE_TAGS.has(child.tag.toLowerCase())) {
      continue;
    }
    const classification = classifyNode(child);
    const kind: ComponentKind = classification ? classification.kind : 'Unknown';
    const signature = structuralSignature(child, kind);
    const list = groups.get(signature) ?? [];
    list.push(child);
    groups.set(signature, list);
  }

  for (const signature of [...groups.keys()].sort()) {
    const instances = groups.get(signature) ?? [];
    if (instances.length < 2 || instances.length > MAX_REPEAT_GROUP) {
      continue;
    }
    const representative = instances[0];
    if (!representative) {
      continue;
    }
    const classification =
      classifyNode(representative) ??
      ({
        kind: 'Unknown',
        name: 'Unknown',
        category: 'composite',
        confidence: 0.4,
        method: 'repeated_sibling',
        observed: false
      } satisfies Classification);

    const signatureKey = `${signature}#repeat`;
    const component =
      context.registry.bySignature.get(signatureKey) ??
      createComponent(
        context.registry,
        classification.name,
        classification.category,
        classification.confidence,
        representative.id
      );
    if (!component) {
      continue;
    }
    context.registry.bySignature.set(signatureKey, component);
    const variants = deriveVariants(
      instances.map((node) => ({
        node,
        classification: classification
      }))
    );
    if (Object.keys(variants).length > 0) {
      component.variants = variants;
    }
    attachChild(parentComponent, component.id);
    if (!parentComponent) {
      context.rootComponentIds.push(component.id);
    }
    context.collector.addObservation({
      kind: 'component',
      ref: component.id,
      source: `dom_node:${representative.id}`
    });
    context.collector.addInference({
      ref: component.id,
      method: 'repeated_sibling',
      confidence: 0.8,
      limitation: `Collapsed ${instances.length} repeated sibling nodes into one composite component.`
    });
    for (const instance of instances) {
      grouped.add(instance.id);
      context.registry.nodeIndex.set(instance.id, component.id);
    }

    if (depth + 1 < MAX_COMPONENT_DEPTH) {
      processChildren(context, representative, component, depth + 1);
    } else if (context.model.childrenOf(representative.id).length > 0) {
      context.collector.addInference({
        ref: component.id,
        method: 'depth_cap',
        confidence: 0.5,
        limitation: `Nesting collapsed at depth ${MAX_COMPONENT_DEPTH}.`
      });
    }
  }

  // Pass 2: remaining significant single children.
  for (const child of children) {
    if (grouped.has(child.id)) {
      continue;
    }
    const classification = classifyNode(child);
    if (!classification) {
      // Transparent wrapper: descend without creating a component.
      if (depth < MAX_COMPONENT_DEPTH) {
        processChildren(context, child, parentComponent, depth);
      }
      continue;
    }
    if (depth >= MAX_COMPONENT_DEPTH) {
      continue;
    }

    const component = createComponent(
      context.registry,
      classification.name,
      classification.category,
      classification.confidence,
      child.id
    );
    if (!component) {
      continue;
    }
    recordClassification(context, component, child, classification);
    attachChild(parentComponent, component.id);
    if (!parentComponent) {
      context.rootComponentIds.push(component.id);
    }

    if (classification.kind === 'Header' && !context.layout.header) {
      context.layout.header = component.id;
    } else if (classification.kind === 'Footer' && !context.layout.footer) {
      context.layout.footer = component.id;
    } else if (classification.kind === 'Sidebar' && !context.layout.sidebar) {
      context.layout.sidebar = component.id;
    }

    if (depth + 1 < MAX_COMPONENT_DEPTH) {
      processChildren(context, child, component, depth + 1);
    } else if (context.model.childrenOf(child.id).length > 0) {
      context.collector.addInference({
        ref: component.id,
        method: 'depth_cap',
        confidence: 0.5,
        limitation: `Nesting collapsed at depth ${MAX_COMPONENT_DEPTH}.`
      });
    }
  }
}

/** Resolve the layout id from the observed landmark signature. */
function layoutIdFor(layout: {
  header: string | null;
  footer: string | null;
  sidebar: string | null;
}): string {
  const parts: string[] = [];
  if (layout.header) {
    parts.push('header');
  }
  if (layout.sidebar) {
    parts.push('sidebar');
  }
  if (layout.footer) {
    parts.push('footer');
  }
  return parts.length > 0 ? `layout_${parts.join('_')}` : 'layout_plain';
}

function layoutNameFor(id: string): string {
  switch (id) {
    case 'layout_header_footer':
      return 'Public Layout';
    case 'layout_header_sidebar_footer':
    case 'layout_header_sidebar':
      return 'App Layout';
    case 'layout_plain':
      return 'Bare Layout';
    default:
      return 'Layout';
  }
}

/**
 * Segment every page's observed DOM into components, per-page root component
 * ids, layout definitions, and a dominant default layout. Deterministic: pages
 * are processed in path order and components are assigned ids in first-seen
 * order, so identical evidence yields identical output.
 */
export function normalizeDom(
  pages: SegmentationPage[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): DomNormalizationResult {
  const registry: ComponentRegistry = {
    components: [],
    bySignature: new Map(),
    nodeIndex: new Map(),
    truncated: false
  };

  const ordered = [...pages].sort(
    (a, b) => a.path.localeCompare(b.path) || a.pageId.localeCompare(b.pageId)
  );

  const pageSegments: PageSegmentation[] = [];
  const layoutById = new Map<
    string,
    { header: string | null; footer: string | null; sidebar: string | null; count: number }
  >();

  for (const page of ordered) {
    const context: PageWalkContext = {
      model: page.model,
      registry,
      collector,
      layout: { header: null, footer: null, sidebar: null },
      template: templateFor(page),
      rootComponentIds: []
    };

    for (const root of page.model.roots) {
      processChildren(context, root, null, 1);
    }

    const layoutId = layoutIdFor(context.layout);
    const existing = layoutById.get(layoutId) ?? {
      header: context.layout.header,
      footer: context.layout.footer,
      sidebar: context.layout.sidebar,
      count: 0
    };
    existing.count += 1;
    layoutById.set(layoutId, existing);

    pageSegments.push({
      pageId: page.pageId,
      url: page.url,
      path: page.path,
      layoutId,
      template: context.template,
      rootComponentIds: uniqueStrings(context.rootComponentIds)
    });
  }

  const layouts: BlueprintLayoutDefinition[] = [...layoutById.keys()].sort().map((id) => {
    const entry = layoutById.get(id);
    const slots = ['header', 'main', 'footer'];
    if (entry?.sidebar) {
      slots.splice(2, 0, 'sidebar');
    }
    const bodyNode = ordered
      .flatMap((page) => page.model.evidence.nodes)
      .find((node) => node.tag === 'body');
    return {
      id,
      name: layoutNameFor(id),
      header_component_id: entry?.header ?? null,
      footer_component_id: entry?.footer ?? null,
      sidebar_component_id: entry?.sidebar ?? null,
      container_width: '',
      body_bg_color: bodyNode?.styles.backgroundColor ?? '',
      slots
    };
  });

  // Dominant layout = the layout with the most pages; ties break by id.
  let defaultLayoutId = layouts[0]?.id ?? 'layout_plain';
  let bestCount = -1;
  for (const id of [...layoutById.keys()].sort()) {
    const entry = layoutById.get(id);
    const count = entry?.count ?? 0;
    if (count > bestCount) {
      bestCount = count;
      defaultLayoutId = id;
    }
  }

  if (registry.truncated) {
    collector.addInference({
      ref: 'components',
      method: 'component_cap',
      confidence: 0.5,
      limitation: `Component registry reached the maximum of ${MAX_COMPONENTS}; further components were dropped.`
    });
  }

  return {
    components: registry.components,
    pages: pageSegments,
    layouts,
    defaultLayoutId,
    truncated: registry.truncated,
    nodeComponentIndex: registry.nodeIndex
  };
}

/** Convenience: the `<body>` background colour observed on a page, or ''. */
export function observedBodyBackground(model: EvidenceModel): string {
  const body = firstNode(model, (node) => node.tag === 'body');
  return body?.styles.backgroundColor ?? '';
}
