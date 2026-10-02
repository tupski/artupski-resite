# Blueprint Specification - Artupski ReSite

Intermediate representation format for reverse-engineered web applications. Bridge between scanner extraction output and downstream generators.

---

## 1. Blueprint Overview & Meta

- Format: JSON document.
- Root version field: `blueprint_version: 1`.
- Purpose: Framework-agnostic description of site structure, design system, component hierarchy, business logic, content, and data models.

```json
{
  "$schema": "https://artupski.com/schemas/blueprint.v1.json",
  "blueprint_version": 1,
  "generated_at": "2026-10-01T00:00:00.000Z",
  "source_url": "https://example.com",
  "generator": {
    "name": "Artupski ReSite Engine",
    "version": "1.0.0"
  },
  "site": {},
  "pages": [],
  "routes": [],
  "components": [],
  "layout": {},
  "navigation": {},
  "content": {},
  "assets": {},
  "design_system": {},
  "responsive_rules": {},
  "interactions": [],
  "forms": [],
  "authentication": {},
  "technologies": {},
  "seo": {},
  "analytics": {},
  "infrastructure": {},
  "admin_requirements": {}
}
```

---

## 2. Mandatory Section Schemas

### 2.1 Site Metadata (`site`)
Global website attributes.

```json
{
  "site": {
    "name": "Acme SaaS Platform",
    "domain": "example.com",
    "canonical_url": "https://example.com",
    "default_locale": "en-US",
    "supported_locales": ["en-US", "es-ES"],
    "direction": "ltr",
    "favicon_url": "assets/favicon.ico",
    "theme_color": "#0ea5e9",
    "description": "Next generation collaborative tool."
  }
}
```

### 2.2 Pages (`pages`)
Page inventory detected across crawl tree.

```json
{
  "pages": [
    {
      "id": "page_home",
      "path": "/",
      "title": "Home - Acme SaaS",
      "layout_id": "layout_public",
      "template": "landing",
      "is_dynamic": false,
      "dynamic_param_names": [],
      "meta": {
        "description": "Welcome to Acme",
        "robots": "index, follow"
      },
      "root_component_ids": ["cmp_hero_01", "cmp_feature_grid_01", "cmp_cta_footer_01"]
    }
  ]
}
```

### 2.3 Routes (`routes`)
Routing topology, route params, redirections, and access guards.

```json
{
  "routes": [
    {
      "path": "/",
      "page_id": "page_home",
      "auth_required": false,
      "allowed_roles": [],
      "redirect_to": null
    },
    {
      "path": "/dashboard/:teamId",
      "page_id": "page_dashboard_team",
      "auth_required": true,
      "allowed_roles": ["admin", "member"],
      "route_params": [
        {
          "name": "teamId",
          "type": "string",
          "pattern": "^[a-z0-9_-]+$"
        }
      ],
      "redirect_to": null
    }
  ]
}
```

### 2.4 Components (`components`)
Semantic component registry. Normalized hierarchy with typed props, variant styles, and slots.

```json
{
  "components": [
    {
      "id": "cmp_button_primary",
      "name": "Button",
      "category": "ui_primitive",
      "variants": {
        "primary": "bg-sky-500 text-white hover:bg-sky-600 px-4 py-2 rounded-md font-medium",
        "secondary": "bg-slate-100 text-slate-900 hover:bg-slate-200 px-4 py-2 rounded-md font-medium",
        "outline": "border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md"
      },
      "props": [
        {
          "name": "label",
          "type": "string",
          "required": true,
          "default": "Click"
        },
        {
          "name": "variant",
          "type": "enum",
          "options": ["primary", "secondary", "outline"],
          "required": false,
          "default": "primary"
        },
        {
          "name": "icon",
          "type": "string",
          "required": false
        }
      ],
      "children_slots": ["default", "icon_slot"],
      "dependencies": []
    }
  ]
}
```

### 2.5 Layout (`layout`)
Global layouts and container shells.

