import { describe, expect, it } from 'vitest';
import { detectTechnologies } from '../engine';
import { classifyConfidence, computeConfidence, isReportable } from '../confidence';
import { extractVersion, isPlausibleVersion, preferVersion } from '../version';
import { createEmptyTechEvidence, type PageTechEvidence } from '../../scanner/extraction/types';

function evidence(overrides: Partial<PageTechEvidence> = {}): PageTechEvidence {
  return { ...createEmptyTechEvidence(), ...overrides };
}

describe('confidence model', () => {
  it('combines weights with 1 - product(1 - w)', () => {
    // 1 - (1 - 0.5)(1 - 0.5) = 0.75
    expect(computeConfidence([0.5, 0.5])).toBe(0.75);
    expect(computeConfidence([1])).toBe(1);
    expect(computeConfidence([])).toBe(0);
  });

  it('classifies the documented bands', () => {
    expect(classifyConfidence(0.9)).toBe('detected');
    expect(classifyConfidence(0.75)).toBe('detected');
    expect(classifyConfidence(0.6)).toBe('probable');
    expect(classifyConfidence(0.5)).toBe('probable');
    expect(classifyConfidence(0.3)).toBe('unknown');
    expect(isReportable('unknown')).toBe(false);
    expect(isReportable('probable')).toBe(true);
  });
});

describe('version extraction', () => {
  it('extracts an exact version from evidence', () => {
    const result = extractVersion('WordPress 6.4.2', 'WordPress (?<version>\\d+\\.\\d+(?:\\.\\d+)?)');
    expect(result).toEqual({ version: '6.4.2', status: 'exact' });
  });

  it('returns unavailable when no pattern or capture is present', () => {
    expect(extractVersion('nope', undefined)).toEqual({ version: null, status: 'unavailable' });
    expect(extractVersion('nope', 'v(?<version>\\d+)')).toEqual({ version: null, status: 'unavailable' });
  });

  it('rejects implausible captures', () => {
    expect(isPlausibleVersion('1.2.3')).toBe(true);
    expect(isPlausibleVersion('1.2.3-beta.1')).toBe(true);
    expect(isPlausibleVersion('not-a-version')).toBe(false);
    expect(isPlausibleVersion('')).toBe(false);
  });

  it('prefers exact over major_only over unavailable', () => {
    const exact = { version: '1.2.3', status: 'exact' as const };
    const major = { version: '1', status: 'major_only' as const };
    const none = { version: null, status: 'unavailable' as const };
    expect(preferVersion(major, exact)).toBe(exact);
    expect(preferVersion(exact, none)).toBe(exact);
    expect(preferVersion(none, major)).toBe(major);
  });
});

