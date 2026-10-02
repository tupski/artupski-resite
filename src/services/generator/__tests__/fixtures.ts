/**
 * Phase 11 test fixtures - Artupski ReSite
 *
 * Deterministic, schema-valid Blueprint documents and scripted AI engines used
 * across the generator suites. No network, no live model: every AI interaction
 * is a queued response so tests are fully deterministic.
 */
import type { z } from 'zod';
import type { GenerationTask } from '../../../types/ai';
import type { Blueprint, BlueprintComponent } from '../../../types/blueprint';
import type { PipelineResult } from '../../ai';
import type { ComponentSynthesisEngine } from '../componentSynthesizer';

/** A single Blueprint component valid against the Phase 9 schema. */
export function component(overrides: Partial<BlueprintComponent> = {}): BlueprintComponent {
  return {
    id: 'cmp_button_primary',
    name: 'Button',
    category: 'ui_primitive',
    variants: {
      primary: 'bg-sky-500 text-white hover:bg-sky-600 px-4 py-2 rounded-md',
      secondary: 'bg-slate-100 text-slate-900 px-4 py-2 rounded-md'
    },
    props: [
      { name: 'label', type: 'string', required: true, default: 'Click' },
      { name: 'variant', type: 'enum', options: ['primary', 'secondary'], required: false }
    ],
    children_slots: ['default'],
    dependencies: [],
    ...overrides
  };
}

/** A fully schema-valid Blueprint with two components + design tokens. */
export function validBlueprint(): Blueprint {
  return {
    $schema: 'https://artupski.com/schemas/blueprint.v1.json',
    blueprint_version: 1,
    generated_at: '2026-10-01T00:00:00.000Z',
    source_url: 'https://example.com',
    generator: { name: 'Artupski ReSite Engine', version: '1.0.0' },
    site: {
      name: 'Acme SaaS Platform',
      domain: 'example.com',
      canonical_url: 'https://example.com',
      default_locale: 'en-US',
      supported_locales: ['en-US'],
      direction: 'ltr',
      favicon_url: 'assets/favicon.ico',
      theme_color: '#0ea5e9',
      description: 'Next generation collaborative tool.'
    },
    pages: [
      {
        id: 'page_home',
        path: '/',
        title: 'Home - Acme SaaS',
        layout_id: 'layout_public',
        template: 'landing',
        is_dynamic: false,
        dynamic_param_names: [],
        meta: {},
        root_component_ids: ['cmp_hero_01', 'cmp_button_primary']
      }
    ],
    routes: [],
    components: [
      component({
        id: 'cmp_hero_01',
        name: 'Hero',
        category: 'composite',
        variants: {},
        props: [{ name: 'title', type: 'string', required: true, default: 'Hello' }],
        children_slots: ['default'],
        children: ['cmp_button_primary']
      }),
      component()
    ],
    layout: {
      default_layout_id: 'layout_public',
      definitions: [
        {
          id: 'layout_public',
          name: 'Public Marketing Layout',
          header_component_id: null,
          footer_component_id: null,
          sidebar_component_id: null,
          container_width: 'max-w-7xl',
          body_bg_color: '#ffffff',
          slots: ['header', 'main', 'footer']
        }
      ]
    },
    navigation: { primary_menu: [], footer_menu: [], user_menu: [] },
    content: { strings: {}, blocks: [] },
    assets: { images: [], icons: [], fonts: [] },
    design_system: {
      colors: {
        primary: { '500': '#0ea5e9', '900': '#0c4a6e' },
        background: '#ffffff',
        foreground: '#0f172a'
      },
      typography: {
        font_sans: ['Inter', 'sans-serif'],
        font_mono: ['JetBrains Mono', 'monospace'],
        font_sizes: { sm: '0.875rem', base: '1rem', lg: '1.125rem' },
        line_heights: { normal: '1.5' }
      },
      spacing: { '2': '0.5rem', '4': '1rem' },
      radii: { md: '0.375rem' },
      shadows: { md: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }
    },
    responsive_rules: { breakpoints: {}, overrides: [] },
    interactions: [],
    forms: [],
    authentication: {
      type: 'none',
      roles: [],
      protected_route_patterns: []
    },
    technologies: {},
    seo: { default_title_template: '%s', open_graph: {}, twitter: {}, structured_data: [] },
    analytics: { providers: [], custom_events: [] },
    infrastructure: {
      node_version: '20.x',
      package_manager: 'npm',
      recommended_target: 'static_spa',
      env_variables: [],
      build_command: 'vite build',
      output_directory: 'dist'
    },
    admin_requirements: { entities: [] }
  };
}

/**
 * A scripted engine: returns queued `PipelineResult`s in order. Extra calls
 * replay the last result so a test can assert call counts without crashing.
 */
export function scriptedEngine(
  results: PipelineResult<unknown>[]
): ComponentSynthesisEngine & { tasks: GenerationTask<unknown>[] } {
  const tasks: GenerationTask<unknown>[] = [];
  let index = 0;
  return {
    tasks,
    generate: async <T>(task: GenerationTask<T>): Promise<PipelineResult<T>> => {
      tasks.push(task as GenerationTask<unknown>);
      const result = results[Math.min(index, Math.max(results.length - 1, 0))];
      index += 1;
      return result as PipelineResult<T>;
    }
  };
}

/**
 * An engine that JSON-parses queued strings and validates them against the
 * task's Zod schema, emulating the Phase 10 pipeline's extraction + Zod step.
 */
export function jsonEngine(outputs: string[]): ComponentSynthesisEngine {
  let index = 0;
  return {
    generate: async <T>(task: GenerationTask<T>): Promise<PipelineResult<T>> => {
      const raw = outputs[Math.min(index, outputs.length - 1)] ?? '';
      index += 1;
      try {
        const parsed = JSON.parse(raw) as unknown;
        const result = (task.schema as z.ZodSchema<T>).safeParse(parsed);
        if (result.success) {
          return { ok: true, data: result.data, attempts: 1 };
        }
        return { ok: false, attempts: 1, error: malformed('Schema validation failed') };
      } catch {
        return { ok: false, attempts: 1, error: malformed('Invalid JSON') };
      }
    }
  };
}

function malformed(message: string) {
  return {
    code: 'MALFORMED_OUTPUT' as const,
    category: 'ai' as const,
    message,
    severity: 'error' as const,
    recoverable: true,
    retryable: false,
    suggestedAction: 'Retry',
    timestamp: '2026-10-01T00:00:00.000Z'
  };
}