```json
{
  "layout": {
    "default_layout_id": "layout_public",
    "definitions": [
      {
        "id": "layout_public",
        "name": "Public Marketing Layout",
        "header_component_id": "cmp_header_public",
        "footer_component_id": "cmp_footer_public",
        "sidebar_component_id": null,
        "container_width": "max-w-7xl",
        "body_bg_color": "#ffffff",
        "slots": ["header", "main", "footer", "modal_outlet"]
      },
      {
        "id": "layout_app",
        "name": "Dashboard App Layout",
        "header_component_id": "cmp_header_app",
        "footer_component_id": null,
        "sidebar_component_id": "cmp_sidebar_app",
        "container_width": "w-full",
        "body_bg_color": "#0f172a",
        "slots": ["header", "sidebar", "main", "toast_outlet"]
      }
    ]
  }
}
```

### 2.6 Navigation (`navigation`)
Navigation graphs, hierarchy, link items, and auth visibility rules.

```json
{
  "navigation": {
    "primary_menu": [
      {
        "id": "nav_features",
        "label": "Features",
        "href": "/features",
        "target": "_self",
        "children": [
          { "id": "nav_feat_sync", "label": "Real-time Sync", "href": "/features/sync" },
          { "id": "nav_feat_security", "label": "Enterprise Security", "href": "/features/security" }
        ]
      },
      {
        "id": "nav_pricing",
        "label": "Pricing",
        "href": "/pricing",
        "target": "_self",
        "children": []
      }
    ],
    "footer_menu": [
      {
        "id": "nav_legal_privacy",
        "label": "Privacy Policy",
        "href": "/legal/privacy",
        "target": "_self"
      }
    ],
    "user_menu": [
      {
        "id": "nav_profile",
        "label": "Profile Settings",
        "href": "/settings/profile",
        "requires_auth": true
      },
      {
        "id": "nav_logout",
        "label": "Sign Out",
        "action": "auth.logout",
        "requires_auth": true
      }
    ]
  }
}
```

### 2.7 Content (`content`)
Extracted copy, headlines, rich text nodes, and internationalization bundles.

```json
{
  "content": {
    "strings": {
      "landing.hero.title": "Build applications at lighting speed",
      "landing.hero.subtitle": "Turn any existing web application into clean modern React code.",
      "landing.cta.get_started": "Start free trial"
    },
    "blocks": [
      {
        "id": "block_privacy_body",
        "type": "markdown",
        "content": "## Privacy Policy\n\nWe respect your data privacy..."
      }
    ]
  }
}
```

### 2.8 Assets (`assets`)
Asset registry categorized with hashes, MIME types, local paths, and remote source URLs.

```json
{
  "assets": {
    "images": [
      {
        "id": "img_hero_bg",
        "source_url": "https://example.com/static/hero.webp",
        "local_path": "assets/images/img_hero_bg.webp",
        "mime_type": "image/webp",
        "width": 1920,
        "height": 1080,
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      }
    ],
    "icons": [
      {
        "id": "icon_arrow_right",
        "type": "inline_svg",
        "svg_content": "<svg viewBox=\"0 0 24 24\"><path d=\"M5 12h14M12 5l7 7-7 7\"/></svg>"
      }
    ],
    "fonts": [
      {
        "family": "Inter",
        "weights": [400, 500, 600, 700],
        "styles": ["normal", "italic"],
        "source": "google_fonts",
        "files": ["assets/fonts/inter-latin-400.woff2", "assets/fonts/inter-latin-700.woff2"]
      }
    ]
  }
}
```

### 2.9 Design System (`design_system`)
Consolidated design tokens derived from DOM computed styles.

