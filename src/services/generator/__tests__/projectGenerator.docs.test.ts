/**
 * Project generator documentation suites - Artupski ReSite
 *
 * Verifies that generated blueprint documentation files are written at the
 * project root with a safe, single-segment name, and that a hostile name cannot
 * escape the target root. Uses a real temp directory; no network.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateProject } from '../projectGenerator';
import { phase12Blueprint, synthesizedComponent } from './projectFixtures';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'resite-docs-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('generateProject documentation', () => {
  it('writes generated docs at the project root', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent()],
        docs: [
          { name: 'AGENTS.md', contents: '# AGENTS\n\nGuidance.\n' },
          { name: 'PRD.md', contents: '# PRD\n\nRequirements.\n' }
        ],
        targetRoot: root
      }
    );

    expect(report.ok).toBe(true);
    expect(report.files).toContain('AGENTS.md');
    expect(report.files).toContain('PRD.md');
    const agents = await fs.readFile(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Guidance.');
  });

  it('neutralizes a doc name that tries to traverse the root', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent()],
        docs: [{ name: '../evil.md', contents: 'x' }],
        targetRoot: root
      }
    );

    expect(report.ok).toBe(true);
    // The traversal is collapsed to a safe root-level segment.
    expect(report.files).toContain('EVIL.md');
    await expect(fs.readFile(join(root, '..', 'evil.md'), 'utf8')).rejects.toThrow();
  });

  it('de-duplicates colliding doc names deterministically', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent()],
        docs: [
          { name: 'PRD.md', contents: 'first' },
          { name: 'prd.md', contents: 'second' }
        ],
        targetRoot: root
      }
    );

    expect(report.ok).toBe(true);
    expect(report.files.filter((path) => path.toUpperCase() === 'PRD.MD')).toHaveLength(1);
  });
});
