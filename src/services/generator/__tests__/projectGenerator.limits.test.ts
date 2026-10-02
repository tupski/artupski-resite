/**
 * Phase 12 resource-limit suites - Artupski ReSite
 *
 * Verifies the bounded-resource contract: excessive file counts, oversized
 * single files, and excessive total output are all rejected, and nothing is
 * written when a limit is breached (validation precedes emission).
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateProject } from '../projectGenerator';
import { phase12Blueprint, synthesizedComponent } from './projectFixtures';

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'resite-limits-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('generateProject resource limits', () => {
  it('rejects excessive file counts before writing', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [],
        targetRoot: root,
        options: { maxFiles: 3 }
      }
    );

    expect(report.ok).toBe(false);
    expect(report.error?.code).toBe('FILE_COUNT_LIMIT_EXCEEDED');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('rejects an oversized single file before writing', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [],
        targetRoot: root,
        options: { maxFileBytes: 16 }
      }
    );

    expect(report.ok).toBe(false);
    expect(report.error?.code).toBe('FILE_SIZE_LIMIT_EXCEEDED');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('rejects excessive total output before writing', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent()],
        targetRoot: root,
        options: { maxTotalBytes: 100 }
      }
    );

    expect(report.ok).toBe(false);
    expect(report.error?.code).toBe('TOTAL_SIZE_LIMIT_EXCEEDED');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('caps the number of assembled components and records the breach', async () => {
    const root = await makeRoot();
    const base = synthesizedComponent();
    const components = Array.from({ length: 5 }, (_, index) =>
      synthesizedComponent({
        componentId: `cmp_${index}`,
        name: `Comp${index}`,
        fileName: `Comp${index}.tsx`,
        code: base.code
      })
    );

    const report = await generateProject(
      {},
      { blueprint: phase12Blueprint(), components, targetRoot: root, options: { maxComponents: 2 } }
    );

    expect(report.ok).toBe(true);
    expect(report.summary.componentsWritten).toBe(2);
    expect(report.skipped.some((failure) => failure.code === 'COMPONENT_LIMIT_EXCEEDED')).toBe(
      true
    );
  });
});