```json
{
  "design_system": {
    "colors": {
      "primary": {
        "50": "#f0f9ff",
        "500": "#0ea5e9",
        "900": "#0c4a6e"
      },
      "background": "#ffffff",
      "foreground": "#0f172a",
      "muted": "#f1f5f9",
      "border": "#e2e8f0"
    },
    "typography": {
      "font_sans": ["Inter", "-apple-system", "sans-serif"],
      "font_mono": ["JetBrains Mono", "monospace"],
      "font_sizes": {
        "xs": "0.75rem",
        "sm": "0.875rem",
        "base": "1rem",
        "lg": "1.125rem",
        "xl": "1.25rem",
        "2xl": "1.5rem",
        "3xl": "1.875rem",
        "4xl": "2.25rem"
      },
      "line_heights": {
        "tight": "1.25",
        "normal": "1.5",
        "relaxed": "1.75"
      }
    },
    "spacing": {
      "1": "0.25rem",
      "2": "0.5rem",
      "4": "1rem",
      "6": "1.5rem",
      "8": "2rem"
    },
    "radii": {
      "sm": "0.125rem",
      "md": "0.375rem",
      "lg": "0.5rem",
      "full": "9999px"
    },
    "shadows": {
      "sm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      "md": "0 4px 6px -1px rgb(0 0 0 / 0.1)",
      "lg": "0 10px 15px -3px rgb(0 0 0 / 0.1)"
    }
  }
}
```

### 2.10 Responsive Rules (`responsive_rules`)
Breakpoint rules and layout adaptations.

```json
{
  "responsive_rules": {
    "breakpoints": {
      "sm": "640px",
      "md": "768px",
      "lg": "1024px",
      "xl": "1280px",
      "2xl": "1536px"
    },
    "overrides": [
      {
        "component_id": "cmp_header_public",
        "breakpoint": "md",
        "action": "collapse_to_hamburger",
        "target_slot": "mobile_menu"
      },
      {
        "component_id": "cmp_feature_grid_01",
        "breakpoint": "sm",
        "action": "change_grid_columns",
        "value": 1
      }
    ]
  }
}
```

### 2.11 Interactions (`interactions`)
Client-side UI states, event bindings, and transitions.

```json
{
  "interactions": [
    {
      "id": "int_modal_login",
      "trigger_component_id": "cmp_btn_open_login",
      "event": "onClick",
      "action": "open_modal",
      "target_component_id": "cmp_modal_login",
      "animation": {
        "type": "fade_and_scale",
        "duration_ms": 200
      }
    },
    {
      "id": "int_accordion_faq",
      "trigger_component_id": "cmp_faq_item_header",
      "event": "onClick",
      "action": "toggle_expanded",
      "target_component_id": "cmp_faq_item_body"
    }
  ]
}
```

### 2.12 Forms (`forms`)
Form specifications with validation rules, payload schemas, and endpoints.

```json
{
  "forms": [
    {
      "id": "form_contact_sales",
      "name": "Contact Sales Form",
      "method": "POST",
      "action_endpoint": "/api/v1/contact",
      "fields": [
        {
          "name": "full_name",
          "label": "Full Name",
          "type": "text",
          "required": true,
          "placeholder": "Jane Doe",
          "validations": [
            { "rule": "min_length", "value": 2, "message": "Minimum 2 characters" },
            { "rule": "max_length", "value": 100, "message": "Maximum 100 characters" }
          ]
        },
        {
          "name": "email",
          "label": "Work Email",
          "type": "email",
          "required": true,
          "placeholder": "jane@company.com",
          "validations": [
            { "rule": "email_format", "message": "Must be valid email" }
          ]
        },
        {
          "name": "company_size",
          "label": "Company Size",
          "type": "select",
          "required": true,
          "options": [
            { "label": "1-10 employees", "value": "1-10" },
            { "label": "11-50 employees", "value": "11-50" },
            { "label": "50+ employees", "value": "50+" }
          ]
        }
      ],
      "submit_button_label": "Submit Request",
      "success_message": "Thank you! Our sales team will reach out within 24 hours.",
      "error_message": "Failed to submit form. Please check your inputs."
    }
  ]
}
```

### 2.13 Authentication (`authentication`)
Detected auth patterns, login mechanisms, and session management.