describe('detectTechnologies', () => {
  it('detects Next.js from multiple signals with high confidence', () => {
    const report = detectTechnologies([
      {
        url: 'https://example.com/',
        tech: evidence({
          jsGlobals: { __NEXT_DATA__: true },
          scriptSrcs: ['https://example.com/_next/static/chunks/main.js'],
          metaTags: { 'next-head-count': '3' }
        })
      }
    ]);
    const next = report.technologies.find((tech) => tech.technologyId === 'nextjs');
    expect(next).toBeDefined();
    expect(next!.confidenceStatus).toBe('detected');
    expect(next!.confidence).toBeGreaterThanOrEqual(0.75);
    expect(next!.pages).toContain('https://example.com/');
  });

  it('detects React and Tailwind together from one page', () => {
    const report = detectTechnologies([
      {
        url: 'https://example.com/',
        tech: evidence({
          jsGlobals: { React: true },
          htmlSnippet:
            '<div class="flex min-h-screen sm:flex-col" data-reactroot=""></div>'
        })
      }
    ]);
    const ids = report.technologies.map((tech) => tech.technologyId);
    expect(ids).toContain('react');
    expect(ids).toContain('tailwind-css');
  });

  it('detects Cloudflare from headers', () => {
    const report = detectTechnologies([
      { url: 'https://example.com/', tech: evidence({ responseHeaders: { 'cf-ray': 'abc123', server: 'cloudflare' } }) }
    ]);
    expect(report.technologies.map((tech) => tech.technologyId)).toContain('cloudflare');
  });

  it('extracts a version from a meta generator tag', () => {
    const report = detectTechnologies([
      {
        url: 'https://example.com/',
        tech: evidence({
          metaTags: { generator: 'WordPress 6.4.2' },
          scriptSrcs: ['https://example.com/wp-content/themes/x/style.css']
        })
      }
    ]);
    const wp = report.technologies.find((tech) => tech.technologyId === 'wordpress');
    expect(wp?.version).toBe('6.4.2');
    expect(wp?.versionStatus).toBe('exact');
  });

  it('reports version unavailable honestly when no pattern matches', () => {
    const report = detectTechnologies([
      { url: 'https://example.com/', tech: evidence({ jsGlobals: { __NEXT_DATA__: true } }) }
    ]);
    const next = report.technologies.find((tech) => tech.technologyId === 'nextjs');
    expect(next?.version).toBeNull();
    expect(next?.versionStatus).toBe('unavailable');
    expect(next?.limitation).toContain('version');
  });

  it('produces no detections for a page with no matching evidence (negative case)', () => {
    const report = detectTechnologies([
      {
        url: 'https://example.com/',
        tech: evidence({
          responseHeaders: { 'content-type': 'text/html' },
          htmlSnippet: '<html><body><p>Hello world</p></body></html>'
        })
      }
    ]);
    expect(report.technologies).toHaveLength(0);
    expect(report.pagesWithEvidence).toBe(0);
  });

  it('never presents a weak single-signal match as confirmed', () => {
    // A lone generic `flex` class is a weak signal: it may be reported as
    // Probable at most, and never as Detected (no overmatching).
    const report = detectTechnologies([
      { url: 'https://example.com/', tech: evidence({ htmlSnippet: '<div class="flex"></div>' }) }
    ]);
    const tailwind = report.technologies.find((tech) => tech.technologyId === 'tailwind-css');
    expect(tailwind?.confidenceStatus).not.toBe('detected');
  });

  it('dedupes repeated signals and unions evidence across pages', () => {
    const report = detectTechnologies([
      {
        url: 'https://example.com/a',
        tech: evidence({ jsGlobals: { __NEXT_DATA__: true }, scriptSrcs: ['https://example.com/_next/static/a.js'] })
      },
      {
        url: 'https://example.com/b',
        tech: evidence({ metaTags: { 'next-head-count': '2' } })
      }
    ]);
    const next = report.technologies.find((tech) => tech.technologyId === 'nextjs');
    expect(next?.pages.sort()).toEqual(['https://example.com/a', 'https://example.com/b']);
    // Distinct signal keys: jsGlobals, scriptSrc, meta -> three matches.
    expect(next!.matchedSignals.length).toBe(3);
  });

  it('is deterministic for identical input', () => {
    const input = [
      {
        url: 'https://example.com/',
        tech: evidence({ jsGlobals: { React: true }, htmlSnippet: '<div data-reactroot=""></div>' })
      }
    ];
    const first = detectTechnologies(input);
    const second = detectTechnologies(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('handles oversized evidence by flagging truncation', () => {
    const big = 'x'.repeat(9000);
    const report = detectTechnologies([
      { url: 'https://example.com/', tech: evidence({ htmlSnippet: big }) }
    ]);
    expect(report.truncatedEvidence).toBe(true);
  });

  it('handles malformed/empty evidence safely', () => {
    const report = detectTechnologies([{ url: 'https://example.com/' }]);
    expect(report.technologies).toHaveLength(0);
    expect(report.pagesConsidered).toBe(1);
  });

  it('does not force a single identification when evidence is ambiguous', () => {
    // `x-powered-by` matching several server rules keeps them as distinct rows
    // rather than collapsing them into one.
    const report = detectTechnologies([
      { url: 'https://example.com/', tech: evidence({ responseHeaders: { 'x-powered-by': 'Next.js 14.2.1' } }) }
    ]);
    const ids = report.technologies.map((tech) => tech.technologyId);
    expect(ids).toContain('nextjs-server');
    expect(ids.length).toBeGreaterThan(1);
  });
});
