/**
 * Evidence projection + provenance tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 5.6 and 11.
 */
import { describe, expect, it } from 'vitest';
import type { ScanPage } from '../../../types/models';
import {
  buildEvidenceModel,
  evidenceIdFromPath,
  loadPageEvidence,
  parsePageEvidence,
  ProvenanceCollector,
  validateEvidenceShape,
  type EvidenceIo
} from '../evidence';
import { evidence, fixtureEvidence } from './fixtures';
import { encodeUtf8 } from '../util';

function page(overrides: Partial<ScanPage> = {}): ScanPage {
  return {
    id: 'p1',
    scanId: 's1',
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    path: '/',
    depth: 0,
    httpStatus: 200,
    title: 'Home',
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    status: 'completed',
    authStatus: 'public',
    errorCode: null,
    errorMessage: null,
    loadTimeMs: null,
    domContentLoadedTimeMs: null,
    domNodeCount: null,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawHtmlPath: null,
    blueprintEvidencePath: 'v1/evidence-p1.json',
    ...overrides
  };
}

describe('validateEvidenceShape', () => {
  it('accepts a well-formed evidence document', () => {
    expect(validateEvidenceShape(evidence())).not.toBeNull();
  });

  it('rejects a non-object or a document without a nodes array', () => {
    expect(validateEvidenceShape(null)).toBeNull();
    expect(validateEvidenceShape({})).toBeNull();
    expect(validateEvidenceShape({ nodes: 'nope' })).toBeNull();
  });

  it('drops malformed nodes rather than fabricating them', () => {
    const result = validateEvidenceShape({ nodes: [{ id: 'n0', tag: 'div' }, { tag: 'span' }] });
    expect(result?.nodes).toHaveLength(1);
  });
});

describe('buildEvidenceModel', () => {
  it('indexes nodes, roots, and children', () => {
    const model = buildEvidenceModel(
      'p1',
      'https://example.com/',
      evidence({
        nodes: [
          { ...evidenceNode('n0', null), childIds: ['n1'] },
          { ...evidenceNode('n1', 'n0'), childIds: [] }
        ]
      })
    );
    expect(model.nodeById.size).toBe(2);
    expect(model.roots.map((node) => node.id)).toEqual(['n0']);
    expect(model.childrenOf('n0').map((node) => node.id)).toEqual(['n1']);
  });
});

function evidenceNode(id: string, parentId: string | null) {
  return {
    id,
    parentId,
    tag: 'div',
    role: '',
    semantic: [],
    text: '',
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
      lineHeight: '1.5',
      color: 'rgb(0,0,0)',
      backgroundColor: 'rgba(0,0,0,0)',
      borderColor: '',
      borderRadius: '0px',
      boxShadow: 'none',
      margin: '0px',
      padding: '0px',
      gap: 'normal',
      fontFamily: 'Inter'
    }
  };
}

describe('loadPageEvidence', () => {
  it('loads valid evidence and reports malformed/missing evidence honestly', async () => {
    const io: EvidenceIo = {
      async read(path) {
        if (path.endsWith('missing.json')) {
          return null;
        }
        if (path.endsWith('malformed.json')) {
          return encodeUtf8('{ not json');
        }
        return encodeUtf8(JSON.stringify(fixtureEvidence()));
      }
    };
    const result = await loadPageEvidence(
      [
        page({ id: 'ok' }),
        page({ id: 'miss', blueprintEvidencePath: 'v1/missing.json' }),
        page({ id: 'bad', blueprintEvidencePath: 'v1/malformed.json' }),
        page({ id: 'none', blueprintEvidencePath: null })
      ],
      io
    );
    expect(result.loaded).toHaveLength(1);
    expect(result.skipped.map((entry) => entry.pageId)).toEqual(['miss', 'bad', 'none']);
    expect(result.skipped.find((entry) => entry.pageId === 'bad')?.reason).toBe('malformed');
    expect(result.skipped.find((entry) => entry.pageId === 'none')?.reason).toBe('missing');
  });

  it('treats a read failure as a skip, never a throw', async () => {
    const io: EvidenceIo = {
      async read() {
        throw new Error('io boom');
      }
    };
    const result = await loadPageEvidence([page({ id: 'x' })], io);
    expect(result.loaded).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
});

describe('parsePageEvidence', () => {
  it('marks a page without a stored path as a missing skip', () => {
    const result = parsePageEvidence(page({ blueprintEvidencePath: null }), null);
    expect('reason' in result && result.reason).toBe('missing');
  });
});

describe('evidenceIdFromPath', () => {
  it('extracts a safe id from a stored path and rejects traversal', () => {
    expect(evidenceIdFromPath('v1/evidence-p1.json')).toBe('evidence-p1');
    expect(evidenceIdFromPath('v1/../secret.json')).toBeNull();
    expect(evidenceIdFromPath('v1/x.txt')).toBeNull();
  });
});

describe('ProvenanceCollector', () => {
  it('dedupes observations and inferences deterministically', () => {
    const collector = new ProvenanceCollector();
    collector.addObservation({ kind: 'component', ref: 'cmp_1', source: 'dom_node:n0' });
    collector.addObservation({ kind: 'component', ref: 'cmp_1', source: 'dom_node:n0' });
    collector.addInference({ ref: 'cmp_1', method: 'semantic_tag', confidence: 0.9 });
    collector.addInference({ ref: 'cmp_1', method: 'semantic_tag', confidence: 0.9 });
    expect(collector.observations()).toHaveLength(1);
    expect(collector.inferences()).toHaveLength(1);
  });

  it('distinguishes an observed classification from an inferred one', () => {
    const collector = new ProvenanceCollector();
    collector.addInference({
      ref: 'cmp_card_1',
      method: 'class_heuristic',
      confidence: 0.6,
      limitation: 'Inferred from class names.'
    });
    const inference = collector.inferences()[0];
    expect(inference?.limitation).toBeDefined();
    expect(inference?.confidence).toBeLessThan(1);
  });
});