```json
{
  "authentication": {
    "type": "cookie_session",
    "login_route": "/login",
    "logout_route": "/api/auth/logout",
    "dashboard_route": "/dashboard",
    "session_storage_type": "httpOnly_cookie",
    "cookie_names": ["session_id", "csrf_token"],
    "roles": ["guest", "user", "admin", "super_admin"],
    "protected_route_patterns": ["/dashboard/*", "/settings/*", "/admin/*"]
  }
}
```

### 2.14 Technologies (`technologies`)
Detected stack inventory categorized per [`TECHNOLOGY-DETECTION.md`](TECHNOLOGY-DETECTION.md:1).

```json
{
  "technologies": {
    "frontend_framework": { "name": "Next.js", "version": "14.2.3", "confidence": 0.98 },
    "ui_libraries": [{ "name": "Tailwind CSS", "version": "3.4.1", "confidence": 0.95 }],
    "runtime": { "name": "Node.js", "confidence": 0.85 },
    "cdn": { "name": "Cloudflare", "confidence": 1.0 },
    "analytics": [{ "name": "Google Analytics 4", "id": "G-XXXXXXX" }]
  }
}
```

### 2.15 SEO (`seo`)
Meta tags, OpenGraph attributes, JSON-LD schemas, and robots rules.

```json
{
  "seo": {
    "default_title_template": "%s | Acme SaaS",
    "open_graph": {
      "type": "website",
      "site_name": "Acme SaaS",
      "default_image": "assets/images/og_default.png"
    },
    "twitter": {
      "card": "summary_large_image",
      "site": "@acmesaas",
      "creator": "@acmesaas"
    },
    "structured_data": [
      {
        "type": "Organization",
        "data": {
          "@context": "https://schema.org",
          "@type": "Organization",
          "name": "Acme SaaS Inc.",
          "url": "https://example.com"
        }
      }
    ]
  }
}
```

### 2.16 Analytics (`analytics`)
Analytics provider configurations and tracking hooks.

```json
{
  "analytics": {
    "providers": [
      {
        "provider": "google_tag_manager",
        "container_id": "GTM-XXXXXX",
        "page_view_tracking": true
      }
    ],
    "custom_events": [
      {
        "event_name": "cta_click",
        "trigger_component_id": "cmp_hero_cta_btn",
        "parameters": { "location": "hero", "plan": "trial" }
      }
    ]
  }
}
```

### 2.17 Infrastructure (`infrastructure`)
Target deployment runtime, environment configs, and build instructions.

```json
{
  "infrastructure": {
    "node_version": "20.x",
    "package_manager": "pnpm",
    "recommended_target": "cloudflare_pages",
    "env_variables": [
      { "key": "DATABASE_URL", "required": true, "secret": true, "description": "Database connection string" },
      { "key": "NEXT_PUBLIC_APP_URL", "required": true, "secret": false, "default": "http://localhost:3000" }
    ],
    "build_command": "pnpm build",
    "output_directory": "dist"
  }
}
```

### 2.18 Admin Requirements (`admin_requirements`)
Inferred CRUD entities, data schema, and admin interface requirements.

```json
{
  "admin_requirements": {
    "entities": [
      {
        "name": "User",
        "plural": "Users",
        "fields": [
          { "name": "id", "type": "string", "primary_key": true },
          { "name": "email", "type": "string", "searchable": true },
          { "name": "role", "type": "enum", "options": ["user", "admin"] },
          { "name": "created_at", "type": "datetime", "sortable": true }
        ],
        "capabilities": ["create", "read", "update", "delete", "export_csv"]
      }
    ]
  }
}
```

---

## 3. TypeScript Interfaces

