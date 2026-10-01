import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_EXTRACTOR_EXPRESSION } from './inPageExtractor';
import { extractPageEvidence, type ExtractablePage } from '../../../workers/crawler/extraction';

/**
 * Evaluate the self-contained extractor against the jsdom document, exactly as
 * Playwright would inside a real page. This proves the extractor is
 * self-contained (no closure over host variables) without a browser binary.
 */
function runExtractorInDom(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return ${PAGE_EXTRACTOR_EXPRESSION}`)();
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.title = '';
});

describe('in-page extractor', () => {
  it('extracts title, meta, headings, links, and images', () => {
    document.head.innerHTML = `
      <title>Fixture Page</title>
      <meta name="description" content="A fixture description" />
      <meta name="robots" content="noindex" />
      <link rel="canonical" href="/canonical" />
    `;
    document.body.innerHTML = `
      <h1>Main Title</h1>
      <h2>Subtitle</h2>
      <a href="/a">A</a>
      <a href="https://external.example.com/x">X</a>
      <img src="/logo.svg" alt="Logo" />
    `;

    const result = runExtractorInDom() as {
      title: string;
      metaDescription: string | null;
      canonicalUrl: string | null;
      robotsMeta: string | null;
      headings: Array<{ level: number; text: string }>;
      links: string[];
      images: Array<{ src: string; alt: string }>;
      warnings: string[];
    };

    expect(result.title).toBe('Fixture Page');
    expect(result.metaDescription).toBe('A fixture description');
    expect(result.canonicalUrl).toBe('/canonical');
    expect(result.robotsMeta).toBe('noindex');
    expect(result.headings).toEqual([
      { level: 1, text: 'Main Title' },
      { level: 2, text: 'Subtitle' }
    ]);
    expect(result.links).toEqual(['/a', 'https://external.example.com/x']);
    expect(result.images).toEqual([{ src: '/logo.svg', alt: 'Logo' }]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when title and headings are missing', () => {
    document.body.innerHTML = '<p>No headings here</p>';
    const result = runExtractorInDom() as { warnings: string[] };
    expect(result.warnings).toContain('missing_title');
    expect(result.warnings).toContain('missing_headings');
  });
});

describe('extractPageEvidence coercion', () => {
  it('coerces malformed extractor output defensively', async () => {
    const page: ExtractablePage = {
      evaluate<T>(): Promise<T> {
        return Promise.resolve({
          title: 123,
          headings: [{ level: 'x', text: 5 }, { level: 2, text: 'ok' }],
          links: ['/a', 42, null],
          images: [{ src: '/x', alt: 7 }, 'bad'],
          metrics: { loadTimeMs: 'slow', domContentLoadedTimeMs: 3, domNodeCount: 1 },
          warnings: ['w', 9]
        } as unknown as T);
      }
    };
    const evidence = await extractPageEvidence(page, {
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      httpStatus: 200
    });
    expect(evidence.title).toBe('');
    expect(evidence.headings).toEqual([{ level: 2, text: 'ok' }]);
    expect(evidence.links).toEqual(['/a']);
    expect(evidence.images).toEqual([{ src: '/x', alt: '' }]);
    expect(evidence.metrics.loadTimeMs).toBe(0);
    expect(evidence.metrics.domNodeCount).toBe(1);
    expect(evidence.warnings).toEqual(['w']);
  });
});
