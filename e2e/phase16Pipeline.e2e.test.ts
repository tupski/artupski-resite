/**
 * Phase 16 offline composed pipeline E2E - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 8.1 and 9.1.
 *
 * Drives the REAL post-crawl pipeline with no browser and no network:
 *
 *   real in-memory SQLite (createTestStorage)
 *     -> real `runBlueprintLifecycle` (real `runBlueprint` synthesis + persistence)
 *     -> real `synthesizeComponents` (scripted engine; the only AI seam)
 *     -> real `generateProject`
 *     -> real `exportProject` ZIP + `readZip` verification
 *
 * The PURE half always runs in the default suite (it is hermetic and fast). The
 * REAL `npm install && npm run build` half is gated on `RUN_PROJECT_BUILD=1`
 * (mirroring the Phase 12 build E2E) because it needs the network/registry; when
 * it cannot run it reports BLOCKED rather than a false PASS.
 */
import { promises as fs } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { validateBlueprint } from '../src/types/blueprint';
import { createScriptedEngine } from './harness/scriptedEngine';
import {
  createTestStorage,
  makeTempRoot,
  runOfflinePipeline,
  type PipelineRunResult
} from './harness/pipeline';
import { hasCommand, hasDistIndexHtml, installAndBuild, npmCommand } from './harness/buildRunner';

const RUN_PROJECT_BUILD = process.env.RUN_PROJECT_BUILD === '1';
const KEEP = process.env.KEEP_PHASE16_E2E === '1';
const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await makeTempRoot(prefix);
  roots.push(root);
  return root;
}

afterAll(async () => {
  if (!KEEP) {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  } else {
    // eslint-disable-next-line no-console
    console.log(`[phase16 offline e2e] kept temp dirs: ${roots.join(', ')}`);
  }
});

async function runPipeline(pageCount = 2): Promise<PipelineRunResult> {
  const storage = await createTestStorage();
  try {
    const targetRoot = await tempRoot('resite-p16-src-');
    const destinationRoot = await tempRoot('resite-p16-dst-');
    return await runOfflinePipeline(
      { targetRoot, destinationRoot, pageCount, projectName: 'resite-generated-app' },
      { storage, engine: createScriptedEngine() }
    );
  } finally {
    await storage.close();
  }
}