```typescript
export interface BlueprintRoot {
  $schema?: string;
  blueprint_version: 1;
  generated_at: string;
  source_url: string;
  generator: {
    name: string;
    version: string;
  };
  site: BlueprintSite;
  pages: BlueprintPage[];
  routes: BlueprintRoute[];
  components: BlueprintComponent[];
  layout: BlueprintLayout;
  navigation: BlueprintNavigation;
  content: BlueprintContent;
  assets: BlueprintAssets;
  design_system: BlueprintDesignSystem;
  responsive_rules: BlueprintResponsiveRules;
  interactions: BlueprintInteraction[];
  forms: BlueprintForm[];
  authentication: BlueprintAuthentication;
  technologies: BlueprintTechnologies;
  seo: BlueprintSeo;
  analytics: BlueprintAnalytics;
  infrastructure: BlueprintInfrastructure;
  admin_requirements: BlueprintAdminRequirements;
}

export interface BlueprintSite {
  name: string;
  domain: string;
  canonical_url: string;
  default_locale: string;
  supported_locales: string[];
  direction: 'ltr' | 'rtl';
  favicon_url: string;
  theme_color: string;
  description: string;
}

export interface BlueprintPage {
  id: string;
  path: string;
  title: string;
  layout_id: string;
  template: string;
  is_dynamic: boolean;
  dynamic_param_names: string[];
  meta: Record<string, string>;
  root_component_ids: string[];
}

export interface BlueprintRoute {
  path: string;
  page_id: string;
  auth_required: boolean;
  allowed_roles: string[];
  route_params?: {
    name: string;
    type: string;
    pattern?: string;
  }[];
  redirect_to: string | null;
}

export interface BlueprintComponent {
  id: string;
  name: string;
  category: 'ui_primitive' | 'composite' | 'layout' | 'data_display' | 'form';
  variants: Record<string, string>;
  props: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';
    options?: string[];
    required: boolean;
    default?: unknown;
  }[];
  children_slots: string[];
  dependencies: string[];
}

export interface BlueprintLayout {
  default_layout_id: string;
  definitions: {
    id: string;
    name: string;
    header_component_id: string | null;
    footer_component_id: string | null;
    sidebar_component_id: string | null;
    container_width: string;
    body_bg_color: string;
    slots: string[];
  }[];
}

export interface BlueprintNavigation {
  primary_menu: BlueprintNavItem[];
  footer_menu: BlueprintNavItem[];
  user_menu: BlueprintNavItem[];
}

export interface BlueprintNavItem {
  id: string;
  label: string;
  href?: string;
  action?: string;
  target?: '_self' | '_blank';
  requires_auth?: boolean;
  children?: BlueprintNavItem[];
}

export interface BlueprintContent {
  strings: Record<string, string>;
  blocks: {
    id: string;
    type: 'markdown' | 'html' | 'json';
    content: string;
  }[];
}

export interface BlueprintAssets {
  images: {
    id: string;
    source_url: string;
    local_path: string;
    mime_type: string;
    width?: number;
    height?: number;
    sha256: string;
  }[];
  icons: {
    id: string;
    type: 'inline_svg' | 'font_icon' | 'image';
    svg_content?: string;
    glyph_name?: string;
  }[];
  fonts: {
    family: string;
    weights: number[];
    styles: string[];
    source: 'google_fonts' | 'custom_file' | 'system';
    files?: string[];
  }[];
}

export interface BlueprintDesignSystem {
  colors: Record<string, string | Record<string, string>>;
  typography: {
    font_sans: string[];
    font_mono: string[];
    font_sizes: Record<string, string>;
    line_heights: Record<string, string>;
  };
  spacing: Record<string, string>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
}

export interface BlueprintResponsiveRules {
  breakpoints: Record<string, string>;
  overrides: {
    component_id: string;
    breakpoint: string;
    action: string;
    value?: unknown;
    target_slot?: string;
  }[];
}

export interface BlueprintInteraction {
  id: string;
  trigger_component_id: string;
  event: string;
  action: string;
  target_component_id?: string;
  animation?: {
    type: string;
    duration_ms: number;
  };
}

export interface BlueprintForm {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  action_endpoint: string;
  fields: {
    name: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    options?: { label: string; value: string }[];
    validations?: { rule: string; value?: unknown; message: string }[];
  }[];
  submit_button_label: string;
  success_message?: string;
  error_message?: string;
}

export interface BlueprintAuthentication {
  type: 'none' | 'jwt' | 'cookie_session' | 'oauth' | 'basic';
  login_route?: string;
  logout_route?: string;
  dashboard_route?: string;
  session_storage_type?: string;
  cookie_names?: string[];
  roles: string[];
  protected_route_patterns: string[];
}

export interface BlueprintTechnologies {
  frontend_framework?: { name: string; version?: string; confidence: number };
  ui_libraries?: { name: string; version?: string; confidence: number }[];
  runtime?: { name: string; confidence: number };
  cdn?: { name: string; confidence: number };
  analytics?: { name: string; id?: string }[];
}

export interface BlueprintSeo {
  default_title_template: string;
  open_graph: Record<string, string>;
  twitter: Record<string, string>;
  structured_data: { type: string; data: Record<string, unknown> }[];
}

export interface BlueprintAnalytics {
  providers: {
    provider: string;
    container_id?: string;
    page_view_tracking: boolean;
  }[];
  custom_events: {
    event_name: string;
    trigger_component_id: string;
    parameters: Record<string, unknown>;
  }[];
}

export interface BlueprintInfrastructure {
  node_version: string;
  package_manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  recommended_target: 'vercel' | 'cloudflare_pages' | 'netlify' | 'docker' | 'static_spa';
  env_variables: {
    key: string;
    required: boolean;
    secret: boolean;
    default?: string;
    description: string;
  }[];
  build_command: string;
  output_directory: string;
}

export interface BlueprintAdminRequirements {
  entities: {
    name: string;
    plural: string;
    fields: {
      name: string;
      type: string;
      primary_key?: boolean;
      searchable?: boolean;
      sortable?: boolean;
      options?: string[];
    }[];
    capabilities: ('create' | 'read' | 'update' | 'delete' | 'export_csv')[];
  }[];
}
```

