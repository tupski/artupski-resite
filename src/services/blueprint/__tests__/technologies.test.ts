/**
 * Technology projection tests - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md section 11.
 */
import { describe, expect, it } from 'vitest';
import type { ScanTechnology } from '../../../types/models';
import { buildTechnologies } from '../technologies';
import { buildAssets } from '../assets';
import { buildContent } from '../content';
import type { CloneAsset } from '../../../types/models';
import { fixtureEvidence, model } from './fixtures';
import type { ScanPage } from '../../../types/models';

function technology(overrides: Partial<ScanTechnology> = {}): ScanTechnology {
  return {
    id: 't1',
    scanId: 's1',
    technologyId: 'nextjs',
    category: 'Frontend Framework',
    name: 'Next.js',
    version: '14.2.3',
    confidenceStatus: 'detected',
    confidence: 0.98,
    versionStatus: 'exact',
    detectionSource: 'headers',
    evidence: [],
    pages: [],
    limitation: null,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('buildTechnologies', () => {
  it('projects detected technologies into the spec buckets by category', () => {
    const result = buildTechnologies([
      technology(),
      technology({
        id: 't2',
        technologyId: 'tailwind',
        category: 'CSS Framework & Component UI',
        name: 'Tailwind CSS',
        confidence: 0.95,
        confidenceStatus: 'detected'
      }),
      technology({
        id: 't3',
        technologyId: 'node',
        category: 'Backend Framework & Server',
        name: 'Node.js',
        confidence: 0.85,
        confidenceStatus: 'probable'
      })
    ]);
    expect(result.technologies.frontend_framework?.name).toBe('Next.js');
    expect(result.technologies.ui_libraries?.[0]?.name).toBe('Tailwind CSS');
    expect(result.technologies.runtime?.name).toBe('Node.js');
    expect(result.detectedCount).toBe(3);
  });

  it('omits unknown-confidence candidates (matching the engine suppression)', () => {
    const result = buildTechnologies([
      technology({ confidenceStatus: 'unknown', confidence: 0.3 })
    ]);
    expect(result.technologies.frontend_framework).toBeUndefined();
    expect(result.detectedCount).toBe(0);
  });

  it('records an honest limitation for a category with no spec bucket', () => {
    const result = buildTechnologies([
      technology({ technologyId: 'wp', category: 'CMS', name: 'WordPress' })
    ]);
    expect(result.omittedCategories).toContain('CMS');
    expect(result.technologies.frontend_framework).toBeUndefined();
  });

  it('extracts an analytics container id from evidence when present', () => {
    const result = buildTechnologies([
      technology({
        technologyId: 'ga4',
        category: 'Analytics & Tracking',
        name: 'Google Analytics 4',
        evidence: [
          {
            vector: 'scriptSrc',
            evidence: 'https://www.googletagmanager.com/gtag/js?id=G-ABC123',
            weight: 1
          }
        ]
      })
    ]);
    expect(result.technologies.analytics?.[0]?.id).toBe('G-ABC123');
  });

  it('returns an empty technologies object when nothing was detected', () => {
    expect(buildTechnologies([]).technologies).toEqual({});
  });
});

function asset(overrides: Partial<CloneAsset> = {}): CloneAsset {
  return {
    id: 'a1',
    scanId: 's1',
    pageId: null,
    pageUrl: null,
    sourceUrl: 'https://example.com/assets/logo.svg',
    localPath: 'assets/logo.svg',
    mimeType: 'image/svg+xml',
    sizeBytes: 100,
    sha256: 'abc123',
    assetType: 'image',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('buildAssets', () => {
  it('projects image assets with real sha256 + local path', () => {
    const result = buildAssets({ assets: [asset()], models: [] });
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.sha256).toBe('abc123');
    expect(result.images[0]?.local_path).toBe('assets/logo.svg');
    // An SVG image also becomes an inline_svg icon.
    expect(result.icons[0]?.type).toBe('inline_svg');
  });

  it('builds fonts from observed @font-face declarations', () => {
    const result = buildAssets({ assets: [], models: [model(fixtureEvidence())] });
    const inter = result.fonts.find((font) => font.family === 'Inter');
    expect(inter?.weights).toEqual([400, 600]);
  });

  it('returns empty arrays when no assets were captured', () => {
    expect(buildAssets({ assets: [], models: [] })).toEqual({ images: [], icons: [], fonts: [] });
  });
});

function contentPage(): ScanPage {
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
    blueprintEvidencePath: null
  };
}

describe('buildContent', () => {
  it('builds deterministic page.section.field strings from observed headings', () => {
    const content = buildContent([{ page: contentPage(), model: model(fixtureEvidence()) }]);
    const keys = Object.keys(content.strings);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.includes('.'))).toBe(true);
    expect(Object.values(content.strings)).toContain('Build applications at lightning speed');
  });

  it('returns empty content when there are no pages', () => {
    expect(buildContent([])).toEqual({ strings: {}, blocks: [] });
  });
});
