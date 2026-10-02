import { describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../infra/eventBus';
import type { PipelineResult } from '../../ai';
import {
  MAX_SYNTHESIS_COMPONENTS,
  type ComponentSynthesisResult
} from '../../../types/componentSynth';
import {
  COMPONENT_SYNTHESIS_TASK,
  sanitizeFileName,
  selectTargets,
  synthesizeComponents
} from '../componentSynthesizer';
import { jsonEngine, scriptedEngine, validBlueprint } from './fixtures';

const BUTTON_CODE = `interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, variant = 'primary' }: ButtonProps) {
  return <button type="button" className={variant === 'primary' ? 'bg-sky-500' : 'bg-slate-100'}>{label}</button>;
}
`;

const HERO_CODE = `interface HeroProps {
  title: string;
}

export function Hero({ title }: HeroProps) {
  return <section className="max-w-7xl mx-auto px-4"><h1 className="text-lg">{title}</h1></section>;
}
`;

function ok(data: unknown): PipelineResult<unknown> {
  return { ok: true, data, attempts: 1 };
}

function err(message = 'boom'): PipelineResult<unknown> {
  return {
    ok: false,
    attempts: 1,
    error: {
      code: 'MALFORMED_OUTPUT',
      category: 'ai',
      message,
      severity: 'error',
      recoverable: true,
      retryable: false,
      suggestedAction: 'Retry',
      timestamp: '2026-10-01T00:00:00.000Z'
    }
  };
}

function collectEvents(): { events: AppEvent[]; sink: { emit: (e: AppEvent) => void } } {
  const events: AppEvent[] = [];
  return { events, sink: { emit: (e) => events.push(e) } };
}

function find(result: ComponentSynthesisResult, id: string) {
  return result.components.find((c) => c.componentId === id);
}

describe('synthesizeComponents (Phase 11 acceptance)', () => {
  it('synthesizes clean components from a validated Blueprint (A1/A3)', async () => {
    const engine = scriptedEngine([
      ok({ componentId: 'cmp_hero_01', name: 'Hero', fileName: 'Hero.tsx', code: HERO_CODE }),
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    const result = await synthesizeComponents({ engine }, { blueprint: validBlueprint() });

    expect(result.summary.requested).toBe(2);
    expect(result.summary.succeeded).toBe(2);
    expect(result.summary.failed).toBe(0);
    expect(find(result, 'cmp_button_primary')?.code).toContain('export function Button');
    expect(find(result, 'cmp_hero_01')?.variantKeys).toEqual([]);
    expect(find(result, 'cmp_button_primary')?.variantKeys).toEqual(['primary', 'secondary']);
  });

  it('passes a schema-constrained task and the defensive prompt to the engine', async () => {
    const engine = scriptedEngine([
      ok({ componentId: 'cmp_hero_01', name: 'Hero', fileName: 'Hero.tsx', code: HERO_CODE }),
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    await synthesizeComponents({ engine }, { blueprint: validBlueprint() });

    expect(engine.tasks).toHaveLength(2);
    const task = engine.tasks[0]!;
    expect(task.taskName).toBe(COMPONENT_SYNTHESIS_TASK);
    expect(task.systemPrompt).toContain('SECURITY DIRECTIVES');
    expect(task.maxRepairAttempts).toBe(1);
    // The payload carries the component id and evidence, not instructions.
    expect((task.payload as Record<string, unknown>).component_id).toBe('cmp_hero_01');
  });

  it('isolates a failing component and keeps the successful ones (failure isolation)', async () => {
    const engine = scriptedEngine([
      err('model exploded'),
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    const result = await synthesizeComponents({ engine }, { blueprint: validBlueprint() });

    expect(result.summary.succeeded).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.failures[0]?.componentId).toBe('cmp_hero_01');
    expect(result.failures[0]?.code).toBe('MALFORMED_OUTPUT');
    expect(result.failures[0]?.message).toBe('model exploded');
  });

  it('rejects output whose componentId does not echo the request', async () => {
    const engine = scriptedEngine([
      ok({ componentId: 'wrong_id', name: 'Hero', fileName: 'Hero.tsx', code: HERO_CODE }),
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    const result = await synthesizeComponents({ engine }, { blueprint: validBlueprint() });
    expect(result.failures[0]?.componentId).toBe('cmp_hero_01');
    expect(result.failures[0]?.code).toBe('MALFORMED_OUTPUT');
  });

  it('rejects sloppy code with SLOPPY_OUTPUT (A3)', async () => {
    const sloppy = 'export function Hero() { /* TODO */ return <div onClick={() => {}} />; }';
    const engine = scriptedEngine([
      ok({ componentId: 'cmp_hero_01', name: 'Hero', fileName: 'Hero.tsx', code: sloppy }),
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    const result = await synthesizeComponents({ engine }, { blueprint: validBlueprint() });
    expect(result.failures[0]?.code).toBe('SLOPPY_OUTPUT');
    expect(result.summary.succeeded).toBe(1);
  });

  it('catches an engine throw and reports it without crashing the run', async () => {
    const engine = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new Error('transport down'))
        .mockResolvedValueOnce(
          ok({
            componentId: 'cmp_button_primary',
            name: 'Button',
            fileName: 'Button.tsx',
            code: BUTTON_CODE
          })
        )
    };
    const result = await synthesizeComponents({ engine }, { blueprint: validBlueprint() });
    expect(result.summary.succeeded).toBe(1);
    expect(result.failures[0]?.code).toBe('MALFORMED_OUTPUT');
  });

  it('validates an untrusted blueprint and refuses an invalid one', async () => {
    const engine = scriptedEngine([
      ok({ componentId: 'cmp_hero_01', name: 'Hero', fileName: 'Hero.tsx', code: HERO_CODE })
    ]);
    const result = await synthesizeComponents(
      { engine },
      { blueprint: { blueprint_version: 99, components: [] } }
    );
    expect(result.summary.requested).toBe(0);
    expect(result.summary.partial).toBe(true);
    expect(result.components).toHaveLength(0);
    expect(engine.tasks).toHaveLength(0);
  });

  it('accepts a plain object that structurally validates', async () => {
    const engine = scriptedEngine([
      ok({ componentId: 'cmp_hero_01', name: 'Hero', fileName: 'Hero.tsx', code: HERO_CODE }),
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    const raw = JSON.parse(JSON.stringify(validBlueprint()));
    const result = await synthesizeComponents({ engine }, { blueprint: raw });
    expect(result.summary.succeeded).toBe(2);
  });

  it('caps the number of attempted components (A4 resource bound)', async () => {
    const engine = scriptedEngine([
      ok({ componentId: 'cmp_hero_01', name: 'Hero', fileName: 'Hero.tsx', code: HERO_CODE })
    ]);
    const result = await synthesizeComponents(
      { engine },
      { blueprint: validBlueprint(), options: { maxComponents: 1 } }
    );
    expect(result.summary.requested).toBe(1);
    expect(result.summary.partial).toBe(true);
  });

  it('honours componentIds filtering', async () => {
    const engine = scriptedEngine([
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    const result = await synthesizeComponents(
      { engine },
      { blueprint: validBlueprint(), options: { componentIds: ['cmp_button_primary'] } }
    );
    expect(result.summary.requested).toBe(1);
    expect(result.summary.partial).toBe(false);
  });

  it('stops early and reports abort honestly', async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = scriptedEngine([
      ok({ componentId: 'x', name: 'X', fileName: 'X.tsx', code: HERO_CODE })
    ]);
    const result = await synthesizeComponents(
      { engine },
      { blueprint: validBlueprint(), options: { signal: controller.signal } }
    );
    expect(result.summary.aborted).toBe(true);
    expect(result.summary.requested).toBe(2);
    expect(result.summary.succeeded).toBe(0);
    expect(engine.tasks).toHaveLength(0);
  });

  it('de-duplicates colliding identifiers deterministically', async () => {
    const bp = validBlueprint();
    bp.components[0]!.name = 'Button';
    bp.components[1]!.name = 'Button';
    const codeFor = (name: string) =>
      `interface ${name}Props {\n  label: string;\n}\n\nexport function ${name}({ label }: ${name}Props) {\n  return <button className="bg-sky-500">{label}</button>;\n}\n`;
    const engine = scriptedEngine([
      ok({
        componentId: 'cmp_hero_01',
        name: 'Button',
        fileName: 'Button.tsx',
        code: codeFor('Button')
      }),
      ok({
        componentId: 'cmp_button_primary',
        name: 'Button2',
        fileName: 'Button2.tsx',
        code: codeFor('Button2')
      })
    ]);
    const result = await synthesizeComponents({ engine }, { blueprint: bp });
    const names = result.components.map((c) => c.name).sort();
    expect(names).toEqual(['Button', 'Button2']);
  });
});

describe('synthesizeComponents events (component.*)', () => {
  it('emits started → generated/failed → completed with bounded payloads', async () => {
    const engine = scriptedEngine([
      ok({ componentId: 'cmp_hero_01', name: 'Hero', fileName: 'Hero.tsx', code: HERO_CODE }),
      err('nope')
    ]);
    const { events, sink } = collectEvents();
    await synthesizeComponents({ engine, events: sink }, { blueprint: validBlueprint() });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('component.started');
    expect(types).toContain('component.generated');
    expect(types).toContain('component.failed');
    expect(types[types.length - 1]).toBe('component.completed');

    const generated = events.find((e) => e.type === 'component.generated')!;
    expect(Object.keys(generated.payload)).not.toContain('code');

    const completed = events.find((e) => e.type === 'component.completed')!;
    expect(completed.payload).toMatchObject({
      requested: 2,
      succeeded: 1,
      failed: 1,
      partial: false
    });
  });
});

describe('selectTargets / sanitizeFileName', () => {
  it('clamps the cap to [1, MAX_SYNTHESIS_COMPONENTS]', () => {
    const components = validBlueprint().components;
    expect(selectTargets(components, { maxComponents: 0 })).toHaveLength(1);
    expect(selectTargets(components, { maxComponents: 999 })).toHaveLength(components.length);
    expect(MAX_SYNTHESIS_COMPONENTS).toBeGreaterThan(components.length);
  });

  it('strips directory separators from model-provided file names', () => {
    expect(sanitizeFileName('../../etc/passwd', 'Button')).toBe('Button.tsx');
    expect(sanitizeFileName('components/Button.tsx', 'Button')).toBe('Button.tsx');
    expect(sanitizeFileName('Button.tsx', 'Button')).toBe('Button.tsx');
    expect(sanitizeFileName('', 'Button')).toBe('Button.tsx');
  });
});

describe('end-to-end via a JSON-returning engine (A1 contract)', () => {
  it('produces structurally valid TSX through the full pipeline shape', async () => {
    const engine = jsonEngine([
      JSON.stringify({
        componentId: 'cmp_hero_01',
        name: 'Hero',
        fileName: 'Hero.tsx',
        code: HERO_CODE
      }),
      JSON.stringify({
        componentId: 'cmp_button_primary',
        name: 'Button',
        fileName: 'Button.tsx',
        code: BUTTON_CODE
      })
    ]);
    const result = await synthesizeComponents({ engine }, { blueprint: validBlueprint() });
    expect(result.summary.succeeded).toBe(2);
    for (const artifact of result.components) {
      expect(artifact.code).toContain('export function');
      expect(artifact.fileName.endsWith('.tsx')).toBe(true);
    }
  });
});
