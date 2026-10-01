# Project Generator Specification - Artupski ReSite

Technical specification for synthesizing complete, production-ready codebases and standardized documentation from a Website Blueprint.

---

## 1. Project Generation Architecture

The Project Generator consumes a validated `blueprint.json` document and user-selected framework preferences to generate clean, maintainable project source code and comprehensive markdown technical documentation.

```
                          +------------------------+
                          |     blueprint.json     |
                          +-----------+------------+
                                      │
                                      ▼
                      +--------------------------------+
                      |    ProjectGenerator Engine     |
                      |   - Target Framework Adapter   |
                      |   - Template Engine (Handlebars|
                      |   - AST Synthesis & Formatting |
                      +---------------+----------------+
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
+-----------------------------+               +-----------------------------+
|    Full Codebase Output     |               |  Project Documentation Set  |
|  - Next.js / Laravel / Etc  |               |  - PRD, PLAN, ARCHITECTURE  |
|  - package.json / composer  |               |  - DATABASE, UI-SPEC, etc.  |
|  - Components, Pages, State |               |  - 11 Standardized Specs    |
+-----------------------------+               +-----------------------------+
```

---

## 2. Target Framework Adapters

Project generation uses decoupled target adapters to emit idiomatic structure and configuration files for specific tech stacks.

### 2.1 Next.js Target (TypeScript, Tailwind, App Router)

- **Target Archetype**: Next.js 14+ / 15 with React Server Components, TypeScript strict mode, and Tailwind CSS.
- **Directory Layout**:
  ```
  generated-nextjs/
  ├── app/
  │   ├── layout.tsx              # Root HTML wrapper with design system fonts
  │   ├── page.tsx                # Landing route (/)
  │   ├── globals.css             # Tailwind @tailwind imports & root variables
  │   ├── (auth)/                 # Route groups for detected auth flows
  │   │   └── login/page.tsx
  │   └── [slug]/page.tsx         # Inferred dynamic routes
  ├── components/
  │   ├── ui/                     # Primitives (Button, Modal, Input, Badge)
  │   └── sections/               # Composite sections (Hero, Navbar, Features, Footer)
  ├── lib/
  │   ├── utils.ts                # cn() class merge helper (clsx + tailwind-merge)
  │   └── types.ts                # TypeScript interfaces mapped from Blueprint
  ├── public/
  │   └── assets/                 # Remapped image and SVG assets
  ├── package.json
  ├── tsconfig.json
  ├── tailwind.config.ts
  └── next.config.mjs
  ```

- **Manifest Generation (`package.json`)**:
  ```json
  {
    "name": "resite-generated-app",
    "version": "0.1.0",
    "private": true,
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "next lint"
    },
    "dependencies": {
      "next": "^14.2.15",
      "react": "^18.3.1",
      "react-dom": "^18.3.1",
      "lucide-react": "^0.453.0",
      "clsx": "^2.1.1",
      "tailwind-merge": "^2.5.4",
      "zod": "^3.23.8"
    },
    "devDependencies": {
      "typescript": "^5.6.3",
      "@types/node": "^22.7.5",
      "@types/react": "^18.3.11",
      "@types/react-dom": "^18.3.0",
      "postcss": "^8.4.47",
      "tailwindcss": "^3.4.13"
    }
  }
  ```

---

### 2.2 Laravel Target (Blade/Livewire, Tailwind)

- **Target Archetype**: Laravel 11.x, Blade templates or Livewire components, Vite, and Tailwind CSS.
- **Directory Layout**:
  ```
  generated-laravel/
  ├── app/
  │   ├── Http/Controllers/      # Inferred route controllers
  │   └── Models/                # Inferred database models
  ├── resources/
  │   ├── views/
  │   │   ├── layouts/app.blade.php
  │   │   ├── components/        # Blade UI components
  │   │   └── pages/             # Page views
  │   ├── css/app.css
  │   └── js/app.js
  ├── routes/
  │   └── web.php                # Web routes mapped from Blueprint routes
  ├── composer.json
  ├── vite.config.js
  └── tailwind.config.js
  ```

