/**
 * Blueprint documentation generator suites - Artupski ReSite
 *
 * Covers the deterministic templates (non-empty, data-populated content),
 * conditional optional-doc selection (relevance + opt-in/opt-out), AI narrative
 * enrichment via a scripted engine, and graceful degradation when AI is
 * unavailable. Pure: no network, no filesystem.
 */
import { describe, expect, it } from 'vitest';
import type { GenerationTask } from '../../../types/ai';
import type { PipelineResult } from '../../ai';
import { createAiError } from '../../ai/errors';
import {
  generateBlueprintDocs,
  planBlueprintDocs,
  isOptionalDocRelevant,
  NarrativeSchema,
  type BlueprintDocsEngine
} from '../docs';
import { buildBlueprintDoc } from '../docs/templates';
import { docsBlueprint, minimalBlueprint } from './blueprintDocs.fixtures';

/** A scripted engine returning a queued result per call (replays the last). */
function scriptedEngine(
  results: PipelineResult<unknown>[]
): { engine: BlueprintDocsEngine; state: { calls: number } } {
  const state = { calls: 0 };
  const engine: BlueprintDocsEngine = {
    async generate<T>(task: GenerationTask<T>): Promise<PipelineResult<T>> {
      const index = Math.min(state.calls, results.length - 1);
      state.calls += 1;
      const result = results[index] as PipelineResult<T>;
      // Validate through the task schema so the test exercises the real contract.
      if (result.ok) {
        const parsed = task.schema.safeParse(result.data);
        if (!parsed.success) {
          return {
            ok: false,
            attempts: 1,
            error: createAiError('MALFORMED_OUTPUT', 'scripted result failed schema')
          };
        }
        return { ok: true, data: parsed.data as T, attempts: 1 };
      }
      return result;
    }
  };
  return { engine, state };
}

/** An engine that always fails (simulates an unavailable provider). */
function failingEngine(): BlueprintDocsEngine {
  return {
    async generate<T>(): Promise<PipelineResult<T>> {
      return {
        ok: false,
        attempts: 1,
        error: createAiError('API_KEY_INVALID', 'No AI endpoint is configured.')
      };
    }
  };
}

const NARRATIVE_OK: PipelineResult<unknown> = {
  ok: true,
  attempts: 1,
  data: { summary: 'A grounded summary.', notes: ['Uses the captured tokens.'] }
};

describe('blueprint docs templates', () => {
  it('emits non-empty, data-populated content for every required document', () => {
    const blueprint = docsBlueprint();
    for (const name of [
      'AGENTS.md',
      'PRD.md',
      'ARCHITECTURE.md',
      'PLAN.md',
      'UI-SPEC.md',
      'ASSETS.md',
      'TESTING.md'
    ] as const) {
      const contents = buildBlueprintDoc(name, blueprint);
      expect(contents.startsWith('# ')).toBe(true);
      expect(contents.length).toBeGreaterThan(80);
    }
  });

  it('populates UI-SPEC.md with captured tokens and component variants', () => {
    const contents = buildBlueprintDoc('UI-SPEC.md', docsBlueprint());
    expect(contents).toContain('#0ea5e9');
    expect(contents).toContain('primary.500');
    expect(contents).toContain('bg-sky-500');
    expect(contents).toContain('Inter');
  });

  it('populates ASSETS.md with the captured asset inventory', () => {
    const contents = buildBlueprintDoc('ASSETS.md', docsBlueprint());
    expect(contents).toContain('img_hero_bg');
    expect(contents).toContain('assets/images/img_hero_bg.webp');
    expect(contents).toContain('Inter');
    expect(contents).toContain('icon_arrow_right');
  });

  it('populates ARCHITECTURE.md with routes and components', () => {
    const contents = buildBlueprintDoc('ARCHITECTURE.md', docsBlueprint());
    expect(contents).toContain('/dashboard/:teamId');
    expect(contents).toContain('Button');
    expect(contents).toContain('Next.js');
  });

  it('populates PRD.md with pages and captured copy', () => {
    const contents = buildBlueprintDoc('PRD.md', docsBlueprint());
    expect(contents).toContain('/dashboard/:teamId');
    expect(contents).toContain('Build applications at lightning speed');
  });

  it('escapes a leading # in a heading so it cannot break structure', () => {
    const blueprint = docsBlueprint({ site: { ...docsBlueprint().site, name: '#evil' } });
    const contents = buildBlueprintDoc('PRD.md', blueprint);
    expect(contents.startsWith('# PRD.md - \\#evil')).toBe(true);
  });

  it('merges an AI narrative as a labelled section when supplied', () => {
    const contents = buildBlueprintDoc('PRD.md', docsBlueprint(), {
      summary: 'AI summary here.',
      notes: ['Note one.']
    });
    expect(contents).toContain('## Summary (AI-assisted)');
    expect(contents).toContain('AI summary here.');
    expect(contents).toContain('Note one.');
  });
});

