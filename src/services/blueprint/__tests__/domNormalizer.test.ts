/**
 * DOM segmentation + semantic classification tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 11.
 */
import { describe, expect, it } from 'vitest';
import { MAX_COMPONENT_DEPTH } from '../../../types/blueprint';
import { classifyNode, normalizeDom, type SegmentationPage } from '../domNormalizer';
import { fixtureEvidence, model, node } from './fixtures';

function page(
  overrides: Parameters<typeof model>[0],
  path = '/',
  pageId = 'page_1'
): SegmentationPage {
  return {
    pageId,
    url: `https://example.com${path}`,
    path,
    title: 'Home',
    model: model(overrides, pageId)
  };
}

describe('classifyNode', () => {
  it('classifies landmarks from semantic tags as observed', () => {
    expect(classifyNode(node({ id: 'h', tag: 'header' }))?.kind).toBe('Header');
    expect(classifyNode(node({ id: 'f', tag: 'footer' }))?.kind).toBe('Footer');
    expect(classifyNode(node({ id: 'n', tag: 'nav' }))?.kind).toBe('Navbar');
    expect(classifyNode(node({ id: 'm', tag: 'main' }))?.kind).toBe('Main');
    expect(classifyNode(node({ id: 'a', tag: 'aside' }))?.kind).toBe('Sidebar');
    expect(classifyNode(node({ id: 'fo', tag: 'form' }))?.kind).toBe('Form');
  });

  it('classifies from ARIA role with high confidence and observed provenance', () => {
    const header = classifyNode(node({ id: 'x', tag: 'div', role: 'banner' }));
    expect(header?.kind).toBe('Header');
    expect(header?.observed).toBe(true);
    expect(header?.confidence).toBeGreaterThan(0.9);

    const dialog = classifyNode(node({ id: 'd', tag: 'div', role: 'dialog' }));
    expect(dialog?.kind).toBe('Modal');
    expect(dialog?.category).toBe('composite');
  });

  it('infers a Card from class heuristics with lower confidence and a limitation', () => {
    const card = classifyNode(node({ id: 'c', tag: 'div', classes: ['feature-card'] }));
    expect(card?.kind).toBe('Card');
    expect(card?.observed).toBe(false);
    expect(card?.confidence).toBeLessThan(0.9);
  });

  it('returns null for a transparent wrapper (not every node is a component)', () => {
    expect(classifyNode(node({ id: 'w', tag: 'div' }))).toBeNull();
  });
});

describe('normalizeDom', () => {
  it('segments a landmark page into header/nav/footer components', () => {
    const result = normalizeDom([page(fixtureEvidence(), '/')]);
    const names = result.components.map((component) => component.name);
    expect(names).toContain('Header');
    expect(names).toContain('Navbar');
    expect(names).toContain('Footer');
    expect(result.pages[0]?.rootComponentIds.length).toBeGreaterThan(0);
  });

  it('collapses repeated sibling cards into one composite with variants', () => {
    const result = normalizeDom([
      page({
        nodes: [
          node({ id: 'grid', tag: 'section', classes: ['card-grid'] }),
          node({ id: 'c1', parentId: 'grid', tag: 'div', classes: ['card', 'card--a'] }),
          node({ id: 'c2', parentId: 'grid', tag: 'div', classes: ['card', 'card--b'] }),
          node({ id: 'c3', parentId: 'grid', tag: 'div', classes: ['card', 'card--a'] })
        ]
      })
    ]);
    const cards = result.components.filter((component) => component.name === 'Card');
    // The three repeated siblings collapse into exactly one composite.
    expect(cards).toHaveLength(1);
    expect(Object.keys(cards[0]?.variants ?? {}).length).toBeGreaterThan(0);
  });

  it('records provenance distinguishing observed vs inferred classification', () => {
    const result = normalizeDom([page(fixtureEvidence(), '/')]);
    const header = result.components.find((component) => component.name === 'Header');
    expect(header?.confidence).toBeGreaterThan(0.85);
    const cardResult = normalizeDom([
      page({
        nodes: [
          node({ id: 'g', tag: 'section' }),
          node({ id: 'c1', parentId: 'g', tag: 'div', classes: ['product-card'] }),
          node({ id: 'c2', parentId: 'g', tag: 'div', classes: ['product-card'] })
        ]
      })
    ]);
    const inferredCard = cardResult.components.find((component) => component.name === 'Card');
    expect(inferredCard?.confidence).toBeLessThan(0.9);
  });

  it('never forces an unknown wrapper into a named component', () => {
    const result = normalizeDom([
      page({
        nodes: [
          node({ id: 'w1', tag: 'div' }),
          node({ id: 'w2', parentId: 'w1', tag: 'span', text: 'hi' })
        ]
      })
    ]);
    expect(result.components).toHaveLength(0);
  });

  it('produces stable component ids across runs (determinism)', () => {
    const first = normalizeDom([page(fixtureEvidence(), '/')]);
    const second = normalizeDom([page(fixtureEvidence(), '/')]);
    expect(first.components.map((component) => component.id)).toEqual(
      second.components.map((component) => component.id)
    );
  });

  it('bounds nesting depth and records a depth-cap inference', () => {
    // Build a chain deeper than the cap using classified `section` nodes.
    const nodes = [node({ id: 's0', tag: 'section' })];
    for (let i = 1; i < MAX_COMPONENT_DEPTH + 4; i += 1) {
      nodes.push(node({ id: `s${i}`, parentId: `s${i - 1}`, tag: 'section' }));
    }
    const result = normalizeDom([page({ nodes })]);
    expect(result.components.length).toBeLessThanOrEqual(MAX_COMPONENT_DEPTH + 4);
    // No component graph may exceed the schema depth cap.
    const depthOf = (id: string): number => {
      const component = result.components.find((entry) => entry.id === id);
      const children = component?.children ?? [];
      return children.length === 0 ? 1 : 1 + Math.max(...children.map(depthOf));
    };
    const maxDepth = Math.max(...result.components.map((component) => depthOf(component.id)), 0);
    expect(maxDepth).toBeLessThanOrEqual(MAX_COMPONENT_DEPTH);
  });

  it('derives a layout id from observed landmarks', () => {
    const result = normalizeDom([page(fixtureEvidence(), '/')]);
    expect(result.defaultLayoutId).toContain('layout_');
    expect(result.layouts.length).toBeGreaterThan(0);
    const layout = result.layouts[0];
    expect(layout?.header_component_id).not.toBeNull();
    expect(layout?.footer_component_id).not.toBeNull();
  });
});