- **Manifest Generation (`composer.json`)**:
  ```json
  {
    "name": "resite/generated-laravel-app",
    "type": "project",
    "require": {
      "php": "^8.2",
      "laravel/framework": "^11.0"
    },
    "require-dev": {
      "fakerphp/faker": "^1.23",
      "mockery/mockery": "^1.6",
      "nunomaduro/collision": "^8.0",
      "phpunit/phpunit": "^11.0"
    }
  }
  ```

---

### 2.3 Custom Stack Template Adapter

Permits injecting user-defined directory trees and string replacement templates configured via a JSON manifest (`custom-template.json`).

---

## 3. Project Documentation Generator

The generator automatically authors 11 comprehensive Markdown specifications directly inside the generated repository's root, mirroring Artupski's rigorous documentation framework.

### 3.1 Generated Documentation Manifest

1. [`PRD.md`](../product/PRD.md:1): High-level product requirements, target audience, and business intent synthesized from crawl data.
2. [`PLAN.md`](../product/PLAN.md:1): Phased rollout, sprint milestones, and development execution roadmap.
3. [`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md:1): System topology, folder layouts, and layer separation.
4. [`DATABASE.md`](../architecture/DATABASE.md:1): Inferred schema definitions, tables, relations, and index strategies.
5. `UI-SPEC.md`: Screen specifications, design tokens, color palette, and component hierarchy.
6. `ADMIN-SPEC.md`: Backoffice entity CRUD requirements and management specifications.
7. `API-SPEC.md`: Endpoint specifications, payload schemas, and mock contract stubs.
8. `FEATURES.md`: Granular breakdown of functional capabilities and interaction rules.
9. `AGENTS.md`: Operational guidelines for autonomous coding agents developing on the codebase.
10. `TODO.md`: Immediate action checklist for setting up and running the synthesized repository.
11. `CHANGELOG.md`: Initialization record marking the reverse-engineered genesis version (`v0.1.0`).

### 3.2 Documentation Generation Engine

```typescript
export interface DocSynthesisContext {
  blueprint: Record<string, unknown>;
  targetFramework: string;
  projectName: string;
}

export class DocumentationSynthesizer {
  constructor(private promptManager: any, private aiProvider: any) {}

  async generateAllDocs(context: DocSynthesisContext): Promise<Record<string, string>> {
    const docFiles: Record<string, string> = {};
    const specsToGenerate = [
      'PRD.md', 'PLAN.md', 'ARCHITECTURE.md', 'DATABASE.md',
      'UI-SPEC.md', 'ADMIN-SPEC.md', 'API-SPEC.md', 'FEATURES.md',
      'AGENTS.md', 'TODO.md', 'CHANGELOG.md'
    ];

    for (const spec of specsToGenerate) {
      docFiles[spec] = await this.synthesizeSpec(spec, context);
    }

    return docFiles;
  }

  private async synthesizeSpec(specName: string, context: DocSynthesisContext): Promise<string> {
    const systemPrompt = `You are an expert technical documentation generator.
Generate a comprehensive, production-grade technical specification for: ${specName}
Target Framework: ${context.targetFramework}
Project Name: ${context.projectName}
Follow strict Markdown formatting without conversational fluff.`;

    const userPayload = JSON.stringify(context.blueprint);
    const res = await this.aiProvider.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `<DATA_PAYLOAD>\n${userPayload}\n</DATA_PAYLOAD>` }
    ]);

    return res.content;
  }
}
```

---

## 4. Code Synthesis & File Assembly Pipeline

1. **Topological File Graph Resolution**:
   - Order of generation: Design Tokens / CSS -> UI Primitives -> Composite Sections -> Page Layouts -> Pages -> Route Handlers -> Manifests.
2. **Deterministic Code Formatter**:
   - Pass synthesized TypeScript/JSX code through embedded Prettier engine before writing to disk to guarantee consistent indentation and styling.
3. **Atomic Disk Emitter**:
   - Create temp directory `<PROJECT_DIR>/build_tmp`.
   - Write files sequentially with progress event emissions.
   - Atomic rename from `build_tmp` to `target_project_dir`.
