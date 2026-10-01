import { describe, expect, it } from 'vitest';
import { normalizeExtraction, buildUnavailablePage } from './normalize';
import { EXTRACTION_LIMITS } from './limits';
import { createCrawlScope } from '../crawlScope';
import { createEmptyTechEvidence, type PageExtraction } from './types';

const scope = createCrawlScope('https://example.com/')!;

function rawEvidence(overrides: Partial<PageExtraction> = {}): PageExtraction {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    title: 'Home',
    loginSignals: { hasPasswordField: false, hasCaptcha: false },
    metaDescription: 'A description',
    canonicalUrl: '/canonical',
    robotsMeta: 'index,follow',
    headings: [{ level: 1, text: 'Home' }],
    links: [],
    images: [],
    metrics: { loadTimeMs: 12, domContentLoadedTimeMs: 8, domNodeCount: 42 },
    tech: createEmptyTechEvidence(),
    warnings: [],
    ...overrides
  };
}

describe('normalizeExtraction', () => {
  it('normalizes core metadata', () => {
    const page = normalizeExtraction(rawEvidence(), { scope, capturedAt: '2026-01-01T00:00:00.000Z' });
    expect(page.title).toBe('Home');
    expect(page.httpStatus).toBe(200);
    expect(page.canonicalUrl).toBe('https://example.com/canonical');
    expect(page.capturedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(page.status).toBe('completed');
  });

  it('classifies internal and external links and dedupes them', () => {
    const page = normalizeExtraction(
      rawEvidence({
        links: [
          'https://example.com/a',
          '/a',
          'https://external.example.com/x',
          'mailto:hello@example.com'
        ]
      }),
      { scope }
    );
    expect(page.internalLinks).toEqual(['https://example.com/a']);
    expect(page.externalLinks).toEqual(['https://external.example.com/x']);
  });

  it('classifies images as internal or external with alt text', () => {
    const page = normalizeExtraction(
      rawEvidence({
        images: [
          { src: '/logo.svg', alt: 'Logo' },
          { src: 'https://cdn.example.com/p.png', alt: '' }
        ]
      }),
      { scope }
    );
    expect(page.images).toHaveLength(2);
    expect(page.images[0]).toEqual({ src: 'https://example.com/logo.svg', alt: 'Logo', internal: true });
    expect(page.images[1]?.internal).toBe(false);
  });

  it('caps field and collection sizes', () => {
    const longTitle = 'x'.repeat(EXTRACTION_LIMITS.maxTextFieldLength + 100);
    const manyLinks = Array.from({ length: EXTRACTION_LIMITS.maxLinks + 50 }, (_, i) => `/p${i}`);
    const page = normalizeExtraction(rawEvidence({ title: longTitle, links: manyLinks }), { scope });
    expect(page.title.length).toBe(EXTRACTION_LIMITS.maxTextFieldLength);
    expect(page.internalLinks.length).toBeLessThanOrEqual(EXTRACTION_LIMITS.maxLinks);
  });

  it('turns missing metadata into nulls', () => {
    const page = normalizeExtraction(
      rawEvidence({ title: '   ', metaDescription: null, canonicalUrl: null, robotsMeta: null, headings: [] }),
      { scope }
    );
    expect(page.title).toBe('');
    expect(page.metaDescription).toBeNull();
    expect(page.canonicalUrl).toBeNull();
    expect(page.robotsMeta).toBeNull();
    expect(page.headings).toEqual([]);
  });

  it('clamps heading levels and drops empty headings', () => {
    const page = normalizeExtraction(
      rawEvidence({
        headings: [
          { level: 0, text: 'A' },
          { level: 9, text: 'B' },
          { level: 2, text: '   ' }
        ]
      }),
      { scope }
    );
    expect(page.headings).toEqual([
      { level: 1, text: 'A' },
      { level: 6, text: 'B' }
    ]);
  });
});

describe('buildUnavailablePage', () => {
  it('produces a bounded failure result with no raw evidence', () => {
    const page = buildUnavailablePage('https://example.com/missing', {
      scope,
      status: 'failed',
      errorCode: 'CONNECTION_TIMED_OUT',
      errorMessage: 'Timed out'
    });
    expect(page.status).toBe('failed');
    expect(page.errorCode).toBe('CONNECTION_TIMED_OUT');
    expect(page.internalLinks).toEqual([]);
    expect(page.images).toEqual([]);
  });
});
