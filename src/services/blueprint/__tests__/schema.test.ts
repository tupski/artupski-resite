import { describe, expect, it } from 'vitest';
import {
  BlueprintSchema,
  MAX_COMPONENTS,
  MAX_COMPONENT_DEPTH,
  validateBlueprint
} from '../../../types/blueprint';

/**
 * A fully-populated, schema-valid document assembled from the examples in
 * docs/specs/BLUEPRINT-SPEC.md section 2. It is the positive fixture every
 * rejection test mutates.
 */
function validBlueprint(): Record<string, unknown> {
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
      supported_locales: ['en-US', 'es-ES'],
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
        meta: { description: 'Welcome to Acme', robots: 'index, follow' },
        root_component_ids: ['cmp_hero_01', 'cmp_feature_grid_01']
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
        path: '/dashboard/:teamId',
        page_id: 'page_home',
        auth_required: true,
        allowed_roles: ['admin', 'member'],
        route_params: [{ name: 'teamId', type: 'string', pattern: '^[a-z0-9_-]+$' }],
        redirect_to: null
      }
    ],
    components: [
      {
        id: 'cmp_hero_01',
        name: 'Hero',
        category: 'composite',
        variants: {},
        props: [
          { name: 'title', type: 'string', required: true, default: 'Hello' },
          { name: 'variant', type: 'enum', options: ['primary', 'secondary'], required: false }
        ],
        children_slots: ['default'],
        dependencies: [],
        children: ['cmp_button_primary']
      },
      {
        id: 'cmp_button_primary',
        name: 'Button',
        category: 'ui_primitive',
        variants: { primary: 'bg-sky-500 text-white' },
        props: [],
        children_slots: [],
        dependencies: []
      },
      {
        id: 'cmp_feature_grid_01',
        name: 'Feature Grid',
        category: 'data_display',
        variants: {},
        props: [],
        children_slots: [],
        dependencies: []
      }
    ],
    layout: {
      default_layout_id: 'layout_public',
      definitions: [
        {
          id: 'layout_public',
          name: 'Public Marketing Layout',
          header_component_id: 'cmp_hero_01',
          footer_component_id: null,
          sidebar_component_id: null,
          container_width: 'max-w-7xl',
          body_bg_color: '#ffffff',
          slots: ['header', 'main', 'footer']
        }
      ]
    },
    navigation: {
      primary_menu: [
        {
          id: 'nav_features',
          label: 'Features',
          href: '/features',
          target: '_self',
          children: [{ id: 'nav_feat_sync', label: 'Real-time Sync', href: '/features/sync' }]
        }
      ],
      footer_menu: [{ id: 'nav_legal_privacy', label: 'Privacy Policy', href: '/legal/privacy' }],
      user_menu: [
        { id: 'nav_logout', label: 'Sign Out', action: 'auth.logout', requires_auth: true }
      ]
    },
    content: {
      strings: { 'landing.hero.title': 'Build applications at lightning speed' },
      blocks: [{ id: 'block_privacy_body', type: 'markdown', content: '## Privacy Policy' }]
    },
    assets: {
      images: [
        {
          id: 'img_hero_bg',
          source_url: 'https://example.com/static/hero.webp',
          local_path: 'assets/images/img_hero_bg.webp',
          mime_type: 'image/webp',
          width: 1920,
          height: 1080,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        }
      ],
      icons: [
        {
          id: 'icon_arrow_right',
          type: 'inline_svg',
          svg_content: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>'
        }
      ],
      fonts: [
        {
          family: 'Inter',
          weights: [400, 700],
          styles: ['normal', 'italic'],
          source: 'google_fonts',
          files: ['assets/fonts/inter-latin-400.woff2']
        }
      ]
    },
    design_system: {
      colors: { primary: { '500': '#0ea5e9' }, background: '#ffffff' },
      typography: {
        font_sans: ['Inter', '-apple-system', 'sans-serif'],
        font_mono: ['JetBrains Mono', 'monospace'],
        font_sizes: { base: '1rem' },
        line_heights: { normal: '1.5' }
      },
      spacing: { '4': '1rem' },
      radii: { md: '0.375rem' },
      shadows: { sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }
    },
    responsive_rules: {
      breakpoints: { sm: '640px', md: '768px' },
      overrides: [
        {
          component_id: 'cmp_hero_01',
          breakpoint: 'md',
          action: 'collapse_to_hamburger',
          target_slot: 'mobile_menu'
        }
      ]
    },
    interactions: [
      {
        id: 'int_modal_login',
        trigger_component_id: 'cmp_button_primary',
        event: 'onClick',
        action: 'open_modal',
        target_component_id: 'cmp_hero_01',
        animation: { type: 'fade_and_scale', duration_ms: 200 }
      }
    ],
    forms: [
      {
        id: 'form_contact_sales',
        name: 'Contact Sales Form',
        method: 'POST',
        action_endpoint: '/api/v1/contact',
        fields: [
          {
            name: 'full_name',
            label: 'Full Name',
            type: 'text',
            required: true,
            placeholder: 'Jane Doe',
            validations: [{ rule: 'min_length', value: 2, message: 'Minimum 2 characters' }]
          },
          {
            name: 'company_size',
            label: 'Company Size',
            type: 'select',
            required: true,
            options: [{ label: '1-10 employees', value: '1-10' }]
          }
        ],
        submit_button_label: 'Submit Request',
        success_message: 'Thank you!',
        error_message: 'Failed to submit form.'
      }
    ],
    authentication: {
      type: 'cookie_session',
      login_route: '/login',
      logout_route: '/api/auth/logout',
      dashboard_route: '/dashboard',
      session_storage_type: 'httpOnly_cookie',
      cookie_names: ['session_id'],
      roles: ['guest', 'user', 'admin'],
      protected_route_patterns: ['/dashboard/*']
    },
    technologies: {
      frontend_framework: { name: 'Next.js', version: '14.2.3', confidence: 0.98 },
      ui_libraries: [{ name: 'Tailwind CSS', version: '3.4.1', confidence: 0.95 }],
      runtime: { name: 'Node.js', confidence: 0.85 },
      cdn: { name: 'Cloudflare', confidence: 1 },
      analytics: [{ name: 'Google Analytics 4', id: 'G-XXXXXXX' }]
    },
    seo: {
      default_title_template: '%s | Acme SaaS',
      open_graph: { type: 'website', site_name: 'Acme SaaS' },
      twitter: { card: 'summary_large_image' },
      structured_data: [{ type: 'Organization', data: { '@context': 'https://schema.org' } }]
    },
    analytics: {
      providers: [
        { provider: 'google_tag_manager', container_id: 'GTM-XXXXXX', page_view_tracking: true }
      ],
      custom_events: [
        {
          event_name: 'cta_click',
          trigger_component_id: 'cmp_button_primary',
          parameters: { location: 'hero' }
        }
      ]
    },
    infrastructure: {
      node_version: '20.x',
      package_manager: 'pnpm',
      recommended_target: 'cloudflare_pages',
      env_variables: [
        {
          key: 'DATABASE_URL',
          required: true,
          secret: true,
          description: 'Database connection string'
        }
      ],
      build_command: 'pnpm build',
      output_directory: 'dist'
    },
    admin_requirements: {
      entities: [
        {
          name: 'User',
          plural: 'Users',
          fields: [
            { name: 'id', type: 'string', primary_key: true },
            { name: 'role', type: 'enum', options: ['user', 'admin'] }
          ],
          capabilities: ['create', 'read', 'update', 'delete', 'export_csv']
        }
      ]
    }
  };
}

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validBlueprint())) as Record<string, unknown>;
}