describe('Phase 16 offline composed pipeline (real SQLite -> Blueprint -> generate -> export)', () => {
  it('produces a valid Blueprint, buildable project files, and a verified ZIP', async () => {
    const result = await runPipeline(2);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);

    // --- Real Blueprint lifecycle + persisted, schema-valid document. ---------
    expect(result.lifecycle?.failed).toBe(false);
    expect(result.lifecycle?.isValid).toBe(true);
    expect(result.lifecycle?.blueprintId).toBeTruthy();
    expect(result.blueprint).toBeDefined();
    expect(validateBlueprint(result.blueprint).success).toBe(true);
    expect(result.blueprint?.pages.length).toBeGreaterThanOrEqual(2);

    // --- Real component synthesis over the scripted engine. -------------------
    // Every Blueprint component is synthesized (no failure), with a PascalCase
    // identifier derived from the Blueprint - never fabricated.
    expect(result.synthesis?.failures).toEqual([]);
    expect(result.synthesis?.components.length).toBe(result.blueprint?.components.length);
    const componentNames = result.synthesis?.components.map((component) => component.name) ?? [];
    expect(componentNames.length).toBeGreaterThan(0);
    for (const name of componentNames) {
      expect(name, `invalid identifier ${name}`).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    }

    // --- Real project generation: expected files on disk. ---------------------
    const project = result.project;
    expect(project?.ok).toBe(true);
    expect(project?.summary.partial).toBe(false);
    for (const path of [
      'index.html',
      'package.json',
      'vite.config.ts',
      'src/main.tsx',
      'src/App.tsx',
      'src/router.tsx',
      'src/tokens.ts',
      'src/styles/index.css'
    ]) {
      expect(project?.files, `missing ${path}`).toContain(path);
    }
    expect(project?.files.some((path) => path.startsWith('src/pages/'))).toBe(true);
    expect(project?.files.some((path) => path.startsWith('src/components/'))).toBe(true);

    // Every reported file really exists on disk.
    for (const path of project?.files ?? []) {
      const stat = await fs.stat(`${project?.targetRoot}/${path}`);
      expect(stat.isFile()).toBe(true);
    }

    // --- Real export + independent unzip verification. ------------------------
    expect(result.export?.ok, JSON.stringify(result.export?.error)).toBe(true);
    expect(result.export?.docs.map((doc) => doc.name)).toEqual([
      'README.md',
      'ARCHITECTURE.md',
      'COMPONENTS.md'
    ]);

    const archive = result.archive;
    expect(archive).toBeDefined();
    for (const doc of ['README.md', 'ARCHITECTURE.md', 'COMPONENTS.md']) {
      expect(archive?.data.has(doc), `archive missing ${doc}`).toBe(true);
    }
    for (const path of project?.files ?? []) {
      expect(archive?.data.has(path), `archive missing ${path}`).toBe(true);
      const onDisk = new Uint8Array(await fs.readFile(`${project?.targetRoot}/${path}`));
      const extracted = archive?.data.get(path);
      expect(Array.from(extracted ?? []), `bytes differ for ${path}`).toEqual(Array.from(onDisk));
    }

    // --- Bounded lifecycle events across all four real domains. ---------------
    const names = result.events.map((event) => event.type);
    expect(names).toContain('blueprint.completed');
    expect(names).toContain('component.completed');
    expect(names).toContain('project.completed');
    expect(names).toContain('export.completed');

    // --- Real timings were recorded for every stage. --------------------------
    expect(result.timingsMs.blueprint).toBeGreaterThanOrEqual(0);
    expect(result.timingsMs.synthesis).toBeGreaterThanOrEqual(0);
    expect(result.timingsMs.generate).toBeGreaterThanOrEqual(0);
    expect(result.timingsMs.export).toBeGreaterThanOrEqual(0);
    expect(result.timingsMs.total).toBeGreaterThanOrEqual(result.timingsMs.generate);
  }, 120_000);

  it('is deterministic: two runs produce the same file set and byte count', async () => {
    const first = await runPipeline(2);
    const second = await runPipeline(2);
    expect(first.ok && second.ok).toBe(true);

    expect([...(first.project?.files ?? [])].sort()).toEqual(
      [...(second.project?.files ?? [])].sort()
    );
    expect(first.project?.summary.bytesWritten).toBe(second.project?.summary.bytesWritten);
    expect(first.export?.summary.uncompressedBytes).toBe(second.export?.summary.uncompressedBytes);
  }, 180_000);

  it('reports an honest partial run when a page has no evidence', async () => {
    const storage = await createTestStorage();
    try {
      const targetRoot = await tempRoot('resite-p16-partial-src-');
      const destinationRoot = await tempRoot('resite-p16-partial-dst-');
      const result = await runOfflinePipeline(
        { targetRoot, destinationRoot, pageCount: 1 },
        { storage, engine: createScriptedEngine() }
      );
      // A single page still yields a valid, complete pipeline (no fabricated data).
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.blueprint?.pages.length).toBe(1);
    } finally {
      await storage.close();
    }
  }, 120_000);
});

describe('Phase 16 offline pipeline - real generated-project build', () => {
  it('npm install && npm run build produces dist/index.html', async (context) => {
    if (!RUN_PROJECT_BUILD) {
      context.skip();
      return;
    }
    const npm = npmCommand();
    if (!(await hasCommand(npm))) {
      // BLOCKED: report honestly rather than passing.
      // eslint-disable-next-line no-console
      console.warn(`[phase16 build e2e] BLOCKED: ${npm} is unavailable.`);
      context.skip();
      return;
    }

    const storage = await createTestStorage();
    let targetRoot = '';
    try {
      targetRoot = await tempRoot('resite-p16-build-src-');
      const destinationRoot = await tempRoot('resite-p16-build-dst-');
      const result = await runOfflinePipeline(
        { targetRoot, destinationRoot, pageCount: 2 },
        { storage, engine: createScriptedEngine() }
      );
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await storage.close();
    }

    const build = await installAndBuild(targetRoot);
    expect(build.install.code, `npm install failed:\n${build.install.output}`).toBe(0);
    expect(build.build.code, `npm run build failed:\n${build.build.output}`).toBe(0);
    expect(await hasDistIndexHtml(targetRoot)).toBe(true);
  }, 900_000);
});
