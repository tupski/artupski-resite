import { describe, expect, it } from 'vitest';
import type { BlueprintComponent } from '../../../types/blueprint';
import {
  MAX_FRAGMENT_CHARS,
  MAX_PAYLOAD_TOKENS,
  MAX_PAYLOAD_VARIANTS,
  projectComponentPayload,
  projectDesignTokens,
  toComponentIdentifier
} from '../componentPayload';
import { component, validBlueprint } from './fixtures';

function byId(components: BlueprintComponent[]): Map<string, BlueprintComponent> {
  return new Map(components.map((c) => [c.id, c]));
}

describe('projectComponentPayload (bounded chunking, A4/A5)', () => {
  it('projects the component definition verbatim (evidence-grounded)', () => {
    const blueprint = validBlueprint();
    const target = blueprint.components[1] as BlueprintComponent;
    const payload = projectComponentPayload(
      target,
      { designSystem: blueprint.design_system },
      byId(blueprint.components)
    );

    expect(payload.component_id).toBe('cmp_button_primary');
    expect(payload.name).toBe('Button');
    expect(payload.category).toBe('ui_primitive');
    expect(payload.variants).toEqual({
      primary: 'bg-sky-500 text-white hover:bg-sky-600 px-4 py-2 rounded-md',
      secondary: 'bg-slate-100 text-slate-900 px-4 py-2 rounded-md'
    });
  });

  it('includes child component names, never their bodies', () => {
    const blueprint = validBlueprint();
    const hero = blueprint.components[0] as BlueprintComponent;
    const payload = projectComponentPayload(
      hero,
      { designSystem: blueprint.design_system },
      byId(blueprint.components)
    );
    expect(payload.child_components).toEqual(['Button']);
    expect(JSON.stringify(payload)).not.toContain('ButtonProps');
  });

  it('caps variant cardinality deterministically (sorted)', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_PAYLOAD_VARIANTS + 10; i += 1) {
      many[`v${String(i).padStart(3, '0')}`] = `class-${i}`;
    }
    const payload = projectComponentPayload(
      component({ variants: many }),
      { designSystem: validBlueprint().design_system },
      byId([component({ variants: many })])
    );
    const variants = payload.variants as Record<string, string>;
    expect(Object.keys(variants)).toHaveLength(MAX_PAYLOAD_VARIANTS);
    expect(Object.keys(variants)[0]).toBe('v000');
  });

  it('truncates an oversized observed fragment without fabricating content', () => {
    const huge = `<div>${'x'.repeat(MAX_FRAGMENT_CHARS + 500)}</div>`;
    const payload = projectComponentPayload(
      component(),
      { designSystem: validBlueprint().design_system, fragment: huge },
      byId([component()])
    );
    const markup = payload.observed_markup as string;
    expect(markup.length).toBeLessThan(huge.length);
    expect(markup).toContain('TRUNCATED');
  });

  it('omits fields that have no evidence (no fabrication)', () => {
    const bare = component({
      id: 'cmp_bare',
      name: 'Bare',
      variants: {},
      props: [],
      children_slots: [],
      dependencies: [],
      children: []
    });
    const payload = projectComponentPayload(
      bare,
      { designSystem: validBlueprint().design_system },
      byId([bare])
    );
    expect(payload.child_components).toBeUndefined();
    expect(payload.dependencies).toBeUndefined();
    expect(payload.observed_markup).toBeUndefined();
    expect(payload.responsive_overrides).toBeUndefined();
  });

  it('carries classification confidence when present (observed vs inferred preserved)', () => {
    const inferred = component({ id: 'cmp_x', name: 'X', confidence: 0.4 });
    const payload = projectComponentPayload(
      inferred,
      { designSystem: validBlueprint().design_system },
      byId([inferred])
    );
    expect(payload.classification_confidence).toBe(0.4);
  });
});

describe('projectDesignTokens', () => {
  it('includes actual token values and caps cardinality', () => {
    const tokens = projectDesignTokens(validBlueprint().design_system);
    expect(tokens.colors).toBeDefined();
    expect(tokens.typography).toBeDefined();
    expect(tokens.spacing).toBeDefined();
    expect(tokens.radii).toBeDefined();
    expect(tokens.shadows).toBeDefined();
  });

  it('caps each record at the documented limit', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_PAYLOAD_TOKENS + 20; i += 1) {
      many[`k${i}`] = `${i}rem`;
    }
    const tokens = projectDesignTokens({
      ...validBlueprint().design_system,
      spacing: many
    });
    expect(Object.keys(tokens.spacing as Record<string, string>)).toHaveLength(MAX_PAYLOAD_TOKENS);
  });
});

describe('toComponentIdentifier', () => {
  it('converts names to PascalCase identifiers', () => {
    expect(toComponentIdentifier('button', 'cmp_x')).toBe('Button');
    expect(toComponentIdentifier('hero section', 'cmp_x')).toBe('HeroSection');
    expect(toComponentIdentifier('feature-grid', 'cmp_x')).toBe('FeatureGrid');
  });

  it('prefixes identifiers that would start with a digit', () => {
    expect(toComponentIdentifier('2fa form', 'cmp_x')).toBe('Component2faForm');
  });

  it('falls back to the id when the name is empty', () => {
    expect(toComponentIdentifier('', 'cmp_hero_01')).toBe('CmpHero01');
  });
});
