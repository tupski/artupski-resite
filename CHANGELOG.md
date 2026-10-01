# Changelog

All notable changes to the Artupski ReSite project specification and architecture will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
Phase 2 - local storage foundation: a real, persisted SQLite database behind a typed repository layer.

- **Engine**: `sql.js` (SQLite 3 compiled to WebAssembly) so the same engine runs in the Tauri webview and under Vitest/jsdom; documented deviation from the `better-sqlite3`/Kysely suggestion in `TECH-STACK.md`.
- **Rust boundary**: `src-tauri/src/storage.rs` exposes three sandboxed commands (`storage_database_location`, `storage_read_database`, `storage_write_database`) for the single `app.db` file in the app-local-data directory. Atomic temp-file + rename writes, a 64 MiB cap, and an app-local-data containment check. Rust owns no schema, migrations, or CRUD, and exposes no generic SQL. CSP `script-src` gains `'wasm-unsafe-eval'` only.
- **Storage layer**: `src/services/storage/` - sql.js driver with runtime-aware WASM `locateFile`, `SqliteDatabase` wrapper (`exec`/`run`/`all`/`get`/`transaction`/`export`/`close`), `StorageFile` abstraction (`NativeStorageFile` IPC, `MemoryStorageFile`), and typed repositories for projects, scans, scan technologies, and settings.
- **Migrations**: ordered, checksum-verified, transactional runner with a `schema_migrations` ledger; `MIGRATION_CHECKSUM_MISMATCH` refuses to continue. `001_init` creates `projects`, `scans`, `scan_technologies`, and `app_settings` plus four indexes.
- **Lifecycle**: `initializeStorage()` runs non-blocking from the app root, emitting `storage.initializing` / `storage.migration_started` / `storage.migration_completed` / `storage.ready` / `storage.migration_failed`, and exposes `getStorageState()` for honest UI gating.
- **Application layer**: `projectService` (URL validation, storage-path derivation) and `projectsStore` (transient list/status state).
- **UI**: the Projects route now reads the real database (loading, empty, error, and not-ready states, a minimal create form, and delete) with no fabricated data.
- **Errors/Events**: new storage error codes in `ERROR-HANDLING.md` and a `storage` event domain in `EVENT-SYSTEM.md`.
- **Tooling**: `sql.js` + `@types/sql.js`; `npm run test:storage`.
- **Docs**: implementation notes added to `DATABASE.md`, `TECH-STACK.md`, `EVENT-SYSTEM.md`, `ERROR-HANDLING.md`, `SECURITY.md`, `PLAN.md`, and `TESTING.md`.

### Deferred (not in Phase 2)
`scan_pages`, `scan_assets`, `blueprints`, and `auth_sessions` tables; scanning/crawling, technology detection, responsive capture, authentication/session encryption, blueprint generation, AI, clone generation, project generator, and admin remain unimplemented.

### Phase 1
Phase 1 foundation - runnable Tauri 2 + React desktop application shell.

- **Desktop shell**: Tauri 2 project (`src-tauri/`) with a minimal native layer exposing only two read-only commands (`app_info`, `runtime_info`); no business logic in Rust. Capability set limited to `core:default` (no filesystem, shell, or process permissions).
- **Frontend**: React 18 + TypeScript (strict) + Vite, Tailwind CSS v3, React Router v6, Zustand 5.
- **Routing**: `/` (Home), `/projects`, `/scan`, `/settings`, and a not-found view.
- **UI shell**: responsive sidebar navigation with active state and keyboard support, window header with environment status and theme control, reusable primitives (`Button`, `Input`, `Panel`, `Badge`, `StatusIndicator`, `EmptyState`), inline SVG icon set.
- **Theme system**: dark (default) / light / system modes with centralized CSS-variable tokens from `UI-SPEC.md` section 3.1, persisted, and applied pre-paint to avoid a theme flash.
- **State**: responsibility-separated Zustand stores (`settingsStore`, `uiStore`, `scanStore`); the scan store models lifecycle without implementing a scanner.
- **Infrastructure foundations**: typed `EventBus` (structured payloads, canonical taxonomy), structured `Logger` (single sanctioned console boundary, pluggable sinks), and a `StructuredError` model matching `ERROR-HANDLING.md`.
- **IPC foundation**: typed command client that degrades safely in the browser preview and only invokes native commands inside the Tauri runtime.
- **Tooling**: ESLint (+ react-hooks, no-console), Prettier (2 spaces, single quotes, no trailing commas), Vitest + React Testing Library (56 tests), `typecheck`/`lint`/`test`/`build` scripts.
- **Icons**: generated Tauri app icon set (PNG/ICO/ICNS) via `scripts/generate-icons.mjs` without requiring the Rust toolchain.

