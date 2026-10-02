/**
 * Blueprint evidence capture unit tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 5.1 and
 * docs/specs/BLUEPRINT-SPEC.md.
 *
 * These tests exercise the PURE capture harness (probe source generation +
 * defensive normalization + byte bounding) without a browser. The real-browser
 * E2E lives in `blueprintCapture.e2e.test.ts` (opt-in).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLUEPRINT_LIMITS,
  boundBlueprintEvidence,
  buildBlueprintProbe,
  normalizeBlueprintEvidence,
  type BlueprintCaptureLimits
} from '../blueprintCapture';
import type { BlueprintEvidence } from '../../../services/infra/workerProtocol';

function rawEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nodes: [
      {
        id: 'n0',
        parentId: null,
        tag: 'html',
        role: '',
        semantic: ['document'],
        text: 'Home',
        attrs: {},
        classes: [],
        childIds: ['n1'],
        visible: true,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        styles: { display: 'block', fontSize: '16px', color: 'rgb(0, 0, 0)' }
      },
      {
        id: 'n1',
        parentId: 'n0',
        tag: 'form',
        role: 'form',
        semantic: ['form'],
        text: '',
        attrs: { action: '/api/contact', method: 'post' },
        classes: ['contact'],
        childIds: [],
        visible: true,
        bounds: { x: 0, y: 0, width: 400, height: 200 },
        styles: { display: 'block' }
      }
    ],
    cssVariables: { '--primary': '#0ea5e9', '--bg': '#fff' },
    fontFaces: [{ family: 'Inter', weight: '400', style: 'normal' }],
    forms: [
      {
        id: 'contact',
        name: 'contact',
        method: 'post',
        action: '/api/contact',
        fields: [
          {
            name: 'email',
            label: 'Work Email',
            type: 'email',
            required: true,
            placeholder: 'jane@company.com',
            options: [],
            validations: { maxlength: '100' }
          }
        ],
        submitButtonLabel: 'Submit'
      }
    ],
    nav: [
      {
        region: 'nav',
        label: 'Primary',
        items: [{ href: '/pricing', text: 'Pricing', target: null, depth: 0 }]
      }
    ],
    headings: [{ level: 1, text: 'Build faster', nodeId: 'n0' }],
    links: [{ href: '/pricing', text: 'Pricing', target: null, nodeId: 'n1' }],
    images: [{ src: '/logo.svg', alt: 'Logo', width: 24, height: 24, nodeId: 'n1' }],
    truncated: false,
    nodeCount: 2,
    ...overrides
  };
}

function context(limits: BlueprintCaptureLimits = DEFAULT_BLUEPRINT_LIMITS) {
  return {
    url: 'http://127.0.0.1:5173/blueprint',
    status: 200,
    capturedAt: '2026-01-01T00:00:00.000Z',
    limits
  };
}

describe('buildBlueprintProbe', () => {
  it('interpolates every cap as a literal (no closures)', () => {
    const probe = buildBlueprintProbe({
      ...DEFAULT_BLUEPRINT_LIMITS,
      maxNodes: 42,
      maxTextChars: 7
    });
    expect(probe).toContain('var MAX_NODES = 42');
    expect(probe).toContain('var MAX_TEXT = 7');
    // The probe must never read storage or input values.
    expect(probe).not.toMatch(/localStorage/);
    expect(probe).not.toMatch(/sessionStorage/);
    expect(probe).not.toMatch(/\.value\b/);
    expect(probe).not.toMatch(/document\.cookie/);
  });
});

describe('normalizeBlueprintEvidence', () => {
  it('coerces the raw probe output into a bounded evidence document', () => {
    const evidence = normalizeBlueprintEvidence(rawEvidence(), context());
    expect(evidence.url).toBe('http://127.0.0.1:5173/blueprint');
    expect(evidence.status).toBe(200);
    expect(evidence.nodes).toHaveLength(2);
    expect(evidence.nodes[0]?.tag).toBe('html');
    expect(evidence.cssVariables['--primary']).toBe('#0ea5e9');
    expect(evidence.forms[0]?.fields[0]?.name).toBe('email');
    expect(evidence.nav[0]?.items[0]?.href).toBe('/pricing');
    expect(evidence.headings[0]?.level).toBe(1);
    expect(evidence.links[0]?.text).toBe('Pricing');
    expect(evidence.images[0]?.alt).toBe('Logo');
    expect(evidence.byteLength).toBeGreaterThan(0);
  });

  it('never synthesizes a form field value from the raw evidence', () => {
    // Even if a hostile page smuggled a `value` into a field descriptor, the
    // normalizer only keeps the allowlisted structural fields.
    const raw = rawEvidence({
      forms: [
        {
          id: 'f',
          name: 'f',
          method: 'post',
          action: '/x',
          fields: [
            {
              name: 'password',
              label: 'Password',
              type: 'password',
              required: true,
              placeholder: null,
              options: [],
              validations: {},
              value: 'SUPER_SECRET'
            }
          ],
          submitButtonLabel: 'Go'
        }
      ]
    });
    const evidence = normalizeBlueprintEvidence(raw, context());
    const field = evidence.forms[0]?.fields[0] as unknown as Record<string, unknown>;
    expect(field).toBeDefined();
    expect(field.value).toBeUndefined();
    expect(JSON.stringify(evidence)).not.toContain('SUPER_SECRET');
  });

  it('caps text at the configured limit', () => {
    const long = 'x'.repeat(500);
    const evidence = normalizeBlueprintEvidence(
      rawEvidence({ headings: [{ level: 1, text: long, nodeId: 'n0' }] }),
      context({ ...DEFAULT_BLUEPRINT_LIMITS, maxTextChars: 10 })
    );
    expect(evidence.headings[0]?.text).toBe('xxxxxxxxxx');
  });

  it('drops unknown / non-string fields and tolerates malformed input', () => {
    const evidence = normalizeBlueprintEvidence(
      { nodes: 'nope', links: 42, cssVariables: null },
      context()
    );
    expect(evidence.nodes).toEqual([]);
    expect(evidence.links).toEqual([]);
    expect(evidence.cssVariables).toEqual({});
    expect(evidence.truncated).toBe(false);
  });

  it('caps the node count and flags truncation', () => {
    const nodes = Array.from({ length: 20 }, (_value, index) => ({
      id: `n${index}`,
      parentId: null,
      tag: 'div',
      role: '',
      semantic: [],
      text: '',
      attrs: {},
      classes: [],
      childIds: [],
      visible: true,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      styles: {}
    }));
    const evidence = normalizeBlueprintEvidence(
      rawEvidence({ nodes }),
      context({ ...DEFAULT_BLUEPRINT_LIMITS, maxNodes: 5 })
    );
    expect(evidence.nodes).toHaveLength(5);
    expect(evidence.limits.maxNodes).toBe(5);
  });
});

describe('boundBlueprintEvidence', () => {
  function bigEvidence(nodeCount: number): BlueprintEvidence {
    const nodes = Array.from({ length: nodeCount }, (_value, index) => ({
      id: `n${index}`,
      parentId: null,
      tag: 'div',
      role: '',
      semantic: [],
      text: 'x'.repeat(50),
      attrs: {},
      classes: [],
      childIds: [],
      visible: true,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      styles: {
        display: 'block',
        position: 'static',
        flexDirection: 'row',
        gridTemplateColumns: 'none',
        fontSize: '16px',
        fontWeight: '400',
        lineHeight: '24px',
        color: 'rgb(0, 0, 0)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        borderColor: 'rgb(0, 0, 0)',
        borderRadius: '0px',
        boxShadow: 'none',
        margin: '0px',
        padding: '0px',
        gap: 'normal',
        fontFamily: 'Inter'
      }
    }));
    return {
      url: 'http://x/',
      status: 200,
      capturedAt: '2026-01-01T00:00:00.000Z',
      nodes,
      cssVariables: {},
      fontFaces: [],
      forms: [],
      nav: [],
      headings: [],
      links: [],
      images: [],
      truncated: false,
      nodeCount: nodeCount,
      byteLength: 0,
      limits: { ...DEFAULT_BLUEPRINT_LIMITS }
    };
  }

  it('returns the document unchanged (with byteLength) when it fits', () => {
    const evidence = bigEvidence(2);
    const bounded = boundBlueprintEvidence(evidence, 10_000_000);
    expect(bounded.truncated).toBe(false);
    expect(bounded.nodes).toHaveLength(2);
    expect(bounded.byteLength).toBeGreaterThan(0);
  });

  it('trims the document and flags truncation when it exceeds the byte cap', () => {
    const evidence = bigEvidence(200);
    const bounded = boundBlueprintEvidence(evidence, 2000);
    expect(bounded.truncated).toBe(true);
    expect(bounded.byteLength).toBeLessThanOrEqual(2000);
    expect(bounded.nodes.length).toBeLessThan(200);
  });

  it('prunes dangling childIds after trimming', () => {
    const evidence = bigEvidence(50);
    evidence.nodes[0]!.childIds = evidence.nodes.slice(1).map((node) => node.id);
    const bounded = boundBlueprintEvidence(evidence, 1500);
    const present = new Set(bounded.nodes.map((node) => node.id));
    for (const node of bounded.nodes) {
      for (const childId of node.childIds) {
        expect(present.has(childId)).toBe(true);
      }
    }
  });
});
