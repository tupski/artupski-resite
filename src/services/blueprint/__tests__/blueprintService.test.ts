/**
 * End-to-end Blueprint synthesis + determinism tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md sections 5, 9, 11.
 *
 * Runs the full orchestrator over the representative captured fixture (mirrors
 * `scripts/fixtures/blueprint/index.html`), asserts the resulting document passes
 * the COMPLETE `validateBlueprint`, proves identical evidence yields an identical
 * document, and proves a page without evidence is skipped honestly.
 */
import { describe, expect, it } from 'vitest';
import { validateBlueprint } from '../../../types/blueprint';
import type { ScanPage } from '../../../types/models';
import { synthesizeBlueprint, eligiblePages } from '../blueprintService';
import { runBlueprint, type BlueprintReadStore } from '../runBlueprint';
import type { EvidenceIo } from '../evidence';
import { fixtureEvidence } from './fixtures';
import { encodeUtf8 } from '../util';

const GENERATED_AT = '2026-10-01T00:00:00.000Z';

function scanPage(overrides: Partial<ScanPage> = {}): ScanPage {
  return {
    id: 'p1',
    scanId: 's1',
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    path: '/',
    depth: 0,
    httpStatus: 200,
    title: 'Blueprint Fixture Home',
    metaDescription: 'A controlled fixture.',
    canonicalUrl: 'https://example.com/',
    robotsMeta: 'index, follow',
    status: 'completed',
    authStatus: 'public',
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 10,
    domContentLoadedTimeMs: 5,
    domNodeCount: 30,
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

function evidenceIoFor(map: Record<string, unknown>): EvidenceIo {
  return {
    async read(path) {
      const key = path.split('/').pop() ?? '';
      const value = map[key];
      return value === undefined ? null : encodeUtf8(JSON.stringify(value));
    }
  };
}

describe('synthesizeBlueprint - end to end', () => {
  it('produces a document that passes the FULL schema validation', async () => {
    const result = await synthesizeBlueprint(
      {
        scanId: 's1',
        projectId: 'proj1',
        sourceUrl: 'https://example.com/',
        pages: [scanPage()],
        assets: [],
        technologies: [],
        responsiveCaptures: [],
        generatedAt: GENERATED_AT
      },
      { evidenceIo: evidenceIoFor({ 'evidence-p1.json': fixtureEvidence() }) }
    );

    // The complete validateBlueprint (not a partial parse) must accept it.
    const validated = validateBlueprint(result.blueprint);
    expect(validated.success).toBe(true);
    expect(result.validation.valid).toBe(true);

    // Landmarks, tokens, forms, and nav were all normalized from evidence.
    const names = result.blueprint.components.map((component) => component.name);
    expect(names).toContain('Header');
    expect(names).toContain('Navbar');
    expect(names).toContain('Footer');
    expect(result.blueprint.forms).toHaveLength(1);
    expect(result.blueprint.design_system.colors.primary).toBe('#0ea5e9');
    expect(result.blueprint.navigation.primary_menu.length).toBeGreaterThan(0);
    expect(result.blueprint.provenance?.evidence_summary?.pagesWithEvidence).toBe(1);
  });

  it('is deterministic: identical evidence yields an identical document', async () => {
    const request = {
      scanId: 's1',
      projectId: 'proj1',
      sourceUrl: 'https://example.com/',
      pages: [scanPage()],
      assets: [],
      technologies: [],
      responsiveCaptures: [],
      generatedAt: GENERATED_AT
    };
    const deps = { evidenceIo: evidenceIoFor({ 'evidence-p1.json': fixtureEvidence() }) };
    const first = await synthesizeBlueprint(request, deps);
    const second = await synthesizeBlueprint(request, deps);
    expect(JSON.stringify(first.blueprint)).toBe(JSON.stringify(second.blueprint));
  });

  it('skips a page with no readable evidence and never fabricates one', async () => {
    const result = await synthesizeBlueprint(
      {
        scanId: 's1',
        projectId: 'proj1',
        sourceUrl: 'https://example.com/',
        pages: [
          scanPage(),
          scanPage({
            id: 'p2',
            path: '/missing',
            url: 'https://example.com/missing',
            blueprintEvidencePath: 'v1/evidence-p2.json'
          })
        ],
        assets: [],
        technologies: [],
        responsiveCaptures: [],
        generatedAt: GENERATED_AT
      },
      { evidenceIo: evidenceIoFor({ 'evidence-p1.json': fixtureEvidence() }) }
    );
    expect(result.skippedPages.map((entry) => entry.pageId)).toEqual(['p2']);
    expect(result.provenanceSummary.pagesConsidered).toBe(2);
    expect(result.provenanceSummary.pagesWithEvidence).toBe(1);
    // The skipped page produces no page/route row.
    expect(result.blueprint.pages.map((page) => page.path)).toEqual(['/']);
    expect(validateBlueprint(result.blueprint).success).toBe(true);
  });

  it('handles a scan with no evidence at all as an empty-but-valid document', async () => {
    const result = await synthesizeBlueprint(
      {
        scanId: 's1',
        projectId: 'proj1',
        sourceUrl: 'https://example.com/',
        pages: [scanPage()],
        assets: [],
        technologies: [],
        responsiveCaptures: [],
        generatedAt: GENERATED_AT
      },
      {
        evidenceIo: {
          async read() {
            return null;
          }
        }
      }
    );
    expect(validateBlueprint(result.blueprint).success).toBe(true);
    expect(result.blueprint.pages).toEqual([]);
    expect(result.blueprint.components).toEqual([]);
    expect(result.blueprint.design_system.colors).toEqual({});
  });

  it('conflicting font stacks are both preserved, not silently dropped', async () => {
    const evidence = fixtureEvidence();
    evidence.nodes = evidence.nodes.map((node) =>
      node.id === 'n9'
        ? { ...node, styles: { ...node.styles, fontFamily: 'Playfair Display, serif' } }
        : node
    );
    const result = await synthesizeBlueprint(
      {
        scanId: 's1',
        projectId: 'proj1',
        sourceUrl: 'https://example.com/',
        pages: [scanPage()],
        assets: [],
        technologies: [],
        responsiveCaptures: [],
        generatedAt: GENERATED_AT
      },
      { evidenceIo: evidenceIoFor({ 'evidence-p1.json': evidence }) }
    );
    expect(result.blueprint.design_system.typography.font_sans).toEqual(
      expect.arrayContaining(['Inter', 'Playfair Display'])
    );
  });
});

describe('eligiblePages', () => {
  it('only considers completed pages', () => {
    const pages = [scanPage(), scanPage({ id: 'p2', status: 'failed' })];
    expect(eligiblePages(pages).map((page) => page.id)).toEqual(['p1']);
  });
});

describe('runBlueprint - read-only entrypoint', () => {
  it('resolves rows from the read store and returns a validated document', async () => {
    const store: BlueprintReadStore = {
      async listPages() {
        return [scanPage()];
      },
      async listAssets() {
        return [];
      },
      async listTechnologies() {
        return [];
      },
      async listResponsive() {
        return [];
      }
    };
    const result = await runBlueprint(
      { scanId: 's1', projectId: 'proj1', generatedAt: GENERATED_AT },
      { store, evidenceIo: evidenceIoFor({ 'evidence-p1.json': fixtureEvidence() }) }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.validation.valid).toBe(true);
      expect(result.data.blueprint.source_url).toBe('https://example.com/');
    }
  });

  it('reports an honest structured error when the scan has no pages', async () => {
    const store: BlueprintReadStore = {
      async listPages() {
        return [];
      },
      async listAssets() {
        return [];
      },
      async listTechnologies() {
        return [];
      },
      async listResponsive() {
        return [];
      }
    };
    const result = await runBlueprint({ scanId: 's1', projectId: 'proj1' }, { store });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('blueprint');
    }
  });
});