describe('blueprint docs selection', () => {
  it('always plans the seven required documents for a rich blueprint', () => {
    const plan = planBlueprintDocs(docsBlueprint());
    const required = plan.filter((entry) => entry.required).map((entry) => entry.name);
    expect(required).toEqual([
      'AGENTS.md',
      'PRD.md',
      'ARCHITECTURE.md',
      'PLAN.md',
      'UI-SPEC.md',
      'ASSETS.md',
      'TESTING.md'
    ]);
  });

  it('adds all four optional docs when the evidence indicates relevance', () => {
    const names = planBlueprintDocs(docsBlueprint()).map((entry) => entry.name);
    expect(names).toContain('DATABASE.md');
    expect(names).toContain('API.md');
    expect(names).toContain('SECURITY.md');
    expect(names).toContain('DEPLOYMENT.md');
  });

  it('omits optional docs for a minimal blueprint', () => {
    const plan = planBlueprintDocs(minimalBlueprint());
    const optional = plan.filter((entry) => !entry.required).map((entry) => entry.name);
    expect(optional).toEqual([]);
  });

  it('reports per-document relevance from real evidence', () => {
    const rich = docsBlueprint();
    expect(isOptionalDocRelevant('API.md', rich)).toBe(true);
    expect(isOptionalDocRelevant('DATABASE.md', rich)).toBe(true);
    expect(isOptionalDocRelevant('SECURITY.md', rich)).toBe(true);
    expect(isOptionalDocRelevant('DEPLOYMENT.md', rich)).toBe(true);
    const minimal = minimalBlueprint();
    expect(isOptionalDocRelevant('API.md', minimal)).toBe(false);
    expect(isOptionalDocRelevant('SECURITY.md', minimal)).toBe(false);
  });

  it('honors an explicit include toggle over relevance', () => {
    const plan = planBlueprintDocs(minimalBlueprint(), { include: { 'API.md': true } });
    const api = plan.find((entry) => entry.name === 'API.md');
    expect(api?.reason).toBe('opted_in');
  });

  it('honors an explicit exclude toggle over relevance', () => {
    const plan = planBlueprintDocs(docsBlueprint(), { exclude: ['DATABASE.md'] });
    expect(plan.map((entry) => entry.name)).not.toContain('DATABASE.md');
  });

  it('suppresses TESTING.md when includeTesting is false', () => {
    const plan = planBlueprintDocs(docsBlueprint(), { includeTesting: false });
    expect(plan.map((entry) => entry.name)).not.toContain('TESTING.md');
  });
});

