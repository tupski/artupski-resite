/**
 * Shared test fixtures for the Blueprint normalization tests - Artupski ReSite
 *
 * Builds bounded `BlueprintEvidence` documents and a normalized `EvidenceModel`
 * from a compact spec, so each test asserts behaviour rather than boilerplate.
 * These helpers contain no production logic and are never imported by app code.
 */
import type { BlueprintEvidence, BlueprintEvidenceNode } from '../../infra/workerProtocol';
import { buildEvidenceModel, type EvidenceModel } from '../evidence';

export interface NodeSpec {
  id: string;
  parentId?: string | null;
  tag: string;
  role?: string;
  semantic?: string[];
  text?: string;
  attrs?: Record<string, string>;
  classes?: string[];
  visible?: boolean;
  styles?: Partial<BlueprintEvidenceNode['styles']>;
}

const DEFAULT_STYLES: BlueprintEvidenceNode['styles'] = {
  display: 'block',
  position: 'static',
  flexDirection: 'row',
  gridTemplateColumns: 'none',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '1.5',
  color: 'rgb(15, 23, 42)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  borderColor: 'rgb(226, 232, 240)',
  borderRadius: '0px',
  boxShadow: 'none',
  margin: '0px',
  padding: '0px',
  gap: 'normal',
  fontFamily: 'Inter, sans-serif'
};

/** Build a bounded evidence node from a compact spec. */
export function node(spec: NodeSpec): BlueprintEvidenceNode {
  return {
    id: spec.id,
    parentId: spec.parentId ?? null,
    tag: spec.tag,
    role: spec.role ?? '',
    semantic: spec.semantic ?? [],
    text: spec.text ?? '',
    attrs: spec.attrs ?? {},
    classes: spec.classes ?? [],
    childIds: [],
    visible: spec.visible ?? true,
    bounds: { x: 0, y: 0, width: 100, height: 20 },
    styles: { ...DEFAULT_STYLES, ...spec.styles }
  };
}

/** Wire parent/child ids from the specs' parentId links. */
export function linkChildren(nodes: BlueprintEvidenceNode[]): BlueprintEvidenceNode[] {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  for (const entry of nodes) {
    if (entry.parentId && byId.has(entry.parentId)) {
      const parent = byId.get(entry.parentId) as BlueprintEvidenceNode;
      if (!parent.childIds.includes(entry.id)) {
        parent.childIds.push(entry.id);
      }
    }
  }
  return nodes;
}

export function evidence(overrides: Partial<BlueprintEvidence> = {}): BlueprintEvidence {
  return {
    url: 'https://example.com/',
    status: 200,
    capturedAt: '2026-01-01T00:00:00.000Z',
    nodes: [],
    cssVariables: {},
    fontFaces: [],
    forms: [],
    nav: [],
    headings: [],
    links: [],
    images: [],
    truncated: false,
    nodeCount: 0,
    byteLength: 0,
    limits: { maxNodes: 5000, maxBytes: 4194304, maxTextChars: 200, maxForms: 50, maxCssVars: 500 },
    ...overrides
  };
}

export function model(
  overrides: Partial<BlueprintEvidence> = {},
  pageId = 'page_1'
): EvidenceModel {
  const document = evidence(overrides);
  document.nodes = linkChildren(document.nodes);
  document.nodeCount = document.nodes.length;
  return buildEvidenceModel(pageId, document.url, document);
}

/**
 * A representative captured fixture mirroring `scripts/fixtures/blueprint/index.html`:
 * header + nav, hero, a repeated card grid, a contact form, footer nav, CSS
 * variables, and a font-face.
 */
