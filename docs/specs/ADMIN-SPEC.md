# Admin Subsystem Specification - Artupski ReSite

Technical specification for inferred backoffice content management, entity management, and administration generators.

---

## 1. Post-MVP Classification & Decoupling Architecture

> [!IMPORTANT]
> **DEVELOPMENT TIMELINE NOTICE**:
> The automatic synthesis of administrative dashboards and live backoffice management panels is explicitly classified as a **POST-MVP** capability.
>
> In the MVP phase:
> 1. The Scanner and AI Engine extract and record admin requirements inside the `admin_requirements` block of [`BLUEPRINT-SPEC.md`](BLUEPRINT-SPEC.md:1).
> 2. The Project Generator outputs administrative markdown specifications (`ADMIN-SPEC.md`) for target codebases.
> 3. Automatic runtime code generation of complete admin panels (CRUD interfaces, RBAC management, media libraries) will be implemented in subsequent releases without requiring changes to the core Scanner engine.

```
                    +--------------------------------+
                    |         Website Crawl          |
                    +---------------+----------------+
                                    │
                                    ▼
                    +--------------------------------+
                    |    Blueprint Ingestion Layer   |
                    |    (admin_requirements JSON)   |
                    +---------------+----------------+
                                    │
               ┌────────────────────┴────────────────────┐
               ▼ (MVP Phase)                             ▼ (Post-MVP Phase)
+-------------------------------+         +-------------------------------+
|  ADMIN-SPEC.md Doc Generation |         |  Full Admin UI Synthesizer    |
|  - Entity relationship specs  |         |  - CRUD View Generators       |
|  - Inferred permission models |         |  - RBAC Middleware Hooks      |
|  - Field definitions & hooks  |         |  - Data Table / Form Layouts  |
+-------------------------------+         +-------------------------------+
```

---

## 2. Architectural Bridge: Blueprint to Admin UI

The translation bridge converts inferred public site data models and forms into administrative backoffice components:

```
[Blueprint Data Schema] ──► [Inferred Content Model] ──► [Admin Spec] ──► [Database Schema] ──► [Admin UI Engine]
```

1. **Blueprint Data Schema**: Crawled entity data, form fields, and dynamic page routes.
2. **Inferred Content Model**: Normalized entity representations (e.g., `Post`, `Product`, `Lead`, `Testimonial`).
3. **Admin Spec**: Action capabilities (`create`, `read`, `update`, `delete`, `export_csv`, `bulk_status`).
4. **Database Schema**: SQL/Prisma/Eloquent schema migrations with validation constraints.
5. **Admin UI Engine**: Generated tabular views, form builders, and filtering interfaces.

---

## 3. Anticipated Administration Domains & Capabilities

The post-MVP admin generator will synthesize management interfaces for 11 core application domains:

### 3.1 Domain Breakdown Matrix

| Domain | Inferred Source Data | Generated Admin Interface Capabilities |
| :--- | :--- | :--- |
| **Pages** | Discovered routes, static templates | Page title, slug, metadata editor, layout selector |
| **Navigation** | Detected `<nav>`, header/footer links | Menu hierarchy reordering (drag-and-drop), link targets |
| **Blog / Articles** | Dynamic `/blog/*` posts, article cards | Rich text / markdown editor, category picker, publish scheduler |
| **Products / Catalog** | E-commerce items, pricing tables | SKU, price, variant attributes, inventory counters, image galleries |
| **Testimonials** | Review cards, customer quotes | Quote text, author name, avatar image upload, rating score (1-5) |
| **Forms & Inquiries** | Detected contact/lead forms, inputs | Form submissions table, CSV export, email notification triggers |
| **Media Library** | Downloaded images, SVGs, documents | Asset grid, alt-text editor, file size optimizer, URL copy |
| **Users & Roles** | Inferred auth routes & protected areas | User table, role assignments (`Admin`, `Editor`, `Viewer`), session resets |
| **Settings** | Favicons, theme colors, site titles | General site config, contact info, social links, tracking codes |
| **SEO Management** | Meta tags, OpenGraph data, sitemaps | Canonical overrides, robot directives, automated sitemap.xml generator |
| **Analytics & Logs** | Trackers, error logs, submission rates | Activity stream, form conversion rates, system health dashboard |

---

## 4. Blueprint Schema Extensions for Admin Support

To guarantee forward compatibility without requiring modifications to the scanner in post-MVP releases, [`BLUEPRINT-SPEC.md`](BLUEPRINT-SPEC.md:1) includes the extended `admin_requirements` definition:

```typescript
import { z } from 'zod';

export const AdminFieldSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.enum([
    'string',
    'number',
    'boolean',
    'richtext',
    'markdown',
    'image',
    'datetime',
    'enum',
    'relation'
  ]),
  required: z.boolean().default(false),
  primary_key: z.boolean().optional(),
  searchable: z.boolean().default(true),
  sortable: z.boolean().default(true),
  options: z.array(z.string()).optional(),
  relation_target: z.string().optional() // References another entity name
});

export const AdminEntitySchema = z.object({
  name: z.string(),
  plural: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  fields: z.array(AdminFieldSchema),
  capabilities: z.array(
    z.enum(['create', 'read', 'update', 'delete', 'export_csv', 'bulk_update', 'duplicate'])
  ),
  default_sort_field: z.string().optional(),
  default_sort_order: z.enum(['asc', 'desc']).default('desc')
});

export const AdminRequirementsSchema = z.object({
  entities: z.array(AdminEntitySchema),
  navigation_groups: z.array(
    z.object({
      label: z.string(),
      entities: z.array(z.string())
    })
  ).optional(),
  role_definitions: z.array(
    z.object({
      role: z.string(),
      permissions: z.array(z.string())
    })
  ).optional()
});
```

---

## 5. Clean Decoupling & Incremental Migration

1. **Independent Module Boundaries**:
   - The admin generator functions as an optional consumer plugin.
   - Core project generation (public pages, design system, static clone) operates 100% independently of admin synthesis.
2. **Schema Non-Breaking Guarantee**:
   - The presence or absence of `admin_requirements` in legacy Blueprint documents does not break standard site generators; if absent, admin generation gracefully skips without throwing errors.
3. **Future Extension Path**:
   - Post-MVP updates will attach admin UI generator packages (e.g., `@artupski/generator-admin-react` or `@artupski/generator-filament-laravel`) directly to the project export screen.
