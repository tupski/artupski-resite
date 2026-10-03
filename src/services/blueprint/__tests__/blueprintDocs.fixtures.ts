/**
 * Blueprint documentation test fixtures - Artupski ReSite
 *
 * A deterministic, schema-valid Blueprint rich enough to exercise every
 * required document AND every optional-document relevance rule. No network and
 * no filesystem: the docs generator is pure except for the injected AI engine.
 */
import type { Blueprint } from '../../../types/blueprint';

/**
 * A fully schema-valid Blueprint with auth, admin entities, forms with
 * endpoints, assets, technologies, and infrastructure signals.
 */
export function docsBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  const base: Blueprint = {
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
        root_component_ids: ['cmp_hero_01']
      },
      {
        id: 'page_dashboard',
        path: '/dashboard/:teamId',
        title: 'Dashboard',
        layout_id: 'layout_app',
        template: 'app',
        is_dynamic: true,
        dynamic_param_names: ['teamId'],
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
        path: '/dashboard/:teamId',
        page_id: 'page_dashboard',
        auth_required: true,
        allowed_roles: ['admin', 'member'],
        route_params: [{ name: 'teamId', type: 'string', pattern: '^[a-z0-9_-]+$' }],
        redirect_to: null
      }
    ],
    components: [
      {
        id: 'cmp_button_primary',
        name: 'Button',
        category: 'ui_primitive',
        variants: {
          primary: 'bg-sky-500 text-white px-4 py-2 rounded-md',
          secondary: 'bg-slate-100 text-slate-900 px-4 py-2 rounded-md'
        },
        props: [
          { name: 'label', type: 'string', required: true, default: 'Click' },
          { name: 'variant', type: 'enum', options: ['primary', 'secondary'], required: false }
        ],
        children_slots: ['default'],
        dependencies: []
      },
      {
        id: 'cmp_hero_01',
        name: 'Hero',
        category: 'composite',
        variants: {},
        props: [{ name: 'title', type: 'string', required: true, default: 'Hello' }],
        children_slots: ['default'],
        dependencies: [],
        children: ['cmp_button_primary']
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
    navigation: {
      primary_menu: [
        { id: 'nav_features', label: 'Features', href: '/features', target: '_self', children: [] },
        { id: 'nav_pricing', label: 'Pricing', href: '/pricing', target: '_self', children: [] }
      ],
      footer_menu: [],
      user_menu: []
    },
    content: {
      strings: {
        'landing.hero.title': 'Build applications at lightning speed',
        'landing.cta.get_started': 'Start free trial'
      },
      blocks: []
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
      icons: [{ id: 'icon_arrow_right', type: 'inline_svg', svg_content: '<svg></svg>' }],
      fonts: [
        {
          family: 'Inter',
          weights: [400, 700],
          styles: ['normal'],
          source: 'google_fonts',
          files: ['assets/fonts/inter-latin-400.woff2']
        }
      ]
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
        font_sizes: { sm: '0.875rem', base: '1rem' },
        line_heights: { normal: '1.5' }
      },
      spacing: { '2': '0.5rem', '4': '1rem' },
      radii: { md: '0.375rem' },
      shadows: { md: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }
    },
    responsive_rules: {
      breakpoints: { sm: '640px', md: '768px' },
      overrides: [
        { component_id: 'cmp_hero_01', breakpoint: 'sm', action: 'change_grid_columns', value: 1 }
      ]
    },
    interactions: [
      {
        id: 'int_modal_login',
        trigger_component_id: 'cmp_button_primary',
        event: 'onClick',
        action: 'open_modal',
        target_component_id: 'cmp_hero_01'
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
            name: 'email',
            label: 'Work Email',
            type: 'email',
            required: true,
            validations: [{ rule: 'email_format', message: 'Must be valid email' }]
          },
          { name: 'password', label: 'Password', type: 'password', required: true }
        ],
        submit_button_label: 'Submit Request',
        success_message: 'Thank you!'
      }
    ],
    authentication: {
      type: 'cookie_session',
      login_route: '/login',
      logout_route: '/api/auth/logout',
      dashboard_route: '/dashboard',
      session_storage_type: 'httpOnly_cookie',
      cookie_names: ['session_id', 'csrf_token'],
      roles: ['guest', 'user', 'admin'],
      protected_route_patterns: ['/dashboard/*', '/settings/*']
    },
    technologies: {
      frontend_framework: { name: 'Next.js', version: '14.2.3', confidence: 0.98 },
      ui_libraries: [{ name: 'Tailwind CSS', version: '3.4.1', confidence: 0.95 }],
      runtime: { name: 'Node.js', confidence: 0.85 },
      cdn: { name: 'Cloudflare', confidence: 1.0 }
    },
    seo: {
      default_title_template: '%s | Acme SaaS',
      open_graph: {},
      twitter: {},
      structured_data: []
    },
    analytics: {
      providers: [{ provider: 'google_tag_manager', container_id: 'GTM-XXXXXX', page_view_tracking: true }],
      custom_events: []
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
            { name: 'email', type: 'string', searchable: true },
            { name: 'role', type: 'enum', options: ['user', 'admin'] },
            { name: 'created_at', type: 'datetime', sortable: true }
          ],
          capabilities: ['create', 'read', 'update', 'delete']
        }
      ]
    }
  };
  return { ...base, ...overrides };
}

/** A minimal Blueprint with no optional-relevance signals. */
export function minimalBlueprint(): Blueprint {
  const base = docsBlueprint();
  return {
    ...base,
    authentication: { type: 'none', roles: [], protected_route_patterns: [] },
    forms: [],
    admin_requirements: { entities: [] },
    technologies: {},
    infrastructure: {
      node_version: '',
      package_manager: 'npm',
      recommended_target: 'static_spa',
      env_variables: [],
      build_command: '',
      output_directory: ''
    },
    routes: base.routes.map((route) => ({ ...route, auth_required: false, allowed_roles: [] }))
  };
}