---

## 4. Blueprint Validation Engine

Zod runtime validation validates parsed data prior to persistence or generator ingestion.

```typescript
import { z } from 'zod';

export const BlueprintSchema = z.object({
  blueprint_version: z.literal(1),
  generated_at: z.string().datetime(),
  source_url: z.string().url(),
  generator: z.object({
    name: z.string().min(1),
    version: z.string().min(1)
  }),
  site: z.object({
    name: z.string().min(1),
    domain: z.string().min(1),
    canonical_url: z.string().url(),
    default_locale: z.string().min(2),
    supported_locales: z.array(z.string()),
    direction: z.enum(['ltr', 'rtl']),
    favicon_url: z.string(),
    theme_color: z.string(),
    description: z.string()
  }),
  pages: z.array(z.object({
    id: z.string().min(1),
    path: z.string().startsWith('/'),
    title: z.string(),
    layout_id: z.string(),
    template: z.string(),
    is_dynamic: z.boolean(),
    dynamic_param_names: z.array(z.string()),
    meta: z.record(z.string()),
    root_component_ids: z.array(z.string())
  })),
  routes: z.array(z.object({
    path: z.string().startsWith('/'),
    page_id: z.string(),
    auth_required: z.boolean(),
    allowed_roles: z.array(z.string()),
    route_params: z.array(z.object({
      name: z.string(),
      type: z.string(),
      pattern: z.string().optional()
    })).optional(),
    redirect_to: z.string().nullable()
  })),
  components: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(['ui_primitive', 'composite', 'layout', 'data_display', 'form']),
    variants: z.record(z.string()),
    props: z.array(z.object({
      name: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'enum', 'object', 'array']),
      options: z.array(z.string()).optional(),
      required: z.boolean(),
      default: z.unknown().optional()
    })),
    children_slots: z.array(z.string()),
    dependencies: z.array(z.string())
  })),
  layout: z.object({
    default_layout_id: z.string(),
    definitions: z.array(z.object({
      id: z.string(),
      name: z.string(),
      header_component_id: z.string().nullable(),
      footer_component_id: z.string().nullable(),
      sidebar_component_id: z.string().nullable(),
      container_width: z.string(),
      body_bg_color: z.string(),
      slots: z.array(z.string())
    }))
  }),
  navigation: z.object({
    primary_menu: z.array(z.any()),
    footer_menu: z.array(z.any()),
    user_menu: z.array(z.any())
  }),
  content: z.object({
    strings: z.record(z.string()),
    blocks: z.array(z.object({
      id: z.string(),
      type: z.enum(['markdown', 'html', 'json']),
      content: z.string()
    }))
  }),
  assets: z.object({
    images: z.array(z.object({
      id: z.string(),
      source_url: z.string(),
      local_path: z.string(),
      mime_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      sha256: z.string()
    })),
    icons: z.array(z.object({
      id: z.string(),
      type: z.enum(['inline_svg', 'font_icon', 'image']),
      svg_content: z.string().optional(),
      glyph_name: z.string().optional()
    })),
    fonts: z.array(z.object({
      family: z.string(),
      weights: z.array(z.number()),
      styles: z.array(z.string()),
      source: z.enum(['google_fonts', 'custom_file', 'system']),
      files: z.array(z.string()).optional()
    }))
  }),
  design_system: z.object({
    colors: z.record(z.union([z.string(), z.record(z.string())])),
    typography: z.object({
      font_sans: z.array(z.string()),
      font_mono: z.array(z.string()),
      font_sizes: z.record(z.string()),
      line_heights: z.record(z.string())
    }),
    spacing: z.record(z.string()),
    radii: z.record(z.string()),
    shadows: z.record(z.string())
  }),
  responsive_rules: z.object({
    breakpoints: z.record(z.string()),
    overrides: z.array(z.object({
      component_id: z.string(),
      breakpoint: z.string(),
      action: z.string(),
      value: z.unknown().optional(),
      target_slot: z.string().optional()
    }))
  }),
  interactions: z.array(z.object({
    id: z.string(),
    trigger_component_id: z.string(),
    event: z.string(),
    action: z.string(),
    target_component_id: z.string().optional(),
    animation: z.object({
      type: z.string(),
      duration_ms: z.number()
    }).optional()
  })),
  forms: z.array(z.object({
    id: z.string(),
    name: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
    action_endpoint: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      type: z.string(),
      required: z.boolean(),
      placeholder: z.string().optional(),
      options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
      validations: z.array(z.object({
        rule: z.string(),
        value: z.unknown().optional(),
        message: z.string()
      })).optional()
    })),
    submit_button_label: z.string(),
    success_message: z.string().optional(),
    error_message: z.string().optional()
  })),
  authentication: z.object({
    type: z.enum(['none', 'jwt', 'cookie_session', 'oauth', 'basic']),
    login_route: z.string().optional(),
    logout_route: z.string().optional(),
    dashboard_route: z.string().optional(),
    session_storage_type: z.string().optional(),
    cookie_names: z.array(z.string()).optional(),
    roles: z.array(z.string()),
    protected_route_patterns: z.array(z.string())
  }),
  technologies: z.object({
    frontend_framework: z.object({ name: z.string(), version: z.string().optional(), confidence: z.number() }).optional(),
    ui_libraries: z.array(z.object({ name: z.string(), version: z.string().optional(), confidence: z.number() })).optional(),
    runtime: z.object({ name: z.string(), confidence: z.number() }).optional(),
    cdn: z.object({ name: z.string(), confidence: z.number() }).optional(),
    analytics: z.array(z.object({ name: z.string(), id: z.string().optional() })).optional()
  }),
  seo: z.object({
    default_title_template: z.string(),
    open_graph: z.record(z.string()),
    twitter: z.record(z.string()),
    structured_data: z.array(z.object({ type: z.string(), data: z.record(z.unknown()) }))
  }),
  analytics: z.object({
    providers: z.array(z.object({
      provider: z.string(),
      container_id: z.string().optional(),
      page_view_tracking: z.boolean()
    })),
    custom_events: z.array(z.object({
      event_name: z.string(),
      trigger_component_id: z.string(),
      parameters: z.record(z.unknown())
    }))
  }),
  infrastructure: z.object({
    node_version: z.string(),
    package_manager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
    recommended_target: z.enum(['vercel', 'cloudflare_pages', 'netlify', 'docker', 'static_spa']),
    env_variables: z.array(z.object({
      key: z.string(),
      required: z.boolean(),
      secret: z.boolean(),
      default: z.string().optional(),
      description: z.string()
    })),
    build_command: z.string(),
    output_directory: z.string()
  }),
  admin_requirements: z.object({
    entities: z.array(z.object({
      name: z.string(),
      plural: z.string(),
      fields: z.array(z.object({
        name: z.string(),
        type: z.string(),
        primary_key: z.boolean().optional(),
        searchable: z.boolean().optional(),
        sortable: z.boolean().optional(),
        options: z.array(z.string()).optional()
      })),
      capabilities: z.array(z.enum(['create', 'read', 'update', 'delete', 'export_csv']))
    }))
  })
});
```