### Deferred (not in Phase 1)
Scanner, Playwright, technology detection, SQLite persistence, authentication/session capture, Blueprint generation, AI provider calls, static clone, visual verification, project generator, and admin generation remain unimplemented.

---

## [0.1.0] - 2026-10-01

### Added
Initial specification & architecture release for **Artupski ReSite** (desktop-native reverse engineering, site blueprinting, and web cloning suite). Created 24 project documentation artifacts across 5 development phases:

#### Core Foundation & Architecture Specs (Phase 1)
- `PRD.md`: Product Requirements Document detailing product vision, local-first architecture, target audience, core user stories, functional requirements, and success metrics.
- `ARCHITECTURE.md`: High-level system architecture detailing Tauri 2 Rust desktop host, React frontend, Node worker processes, SQLite database, and external LLM API abstractions.
- `TECH-STACK.md`: Comprehensive technology stack choices, version constraints, rationale, and dependency matrix.
- `PLAN.md`: Exhaustive 17-phase implementation plan detailing step-by-step development tasks, acceptance criteria, test requirements, and verification gates.

#### Scanner & Reverse Engineering Specs (Phase 2)
- `SCANNER-SPEC.md`: Detailed Playwright crawler worker architecture, headless DOM capture, network resource interceptor, and asset download pipeline.
- `TECHNOLOGY-DETECTION.md`: Tech stack detection engine specification detailing 50+ technology regex signatures, version extraction rules, and taxonomy schemas.
- `AUTH-SCANNING.md`: Authenticated crawling and session capture specification detailing interactive headed browser login flows, cookie extraction, and AES-256-GCM encrypted session replay.
- `RESPONSIVE-SPEC.md`: Multi-viewport responsive layout scanner specification for desktop, tablet, and mobile DOM breakpoint auditing and screenshot comparisons.

#### Blueprint, Storage & Infrastructure Specs (Phase 3)
- `BLUEPRINT-SPEC.md`: Universal Site Blueprint JSON AST schema specification, Zod data structures, layout nodes, design token models, and component hierarchies.
- `DATABASE.md`: SQLite relational database schema specification detailing tables (`projects`, `scan_runs`, `scan_pages`, `scan_assets`, `scan_sessions`, `blueprints`), indexes, foreign key cascades, and migration strategies.
- `EVENT-SYSTEM.md`: Strongly-typed decoupled EventBus pub/sub specification for inter-component and cross-process asynchronous communication.
- `ERROR-HANDLING.md`: Centralized error handling matrix detailing structured error codes, recovery strategies, user notifications, and process cleanup fallback routines.

#### AI, UI & Generator Specs (Phase 4)
- `AI-SPEC.md`: Multi-provider LLM integration specification covering OpenAI, Anthropic, and OpenRouter client adapters, prompt compilers, and Zod structured schema enforcement.
- `UI-SPEC.md`: Comprehensive desktop user interface design system specification strictly integrated with anti-ui-slop design principles, color palettes, dark/light themes, and ergonomics.
- `CLONE-SPEC.md`: High-fidelity HTML/CSS web cloning engine specification detailing CSS inline transformation, asset re-linking, and static bundle compilation.
- `PROJECT-GENERATOR-SPEC.md`: AI-powered React/Vite project scaffold generator specification transforming site blueprints into clean modular component codebases.
- `ADMIN-SPEC.md`: Admin dashboard, scan history inspector, analytics overview, settings control center, and API key management specifications.

#### Security, Testing, Governance & Agent Ops Specs (Phase 5)
- `SECURITY.md`: Security architecture detailing OS Keychain storage via Tauri Keyring, session AES-256-GCM encryption, prompt injection sanitization boundaries, path sandboxing, and sub-process execution safety rules.
- `PRIVACY.md`: Local-first privacy specification detailing data residency guarantees, explicit LLM payload disclosure, PII scrubbing routines, and one-click session purging.
- `TESTING.md`: Multi-tier testing strategy covering Vitest unit tests, Playwright crawler integration sandboxes, in-memory SQLite repository tests, and local mock server E2E user workflow tests.
- `CONTRIBUTING.md`: Contributor developer setup instructions, coding conventions, ESLint/Prettier rules, Rust Clippy checks, Conventional Commits standard, and PR workflows.
- `AGENTS.md`: Operational manual and mandatory rules for AI coding agents, enforcing strict module boundaries, anti-patterns, Definition of Done, and explicit mandatory anti-ui-slop skill compliance.
- `CHANGELOG.md`: Project specification changelog track record.
- `TODO.md`: Technical debt tracking, unresolved design decisions, post-MVP roadmap, and future extension ideas.
