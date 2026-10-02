/**
 * Phase 12 failure-isolation suites - Artupski ReSite
 *
 * A malformed component, an unwritable target, an invalid Blueprint, and an
 * aborted run must all be reported honestly. The generator must never silently
 * produce an incomplete project labelled runnable, and must never corrupt
 * existing data outside its target root.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateProject } from '../projectGenerator';
import { phase12Blueprint, synthesizedComponent } from './projectFixtures';

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'resite-fail-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('generateProject failure isolation', () => {
  it('never throws when the target root is inside a file (io error)', async () => {
    const root = await makeRoot();
    const blocker = join(root, 'blocker');
    await fs.writeFile(blocker, 'not a directory');

    const report = await generateProject(
      {},
      { blueprint: phase12Blueprint(), components: [], targetRoot: join(blocker, 'project') }
    );

    expect(report.ok).toBe(false);
    expect(report.error).toBeDefined();
    // The blocker file is untouched.
    await expect(fs.readFile(blocker, 'utf8')).resolves.toBe('not a directory');
  });

  it('does not write anything when the Blueprint is invalid', async () => {
    const root = await makeRoot();
    const report = await generateProject({}, { blueprint: 42, components: [], targetRoot: root });
    expect(report.ok).toBe(false);
    expect(report.files).toEqual([]);
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('marks the run partial (never fully successful) when a component is skipped', async () => {
    const root = await makeRoot();
    const bad = synthesizedComponent({
      componentId: 'cmp_bad',
      name: 'Bad-Name',
      fileName: 'Bad.tsx'
    });
    const report = await generateProject(
      {},
      { blueprint: phase12Blueprint(), components: [synthesizedComponent(), bad], targetRoot: root }
    );

    expect(report.ok).toBe(true);
    expect(report.summary.partial).toBe(true);
    expect(report.skipped.length).toBeGreaterThan(0);
  });

  it('removes the partial root on abort by default', async () => {
    const root = await makeRoot();
    const controller = new AbortController();
    let writes = 0;
    const report = await generateProject(
      {
        events: {
          emit: (event) => {
            if (event.type === 'project.file_generated') {
              writes += 1;
              controller.abort();
            }
          }
        }
      },
      {
        blueprint: phase12Blueprint(),
        components: [],
        targetRoot: root,
        options: { signal: controller.signal }
      }
    );

    expect(report.summary.aborted).toBe(true);
    expect(writes).toBeGreaterThan(0);
    // Default: the partial root is removed so it cannot be mistaken for complete.
    const exists = await fs
      .readdir(root)
      .then(() => true)
      .catch(() => false);
    expect(exists ? await fs.readdir(root) : []).toEqual([]);
  });

  it('keeps the partial root when keepPartial is set', async () => {
    const root = await makeRoot();
    const controller = new AbortController();
    const report = await generateProject(
      {
        events: {
          emit: (event) => {
            if (event.type === 'project.file_generated') {
              controller.abort();
            }
          }
        }
      },
      {
        blueprint: phase12Blueprint(),
        components: [],
        targetRoot: root,
        options: { signal: controller.signal, keepPartial: true }
      }
    );

    expect(report.summary.aborted).toBe(true);
    const entries = await fs.readdir(root);
    expect(entries.length).toBeGreaterThan(0);
  });
});