---

## 5. Blueprint Migration Strategy

When schema evolutions occur (`v1 -> v2`), transformation pipeline updates legacy documents sequentially.

### 5.1 Version Detection & Dispatch
Pipeline examines root integer property `blueprint_version`.

```typescript
export interface BlueprintMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (input: unknown) => Promise<unknown>;
}

export class BlueprintMigrationRunner {
  private migrations: Map<number, BlueprintMigration> = new Map();

  register(migration: BlueprintMigration): void {
    this.migrations.set(migration.fromVersion, migration);
  }

  async migrateToLatest(blueprintDoc: Record<string, unknown>, targetVersion: number): Promise<Record<string, unknown>> {
    let currentVersion = (blueprintDoc.blueprint_version as number) || 1;
    let doc = { ...blueprintDoc };

    while (currentVersion < targetVersion) {
      const migration = this.migrations.get(currentVersion);
      if (!migration) {
        throw new Error(`Missing migration definition from version ${currentVersion} to ${currentVersion + 1}`);
      }
      doc = (await migration.migrate(doc)) as Record<string, unknown>;
      currentVersion = doc.blueprint_version as number;
    }

    return doc;
  }
}
```

### 5.2 Migration Contract Rules
1. **Never mutate in place**: Return deep clone of transformed object.
2. **Deterministic defaults**: When new mandatory keys are added in `v2`, assign safe defaults based on inferred legacy values.
3. **Lossless conversion**: Preserve unhandled legacy fields under internal metadata namespace `_v1_legacy_props` to prevent data loss.
4. **Validation re-run**: After executing migration chain, pass migrated document through target version's Zod validator. If validation fails, abort without overwriting disk state.

---

## 6. As-built clarifications (Phase 9)

The Phase 9 implementation (`src/types/blueprint.ts`) mirrors §3/§4 exactly, with two additive clarifications recorded here (resolved as open decisions **C8**/**C9** in `docs/impl-plan/phase-9-impl-plan.md` §15). Neither weakens a required field, and the JSON shape is unchanged, so every document valid under §3/§4 remains valid.

- **C9 - navigation items**: §4 types `navigation.primary_menu`/`footer_menu`/`user_menu` as `z.array(z.any())`, which is a validator omission; §2.6 and §3 type them as `BlueprintNavItem[]`. The implementation validates them with a concrete `BlueprintNavItemSchema` (with a bounded nesting depth). This is strictly stronger than `z.any()` and cannot reject a valid §2.6/§3 document.
- **C8 - provenance**: an **optional, additive** `provenance` namespace (observations / inferences / evidence summary) and optional per-node `confidence` distinguish observed evidence from inferred semantic classification. They are absent from the required schema; documents without them still validate, and no required field is loosened.
