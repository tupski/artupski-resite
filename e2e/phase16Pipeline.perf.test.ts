/**
 * Phase 16 performance / limits harness - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-16-impl-plan.md sections 5 S4 and 9.3 (C3).
 *
 * A deterministic, bounded synthetic Blueprint (N pages / components / routes) is
 * driven through the REAL `generateProject` + `exportProject`. The harness
 * RECORDS the elapsed milliseconds and produced byte counts and asserts ONLY
 * invariants:
 *   - the run completes,
 *   - the output stays within the documented Phase 12/14 caps,
 *   - the byte count is DETERMINISTIC across two independent runs.
 *
 * There are NO wall-clock thresholds: asserting timing is flaky across machines
 * (deviation C3). The measured numbers are written into the Phase 16 as-built note.
 * The harness is part of the default suite (it needs no browser and no network).
 */
import { promises as fs } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { Blueprint } from '../src/types/blueprint';
import { validateBlueprint } from '../src/types/blueprint';
import {
  MAX_PROJECT_TOTAL_BYTES,
  MAX_PROJECT_FILES
} from '../src/types/projectGen';
import { MAX_EXPORT_TOTAL_BYTES } from '../src/types/export';
import { synthesizeComponents } from '../src/services/generator/componentSynthesizer';
import { generateProject } from '../src/services/generator/projectGenerator';
import { createNodeExportIo, exportProject } from '../src/services/exporter/zipExporter';
import { readZip } from '../src/services/exporter/zip';
import { phase12Blueprint } from '../src/services/generator/__tests__/projectFixtures';
import { createScriptedEngine } from './harness/scriptedEngine';
import { makeTempRoot } from './harness/pipeline';

// Bounded so the component count stays within the Phase 11 synthesis cap
// (`MAX_SYNTHESIS_COMPONENTS` = 50); the generator cap is far larger.
const PAGE_COUNT = 25;
const COMPONENTS_PER_PAGE = 2;
const COMPONENT_COUNT = PAGE_COUNT * COMPONENTS_PER_PAGE;

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

/**
 * Build a bounded, schema-valid synthetic Blueprint: `PAGE_COUNT` pages/routes and
 * `COMPONENT_COUNT` components, each page referencing its own components. It reuses
 * the canonical Phase 12 fixture's site/design-system/layout and only expands the
 * page/route/component arrays, so it is deterministic and no data is fabricated
 * beyond the bounded structure.
 */
export function syntheticBlueprint(): Blueprint {
  const base = phase12Blueprint();
  const pages: Blueprint['pages'] = [];
  const routes: Blueprint['routes'] = [];
  const components: Blueprint['components'] = [];

  for (let index = 0; index < COMPONENT_COUNT; index += 1) {
    components.push({
      id: `cmp_${index}`,
      name: `Component ${index}`,
      category: index % 2 === 0 ? 'composite' : 'ui_primitive',
      variants: {},
      props: [{ name: 'title', type: 'string', required: true, default: `Title ${index}` }],
      children_slots: ['default'],
      dependencies: []
    });
  }

  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const id = `page_${index}`;
    const path = index === 0 ? '/' : `/page-${index}`;
    const referenced = Array.from({ length: COMPONENTS_PER_PAGE }, (_, offset) =>
      String(`cmp_${index * COMPONENTS_PER_PAGE + offset}`)
    );
    pages.push({
      id,
      path,
      title: `Page ${index}`,
      layout_id: 'layout_public',
      template: index === 0 ? 'landing' : 'page',
      is_dynamic: false,
      dynamic_param_names: [],
      meta: {},
      root_component_ids: referenced
    });
    routes.push({
      path,
      page_id: id,
      auth_required: false,
      allowed_roles: [],
      redirect_to: null
    });
  }

  return { ...base, pages, routes, components };
}

interface PerfRecord {
  synthesizeMs: number;
  generateMs: number;
  exportMs: number;
  files: number;
  bytesWritten: number;
  archiveBytes: number;
}

async function runOnce(): Promise<{ record: PerfRecord; bytes: number }> {
  const blueprint = syntheticBlueprint();
  const validation = validateBlueprint(blueprint);
  expect(validation.success).toBe(true);

  const targetRoot = await makeTempRoot('resite-p16-perf-src-');
  const destinationRoot = await makeTempRoot('resite-p16-perf-dst-');
  roots.push(targetRoot, destinationRoot);

  const synthesizeStart = Date.now();
  const synthesis = await synthesizeComponents(
    { engine: createScriptedEngine() },
    { blueprint, options: {} }
  );
  const synthesizeMs = Date.now() - synthesizeStart;
  expect(synthesis.failures).toEqual([]);
  expect(synthesis.components.length).toBe(COMPONENT_COUNT);

  const generateStart = Date.now();
  const report = await generateProject(
    {},
    {
      blueprint,
      components: synthesis.components,
      targetRoot,
      options: { projectName: 'resite-perf-app' }
    }
  );
  const generateMs = Date.now() - generateStart;
  expect(report.ok, JSON.stringify(report.error)).toBe(true);

  const io = createNodeExportIo();
  const exportStart = Date.now();
  const exported = await exportProject(
    { reader: io.reader, writer: io.writer },
    {
      projectRoot: targetRoot,
      report,
      projectName: 'Resite Perf App',
      targetFramework: 'Vite + React + TypeScript + Tailwind',
      mode: 'zip',
      destinationRoot
    }
  );
  const exportMs = Date.now() - exportStart;
  expect(exported.ok, JSON.stringify(exported.error)).toBe(true);

  const archiveBytes = new Uint8Array(
    await fs.readFile(`${destinationRoot}/${exported.artifactPath}`)
  );
  const archive = readZip(archiveBytes);
  expect(archive.data.has('README.md')).toBe(true);

  return {
    record: {
      synthesizeMs,
      generateMs,
      exportMs,
      files: report.summary.filesWritten,
      bytesWritten: report.summary.bytesWritten,
      archiveBytes: archiveBytes.byteLength
    },
    bytes: report.summary.bytesWritten
  };
}

describe('Phase 16 performance harness (records numbers; asserts only invariants)', () => {
  it('generates and exports a bounded synthetic project deterministically', async () => {
    const first = await runOnce();

    // --- Invariants only (no wall-clock thresholds). --------------------------
    expect(first.record.files).toBeGreaterThanOrEqual(PAGE_COUNT + COMPONENT_COUNT);
    expect(first.record.files).toBeLessThanOrEqual(MAX_PROJECT_FILES);
    expect(first.record.bytesWritten).toBeLessThanOrEqual(MAX_PROJECT_TOTAL_BYTES);
    expect(first.record.archiveBytes).toBeLessThanOrEqual(MAX_EXPORT_TOTAL_BYTES);

    const second = await runOnce();
    // Deterministic output: identical file count and byte count across two runs.
    expect(second.bytes).toBe(first.bytes);
    expect(second.record.files).toBe(first.record.files);
    expect(second.record.archiveBytes).toBe(first.record.archiveBytes);

    // eslint-disable-next-line no-console
    console.log(
      `[phase16 perf] pages=${PAGE_COUNT} components=${COMPONENT_COUNT} ` +
        `synthesizeMs=${first.record.synthesizeMs} generateMs=${first.record.generateMs} ` +
        `exportMs=${first.record.exportMs} files=${first.record.files} ` +
        `bytesWritten=${first.record.bytesWritten} archiveBytes=${first.record.archiveBytes}`
    );
  }, 120_000);
});