describe('generateBlueprintDocs', () => {
  it('generates the right set of docs and non-empty content with no AI', async () => {
    const result = await generateBlueprintDocs(docsBlueprint(), { useAi: false });
    const names = result.docs.map((doc) => doc.name);
    expect(names).toEqual([
      'AGENTS.md',
      'PRD.md',
      'ARCHITECTURE.md',
      'PLAN.md',
      'UI-SPEC.md',
      'ASSETS.md',
      'TESTING.md',
      'DATABASE.md',
      'API.md',
      'SECURITY.md',
      'DEPLOYMENT.md'
    ]);
    for (const doc of result.docs) {
      expect(doc.bytes).toBeGreaterThan(0);
      expect(doc.contents.length).toBeGreaterThan(80);
      expect(doc.source).toBe('deterministic');
    }
    expect(result.warnings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('skips the four optional docs for a minimal blueprint and reports them', async () => {
    const result = await generateBlueprintDocs(minimalBlueprint(), { useAi: false });
    const names = result.docs.map((doc) => doc.name);
    expect(names).toEqual([
      'AGENTS.md',
      'PRD.md',
      'ARCHITECTURE.md',
      'PLAN.md',
      'UI-SPEC.md',
      'ASSETS.md',
      'TESTING.md'
    ]);
    expect(result.skipped.map((entry) => entry.name).sort()).toEqual([
      'API.md',
      'DATABASE.md',
      'DEPLOYMENT.md',
      'SECURITY.md'
    ]);
  });

  it('enriches docs with the scripted AI narrative', async () => {
    const { engine, state } = scriptedEngine([NARRATIVE_OK]);
    const result = await generateBlueprintDocs(docsBlueprint(), {}, { engine });
    expect(state.calls).toBeGreaterThan(0);
    const prd = result.docs.find((doc) => doc.name === 'PRD.md')!;
    expect(prd.source).toBe('ai');
    expect(prd.contents).toContain('## Summary (AI-assisted)');
    expect(prd.contents).toContain('A grounded summary.');
    expect(result.warnings).toEqual([]);
  });

  it('degrades gracefully when the AI engine fails (per-doc isolation)', async () => {
    const result = await generateBlueprintDocs(docsBlueprint(), {}, { engine: failingEngine() });
    // Every planned doc is still produced, deterministically.
    expect(result.docs.length).toBe(11);
    for (const doc of result.docs) {
      expect(doc.source).toBe('deterministic');
      expect(doc.contents.length).toBeGreaterThan(80);
    }
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.every((warning) => warning.code === 'API_KEY_INVALID')).toBe(true);
  });

  it('sanitizes an over-long AI narrative', async () => {
    const huge: PipelineResult<unknown> = {
      ok: true,
      attempts: 1,
      data: { summary: 'x'.repeat(5000), notes: Array.from({ length: 20 }, () => 'note') }
    };
    const { engine } = scriptedEngine([huge]);
    const result = await generateBlueprintDocs(minimalBlueprint(), {}, { engine });
    const agents = result.docs.find((doc) => doc.name === 'AGENTS.md')!;
    expect(agents.source).toBe('ai');
    // The summary is bounded, not the raw 5000 chars.
    expect(agents.contents).not.toContain('x'.repeat(2000));
  });

  it('refuses an invalid blueprint without generating anything', async () => {
    const result = await generateBlueprintDocs({ not: 'a blueprint' }, { useAi: false });
    expect(result.docs).toEqual([]);
    expect(result.warnings[0]?.code).toBe('BLUEPRINT_VALIDATION_FAILED');
  });

  it('is deterministic for a fixed blueprint and no AI', async () => {
    const first = await generateBlueprintDocs(docsBlueprint(), { useAi: false });
    const second = await generateBlueprintDocs(docsBlueprint(), { useAi: false });
    expect(second.docs.map((doc) => doc.contents)).toEqual(first.docs.map((doc) => doc.contents));
  });

  it('exposes the narrative schema contract', () => {
    expect(NarrativeSchema.safeParse({ summary: 's', notes: [] }).success).toBe(true);
    expect(NarrativeSchema.safeParse({ summary: 's' }).success).toBe(false);
  });
});