function deleteKey(document: Record<string, unknown>, key: string): void {
  delete document[key];
}

describe('BlueprintSchema - acceptance', () => {
  it('accepts a fully valid document via the schema and the validate helper', () => {
    const document = validBlueprint();
    expect(BlueprintSchema.safeParse(document).success).toBe(true);

    const result = validateBlueprint(document);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blueprint_version).toBe(1);
      expect(result.data.pages).toHaveLength(1);
      expect(result.data.navigation.primary_menu[0]?.children?.[0]?.id).toBe('nav_feat_sync');
    }
  });

  it('accepts a minimal document (empty sections, no technologies)', () => {
    const document = clone();
    document.technologies = {};
    document.pages = [];
    document.routes = [];
    document.components = [];
    document.navigation = { primary_menu: [], footer_menu: [], user_menu: [] };
    document.admin_requirements = { entities: [] };
    const result = validateBlueprint(document);
    expect(result.success).toBe(true);
  });

  it('accepts the optional provenance extension (decision C8)', () => {
    const document = clone();
    document.provenance = {
      observations: [
        { kind: 'design_token', ref: 'colors.background', source: 'css_variable:--background' }
      ],
      inferences: [{ ref: 'cmp_hero_01', method: 'landmark_segmentation', confidence: 0.8 }],
      evidence_summary: {
        pagesConsidered: 1,
        pagesWithEvidence: 1,
        nodesObserved: 42,
        nodesTruncated: 0,
        designTokensObserved: 5,
        designTokensInferred: 1,
        technologiesDetected: 2
      }
    };
    expect(validateBlueprint(document).success).toBe(true);
  });
});

