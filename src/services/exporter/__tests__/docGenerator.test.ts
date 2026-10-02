/**
 * Phase 14 documentation generator suites - Artupski ReSite
 *
 * Covers the three-document set, heading structure, Markdown validity (single
 * H1, balanced fences, well-formed tables), no-fabrication (only real report
 * entries appear), determinism, text neutralization, and the size-cap refusal.
 * Pure: no filesystem, no network.
 */
import { describe, expect, it } from 'vitest';
import { generateDocs } from '../docGenerator';
import { sampleReport } from './exportFixtures';

function baseInput() {
  return {
    projectName: 'Acme SaaS Platform',
    targetFramework: 'Vite + React + TypeScript + Tailwind',
    targetUrl: 'https://example.com',
    description: 'A generated project.',
    report: sampleReport()
  };
}

/** Count fenced-code-block delimiters (a balanced doc has an even count). */
function fenceCount(markdown: string): number {
  return markdown.split('\n').filter((line) => line.trimStart().startsWith('```')).length;
}

/** Every table block must have a separator row immediately after its header. */
function tablesAreWellFormed(markdown: string): boolean {
  const lines = markdown.split('\n');
  const isRow = (line: string | undefined): boolean => line !== undefined && line.startsWith('| ');
  const isSeparator = (line: string | undefined): boolean =>
    line !== undefined && /^\|\s*:?-{3,}/.test(line);
  for (let i = 0; i < lines.length; i += 1) {
    // A table header is a row whose previous line is NOT a row (block start).
    if (isRow(lines[i]) && !isRow(lines[i - 1])) {
      if (!isSeparator(lines[i + 1])) {
        return false;
      }
    }
  }
  return true;
}

describe('generateDocs structure', () => {
  it('emits exactly the three mandated documents', () => {
    const result = generateDocs(baseInput());
    expect(result.ok).toBe(true);
    expect(result.docs.map((doc) => doc.name)).toEqual([
      'README.md',
      'ARCHITECTURE.md',
      'COMPONENTS.md'
    ]);
    expect(result.skipped).toEqual([]);
    for (const doc of result.docs) {
      expect(doc.bytes).toBeGreaterThan(0);
      expect(doc.contents).toContain('#');
    }
  });

  it('emits valid Markdown (single H1, balanced fences, well-formed tables)', () => {
    const result = generateDocs(baseInput());
    for (const doc of result.docs) {
      const h1Count = doc.contents.split('\n').filter((line) => /^# \S/.test(line)).length;
      expect(h1Count).toBe(1);
      expect(fenceCount(doc.contents) % 2).toBe(0);
      expect(tablesAreWellFormed(doc.contents)).toBe(true);
    }
  });

  it('references only real report entries (no fabrication)', () => {
    const report = sampleReport();
    const result = generateDocs({ ...baseInput(), report });
    const combined = result.docs.map((doc) => doc.contents).join('\n');

    for (const route of report.routes) {
      expect(combined).toContain(route.path);
      expect(combined).toContain(route.component);
    }
    for (const component of report.components) {
      expect(combined).toContain(component.name);
    }
    for (const asset of report.assets) {
      expect(combined).toContain(asset.id);
    }
    expect(combined).not.toContain('FabricatedComponent');
  });

  it('omits sections whose report data is absent', () => {
    const emptyReport = sampleReport({
      routes: [],
      droppedRoutes: [],
      components: [],
      assets: [],
      files: ['package.json']
    });
    const result = generateDocs({ ...baseInput(), report: emptyReport });
    expect(result.ok).toBe(true);
    const readme = result.docs.find((doc) => doc.name === 'README.md')!;
    expect(readme.contents).not.toContain('## Routes');
    expect(readme.contents).not.toContain('## Components');
    const components = result.docs.find((doc) => doc.name === 'COMPONENTS.md')!;
    expect(components.contents).toContain('No components were generated.');
  });

  it('notes dropped routes honestly in ARCHITECTURE.md', () => {
    const result = generateDocs(baseInput());
    const architecture = result.docs.find((doc) => doc.name === 'ARCHITECTURE.md')!;
    expect(architecture.contents).toContain('/missing');
    expect(architecture.contents).toContain('missing_page');
  });

  it('is deterministic across calls', () => {
    const first = generateDocs(baseInput());
    const second = generateDocs(baseInput());
    expect(second.docs.map((doc) => doc.contents)).toEqual(first.docs.map((doc) => doc.contents));
  });
});

describe('generateDocs text neutralization', () => {
  it('neutralizes a leading # in the project name so it cannot start a heading', () => {
    const result = generateDocs({ ...baseInput(), projectName: '#evil' });
    const readme = result.docs.find((doc) => doc.name === 'README.md')!;
    const firstLine = readme.contents.split('\n')[0]!;
    expect(firstLine).toBe('# \\#evil');
  });

  it('escapes pipes inside table cells', () => {
    const report = sampleReport({
      components: [{ name: 'A|B', path: 'src/components/AB.tsx' }]
    });
    const result = generateDocs({ ...baseInput(), report });
    const combined = result.docs.map((doc) => doc.contents).join('\n');
    expect(combined).toContain('\\|');
    // The escaped pipe must not split a row into an extra cell.
    for (const doc of result.docs) {
      expect(tablesAreWellFormed(doc.contents)).toBe(true);
    }
  });

  it('handles backticks in names with a safe code span', () => {
    const report = sampleReport({
      components: [{ name: 'Tick`Tock', path: 'src/components/Tick.tsx' }]
    });
    const result = generateDocs({ ...baseInput(), report });
    const components = result.docs.find((doc) => doc.name === 'COMPONENTS.md')!;
    expect(fenceCount(components.contents) % 2).toBe(0);
    expect(components.contents).toContain('Tick`Tock');
  });
});

describe('generateDocs size cap', () => {
  it('refuses a document over MAX_EXPORT_DOC_BYTES', () => {
    const hugeName = 'x'.repeat(1024 * 1024 + 1);
    const result = generateDocs({ ...baseInput(), projectName: hugeName });
    expect(result.ok).toBe(false);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped[0]!.code).toBe('EXPORT_DOC_TOO_LARGE');
    expect(result.error).toBeDefined();
    for (const doc of result.docs) {
      expect(doc.bytes).toBeLessThanOrEqual(1024 * 1024);
    }
  });
});
