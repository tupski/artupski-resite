/**
 * Phase 12 test fixtures - Artupski ReSite
 *
 * Deterministic, schema-valid Blueprint documents plus Phase 11 components,
 * hooks, and assets used across the project-generator suites. No filesystem and
 * no network: tests write into a per-case temp directory via `node:fs`.
 */
import type { Blueprint } from '../../../types/blueprint';
import type { SynthesizedComponent } from '../../../types/componentSynth';
import type { GeneratedHook, ProjectAssetInput } from '../../../types/projectGen';

const BUTTON_CODE = `interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, variant = 'primary' }: ButtonProps) {
  const styles = variant === 'primary' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-900';
  return (
    <button type="button" className={styles}>
      {label}
    </button>
  );
}
`;

const HERO_CODE = `interface HeroProps {
  title: string;
}

export function Hero({ title }: HeroProps) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <h1 className="text-3xl font-bold">{title}</h1>
    </section>
  );
}
`;

/** A Phase 11 synthesized component valid as generator input. */
export function synthesizedComponent(
  overrides: Partial<SynthesizedComponent> = {}
): SynthesizedComponent {
  return {
    componentId: 'cmp_button_primary',
    name: 'Button',
    fileName: 'Button.tsx',
    code: BUTTON_CODE,
    category: 'ui_primitive',
    variantKeys: ['primary', 'secondary'],
    ...overrides
  };
}

/** A second, distinct synthesized component. */
export function heroComponent(): SynthesizedComponent {
  return {
    componentId: 'cmp_hero_01',
    name: 'Hero',
    fileName: 'Hero.tsx',
    code: HERO_CODE,
    category: 'composite',
    variantKeys: []
  };
}

/** A hook source ready to write under `src/hooks`. */
export function counterHook(): GeneratedHook {
  return {
    name: 'useCounter',
    fileName: 'useCounter.ts',
    code: `import { useCallback, useState } from 'react';

export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  const increment = useCallback(() => setCount((value) => value + 1), []);
  return { count, increment };
}
`
  };
}

/** A tiny PNG asset (bytes need not be a real image for assembly tests). */
export function logoAsset(): ProjectAssetInput {
  return {
    id: 'asset_logo',
    path: 'assets/logo.png',
    mimeType: 'image/png',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  };
}

/**
 * A fully schema-valid Blueprint with two pages, two routes, two components, one
 * image asset, and a populated design system - the canonical Phase 12 fixture.
 */
export function phase12Blueprint(): Blueprint {
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
        title: 'Home',
        layout_id: 'layout_public',
        template: 'landing',
        is_dynamic: false,
        dynamic_param_names: [],
        meta: {},
        root_component_ids: ['cmp_hero_01', 'cmp_button_primary']
      },
      {
        id: 'page_about',
        path: '/about',
        title: 'About Us',
        layout_id: 'layout_public',
        template: 'page',
        is_dynamic: false,
        dynamic_param_names: [],
        meta: {},
        root_component_ids: []
      }
    ],
    routes: [
      {
        path: '/',
        page_id: 'page_home',
        auth_required: false,
        allowed_roles: [],
        redirect_to: null
      },
      {
        path: '/about',
        page_id: 'page_about',
        auth_required: false,
        allowed_roles: [],
        redirect_to: null
      }
    ],
    components: [
      {
        id: 'cmp_hero_01',
        name: 'Hero',
        category: 'composite',
        variants: {},
        props: [{ name: 'title', type: 'string', required: true, default: 'Hello' }],
        children_slots: ['default'],
        dependencies: [],
        children: ['cmp_button_primary']
      },
      {
        id: 'cmp_button_primary',
        name: 'Button',
        category: 'ui_primitive',
        variants: { primary: 'bg-sky-500 text-white', secondary: 'bg-slate-100 text-slate-900' },
        props: [
          { name: 'label', type: 'string', required: true, default: 'Click' },
          { name: 'variant', type: 'enum', options: ['primary', 'secondary'], required: false }
        ],
        children_slots: ['default'],
        dependencies: []
      }
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
    assets: {
      images: [
        {
          id: 'asset_logo',
          source_url: 'https://example.com/logo.png',
          local_path: 'assets/logo.png',
          mime_type: 'image/png',
          sha256: '0000000000000000000000000000000000000000000000000000000000000000'
        }
      ],
      icons: [],
      fonts: []
    },
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
    authentication: { type: 'none', roles: [], protected_route_patterns: [] },
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