describe('BlueprintSchema - rejection', () => {
  it('rejects an unsupported blueprint_version with UNSUPPORTED_VERSION', () => {
    const document = clone();
    document.blueprint_version = 2;
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('UNSUPPORTED_VERSION');
      expect(result.errors[0]?.path).toBe('blueprint_version');
    }
  });

  it('rejects a missing required section with an actionable path', () => {
    const document = clone();
    deleteKey(document, 'design_system');
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.every((error) => error.code === 'BLUEPRINT_VALIDATION_FAILED')).toBe(
        true
      );
      expect(result.errors.some((error) => error.path.startsWith('design_system'))).toBe(true);
    }
  });

  it('rejects an unknown key under a strict object', () => {
    const document = clone();
    (document.site as Record<string, unknown>).unexpected = true;
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((error) => error.path === 'site')).toBe(true);
    }
  });

  it('rejects a non-slash page path', () => {
    const document = clone();
    (document.pages as Record<string, unknown>[])[0]!.path = 'home';
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((error) => error.path === 'pages.0.path')).toBe(true);
    }
  });

  it('rejects an invalid enum value', () => {
    const document = clone();
    (document.components as Record<string, unknown>[])[0]!.category = 'not_a_category';
    expect(validateBlueprint(document).success).toBe(false);
  });

  it('rejects a malformed URL in source_url', () => {
    const document = clone();
    document.source_url = 'not a url';
    expect(validateBlueprint(document).success).toBe(false);
  });

  it('rejects a non-ISO generated_at', () => {
    const document = clone();
    document.generated_at = '2026-10-01';
    expect(validateBlueprint(document).success).toBe(false);
  });

  it('rejects a navigation item missing its required label (C9 tightening)', () => {
    const document = clone();
    const navigation = document.navigation as Record<string, unknown>;
    navigation.primary_menu = [{ id: 'nav_x' }];
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((error) => error.path === 'navigation.primary_menu.0.label')).toBe(
        true
      );
    }
  });

  it('rejects a component tree deeper than MAX_COMPONENT_DEPTH', () => {
    const document = clone();
    const components: Record<string, unknown>[] = [];
    const depth = MAX_COMPONENT_DEPTH + 2;
    for (let index = 0; index < depth; index += 1) {
      components.push({
        id: `cmp_chain_${index}`,
        name: `Chain ${index}`,
        category: 'composite',
        variants: {},
        props: [],
        children_slots: [],
        dependencies: [],
        children: index < depth - 1 ? [`cmp_chain_${index + 1}`] : []
      });
    }
    document.components = components;
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((error) => error.path === 'components')).toBe(true);
    }
  });

  it('rejects a component reference cycle', () => {
    const document = clone();
    document.components = [
      {
        id: 'cmp_a',
        name: 'A',
        category: 'composite',
        variants: {},
        props: [],
        children_slots: [],
        dependencies: [],
        children: ['cmp_b']
      },
      {
        id: 'cmp_b',
        name: 'B',
        category: 'composite',
        variants: {},
        props: [],
        children_slots: [],
        dependencies: [],
        children: ['cmp_a']
      }
    ];
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((error) => error.message.includes('cycle'))).toBe(true);
    }
  });

  it('rejects an oversized component count', () => {
    const document = clone();
    const components: Record<string, unknown>[] = [];
    for (let index = 0; index < MAX_COMPONENTS + 1; index += 1) {
      components.push({
        id: `cmp_${index}`,
        name: `Component ${index}`,
        category: 'ui_primitive',
        variants: {},
        props: [],
        children_slots: [],
        dependencies: []
      });
    }
    document.components = components;
    const result = validateBlueprint(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((error) => error.path === 'components')).toBe(true);
    }
  });

  it('rejects a non-array document and a primitive', () => {
    expect(validateBlueprint(null).success).toBe(false);
    expect(validateBlueprint('nope').success).toBe(false);
    expect(validateBlueprint([]).success).toBe(false);
  });
});