export function fixtureEvidence(url = 'https://example.com/'): BlueprintEvidence {
  const nodes = linkChildren([
    node({ id: 'n0', tag: 'html', attrs: { lang: 'en', dir: 'ltr' } }),
    node({
      id: 'n1',
      parentId: 'n0',
      tag: 'body',
      styles: { backgroundColor: 'rgb(255, 255, 255)' }
    }),
    node({ id: 'n2', parentId: 'n1', tag: 'header', classes: ['site-header'] }),
    node({ id: 'n3', parentId: 'n2', tag: 'a', text: 'Blueprint Fixture', attrs: { href: '/' } }),
    node({
      id: 'n4',
      parentId: 'n2',
      tag: 'nav',
      role: 'navigation',
      attrs: { 'aria-label': 'Primary' }
    }),
    node({ id: 'n5', parentId: 'n4', tag: 'a', text: 'Home', attrs: { href: '/' } }),
    node({ id: 'n6', parentId: 'n4', tag: 'a', text: 'Features', attrs: { href: '/features' } }),
    node({ id: 'n7', parentId: 'n1', tag: 'main' }),
    node({ id: 'n8', parentId: 'n7', tag: 'section', classes: ['hero'] }),
    node({ id: 'n9', parentId: 'n8', tag: 'h1', text: 'Build applications at lightning speed' }),
    node({
      id: 'n10',
      parentId: 'n8',
      tag: 'a',
      text: 'Start free trial',
      classes: ['btn-primary'],
      attrs: { href: '/signup' }
    }),
    node({ id: 'n11', parentId: 'n7', tag: 'section', classes: ['card-grid'] }),
    node({ id: 'n12', parentId: 'n11', tag: 'article', classes: ['card'] }),
    node({ id: 'n13', parentId: 'n12', tag: 'h3', text: 'Real-time Sync' }),
    node({ id: 'n14', parentId: 'n11', tag: 'article', classes: ['card'] }),
    node({ id: 'n15', parentId: 'n14', tag: 'h3', text: 'Enterprise Security' }),
    node({ id: 'n16', parentId: 'n11', tag: 'article', classes: ['card'] }),
    node({ id: 'n17', parentId: 'n16', tag: 'h3', text: 'Global CDN' }),
    node({ id: 'n18', parentId: 'n7', tag: 'section', classes: ['contact'] }),
    node({
      id: 'n19',
      parentId: 'n18',
      tag: 'form',
      attrs: { id: 'contact-form', name: 'contact', method: 'post', action: '/api/v1/contact' }
    }),
    node({ id: 'n20', parentId: 'n1', tag: 'footer', classes: ['site-footer'] }),
    node({ id: 'n21', parentId: 'n20', tag: 'nav', attrs: { 'aria-label': 'Footer' } }),
    node({
      id: 'n22',
      parentId: 'n21',
      tag: 'a',
      text: 'Privacy Policy',
      attrs: { href: '/legal/privacy' }
    })
  ]);

  return evidence({
    url,
    nodes,
    nodeCount: nodes.length,
    cssVariables: {
      '--primary': '#0ea5e9',
      '--primary-foreground': '#ffffff',
      '--background': '#ffffff',
      '--foreground': '#0f172a',
      '--muted': '#f1f5f9',
      '--border': '#e2e8f0',
      '--radius-md': '0.375rem',
      '--spacing-4': '1rem'
    },
    fontFaces: [
      { family: 'Inter', weight: '400', style: 'normal' },
      { family: 'Inter', weight: '600', style: 'normal' }
    ],
    forms: [
      {
        id: 'contact-form',
        name: 'contact',
        method: 'post',
        action: '/api/v1/contact',
        submitButtonLabel: 'Submit Request',
        fields: [
          {
            name: 'full_name',
            label: 'Full Name',
            type: 'text',
            required: true,
            placeholder: 'Jane Doe',
            options: [],
            validations: { minlength: '2', maxlength: '100' }
          },
          {
            name: 'email',
            label: 'Work Email',
            type: 'email',
            required: true,
            placeholder: 'jane@company.com',
            options: [],
            validations: {}
          },
          {
            name: 'company_size',
            label: 'Company Size',
            type: 'select',
            required: true,
            placeholder: null,
            options: [
              { label: '1-10 employees', value: '1-10' },
              { label: '11-50 employees', value: '11-50' }
            ],
            validations: {}
          }
        ]
      }
    ],
    nav: [
      {
        region: 'header',
        label: 'Primary',
        items: [
          { href: '/', text: 'Home', target: null, depth: 0 },
          { href: '/features', text: 'Features', target: null, depth: 0 }
        ]
      },
      {
        region: 'footer',
        label: 'Footer',
        items: [{ href: '/legal/privacy', text: 'Privacy Policy', target: null, depth: 0 }]
      }
    ],
    headings: [
      { level: 1, text: 'Build applications at lightning speed', nodeId: 'n9' },
      { level: 3, text: 'Real-time Sync', nodeId: 'n13' }
    ],
    links: [
      { href: '/', text: 'Home', target: null, nodeId: 'n5' },
      { href: '/features', text: 'Features', target: null, nodeId: 'n6' }
    ],
    images: [
      {
        src: '/assets/logo.svg',
        alt: 'Blueprint fixture logo',
        width: 24,
        height: 24,
        nodeId: 'n3'
      }
    ]
  });
}
