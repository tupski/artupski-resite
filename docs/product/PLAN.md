# Implementation Plan (Phases 0 - 16) - Artupski ReSite

## Frontend Skill Notice
All frontend tasks across all phases MUST comply with `C:\Users\Kakarama Room\.agents\skills\anti-ui-slop\SKILL.md`.

---

## Phase 0: Project Initialization & Repository Setup
- **Goal**: Initialize repository structure, tooling, linting, and build configs.
- **Scope**: Monorepo/workspace setup with Tauri 2, React, TypeScript, Tailwind CSS, Vite.
- **Dependencies**: Node.js, Rust, Cargo, Tauri CLI.
- **Files/Modules Affected**: `package.json`, `tsconfig.json`, `tailwind.config.js`, `vite.config.ts`, `src-tauri/`.
- **Implementation Tasks**:
  1. Configure Tauri 2 scaffold with React + TS template.
  2. Setup Tailwind CSS, PostCSS, ESLint, and Prettier.
  3. Verify cross-platform dev server execution.
- **Tests**: Unit test runner setup (Vitest), Tauri build verification.
- **Acceptance Criteria**: `npm run dev` and `cargo tauri dev` launch application window without errors.
- **Potential Risks**: Tauri v2 cross-platform build friction on Windows/macOS.
- **Verification**: Application window renders blank React template with styled Tailwind button.

---

## Phase 1: Core Foundation & UI Shell
- **Status**: COMPLETE (delivered together with Phase 0 scaffolding; see the Phase 1 implementation note at the end of this document).
- **Goal**: Establish base application shell, routing, state management, and theme system.
- **Scope**: React Router v6 setup, Zustand store base, layout components (Sidebar, Header, Main view).
- **Dependencies**: Phase 0.
- **Files/Modules Affected**: `src/app/`, `src/routes/`, `src/components/layout/`, `src/stores/`, `src/services/`, `src-tauri/`.
- **Implementation Tasks**:
  1. Implement app navigation (`Home`, `Projects`, `Scan`, `Settings`).
  2. Implement responsibility-separated Zustand stores (settings, UI, scan) rather than a single global store.
  3. Build dark/light/system theme foundation following `anti-ui-slop` standards.
- **Tests**: Component render tests with Vitest + React Testing Library.
- **Acceptance Criteria**: Navigation between all root pages works with active state highlighting.
- **Potential Risks**: State synchronization issues across views.
- **Verification**: Route transitions load without flicker or layout breakage.

### Phase 1 Implementation Notes (as built)
The following decisions were made during implementation and supersede the pre-implementation wording above where they conflict:

1. **Routes**: The application exposes `/`, `/projects`, `/scan`, `/settings` (plus a not-found view). Dashboard/Blueprint/Scanner navigation items were intentionally NOT created because those engines are out of Phase 1 scope; navigation only links to views that exist.
2. **State**: Three focused stores replace the originally sketched single global store: `settingsStore` (persisted preferences), `uiStore` (transient chrome), `scanStore` (scan lifecycle shape, no scanner behavior).
3. **Phase 0**: The repository had no runnable scaffold, so Phase 1 delivered the Phase 0 tooling (Tauri 2 shell, Vite, TypeScript, Tailwind v3, ESLint, Prettier, Vitest) as a prerequisite.
4. **Native layer**: `src-tauri` exposes only two read-only commands (`app_info`, `runtime_info`); no business logic.
5. **Styling**: Tailwind CSS v3 with CSS-variable design tokens sourced from `UI-SPEC.md` section 3.1.

---

## Phase 2: Local Database & Persistence Layer
- **Status**: COMPLETE (see the Phase 2 implementation note at the end of this section).
- **Goal**: Configure SQLite database and repository abstraction layer.
- **Scope**: Database schema migrations, SQLite connection via Rust/Tauri bridge or better-sqlite3 worker.
- **Dependencies**: Phase 1.
- **Files/Modules Affected**: `src-tauri/src/storage.rs`, `src/services/storage/`, `src/services/projects/projectService.ts`, `src/stores/projectsStore.ts`, `src/types/models.ts`.
- **Implementation Tasks**:
  1. Define database schema (projects, scans, scan_technologies, app settings).
  2. Implement migration runner on app startup.
  3. Expose TypeScript CRUD repository interfaces for frontend consumption.
- **Tests**: Database CRUD unit tests (in-memory SQLite for testing).
- **Acceptance Criteria**: Data persists across application restarts.
- **Potential Risks**: SQLite locking on concurrent writes from multiple processes.
- **Verification**: Store a test project record, restart app, verify retrieval.

### Phase 2 Implementation Notes (as built)
The following decisions were made during implementation and supersede the pre-implementation wording above where they conflict:

1. **Engine**: `sql.js` (SQLite 3 compiled to WebAssembly) instead of `better-sqlite3`/Kysely, so the same engine runs in the Tauri webview and under Vitest/jsdom without a native build. Documented deviation in `docs/architecture/DATABASE.md` section 2.1 and `docs/architecture/TECH-STACK.md`.
2. **Rust boundary**: `src-tauri/src/db/` was not created. Rust exposes only three sandboxed file-I/O commands in `src-tauri/src/storage.rs` (`storage_database_location`, `storage_read_database`, `storage_write_database`); it owns no schema, migrations, or CRUD and exposes no generic SQL.
3. **Schema actuals**: `projects`, `scans`, `scan_technologies` (from `DATABASE.md`) plus `app_settings` (an addition driven by this phase's "settings" item). `scan_pages`, `scan_assets`, `blueprints`, and `auth_sessions` are deferred to their owning phases and were intentionally not created.
4. **Migration tracking**: a `schema_migrations` ledger with deterministic checksums, transactional per-migration application, and a hard stop on checksum mismatch (`MIGRATION_CHECKSUM_MISMATCH`).
5. **Persistence model**: the whole database is exported and atomically written after each mutation (the sql.js model), through the sandboxed Rust command.
6. **UI**: the Projects route reads the real database via `projectsStore` -> `projectService` -> repositories, with honest loading/empty/error states and a minimal create/delete affordance. No fabricated data.
7. **Module naming**: the implementation uses `src/services/storage/` (not `src/services/db/`) to reflect that the layer covers the database plus its file persistence boundary.

---

## Phase 3: Browser / Playwright Foundation (Infrastructure Subsystems)
- **Status**: COMPLETE (see the Phase 3 implementation note at the end of this section).
- **Goal**: Build the child-process orchestration foundation and a Playwright *runtime* boundary - launch/navigate only.
- **Scope**: ProcessManager lifecycle + typed worker protocol, a dedicated Node worker, and browser runtime detection/management. **Not** crawling, DOM/CSS/JS analysis, network analysis, technology detection, or screenshots (those remain Phase 4+).
- **Dependencies**: Phase 2.
- **Files/Modules Affected**: `src/services/infra/processManager.ts`, `src/services/infra/workerProtocol.ts`, `src/services/infra/processErrors.ts`, `src/services/infra/tauriProcessSpawner.ts`, `src/services/browser/`, `src/workers/crawler/`, `src-tauri/src/process.rs`.
- **Implementation Tasks**:
  1. Reuse the Phase 1 typed `EventBus` and structured `Logger` (no parallel systems).
  2. Implement a versioned, validated JSON-over-stdio worker protocol.
  3. Implement ProcessManager to spawn, stream stdout/stderr, and terminate workers safely.
  4. Implement browser runtime detection/management (Chromium-only MVP) via the worker.
- **Tests**: Protocol, lifecycle, browser-runtime unit tests (injected fakes) plus an opt-in real-browser smoke test.
- **Acceptance Criteria**: Worker processes terminate within 500ms when killed; a missing browser is reported honestly without crashing the app.
- **Potential Risks**: Orphaned Node/Playwright processes on unexpected app exit; packaging the worker/browser for release.
- **Verification**: `npm run test` (no browser needed) plus `RUN_BROWSER_TESTS=1 npm run test:browser`.

### Phase 3 Implementation Notes (as built)
The following decisions were made during implementation and supersede the pre-implementation wording above where they conflict:

1. **Phase identity**: Phase 3 is *infrastructure + browser runtime foundation only*. Playwright is used solely to launch Chromium and navigate to a controlled local fixture in the opt-in smoke test. Extraction/analysis is explicitly deferred to Phase 4.
2. **Transport**: newline-delimited JSON over **stdio** (not WebSocket), so the webview CSP `connect-src` is not widened. See `docs/architecture/WORKER-PROTOCOL.md`.
3. **Native spawn**: a minimal custom Rust module (`src-tauri/src/process.rs`) using `std::process::Command` with array args and no shell. Only four narrowly-named commands are registered (`process_spawn`, `process_write`, `process_kill`, `process_status`). No `tauri-plugin-shell` / `tauri-plugin-process` was added.
4. **Browser distribution**: no bundling or auto-download. Phase 3 implements runtime detection/diagnostics only; the opt-in smoke test uses dev-time `npx playwright install chromium`. Packaging the worker + browser is deferred.
5. **Dependency**: `playwright-core` is pinned as a **devDependency** (used only by the worker/tests); the MVP engine is Chromium-only.
6. **UI**: Phase 3 is UI-inert. The scan route is unchanged and its Start button remains disabled.
7. **Phase 4 (unchanged)**: the Playwright crawler, DOM/network extraction, and asset pipeline remain Phase 4.

---

## Phase 4: Playwright Crawler & Browser Engine
- **Goal**: Integrate Playwright worker process for URL scanning and asset discovery.
- **Scope**: Playwright runner, page crawler, network traffic interceptor, DOM snapshot collector.
- **Dependencies**: Phase 3.
- **Files/Modules Affected**: `src/workers/crawler/`, `src/services/scanner/playwrightRunner.ts`.
- **Implementation Tasks**:
  1. Create isolated Playwright crawler script.
  2. Intercept and log all network responses (HTML, CSS, JS, fonts, media).
  3. Extract serialized DOM tree, computed styles, and page metadata.
- **Tests**: Mock local web server crawling tests.
- **Acceptance Criteria**: Successfully extract complete DOM and network asset map from target URL.
- **Potential Risks**: Target websites blocking headless user agents.
- **Verification**: Scan a test URL and inspect returned DOM structure and asset inventory.

### Phase 4 Implementation Notes (workstream 1, as built)
This workstream delivers the crawler core only; persistence, lifecycle/orchestration, and UI are a later workstream.

1. **Module naming**: the host client is `src/services/scanner/scannerWorkerClient.ts` (not `playwrightRunner.ts`); it wraps the existing `ProcessManager` and never spawns anything itself.
2. **Security first**: `src/services/scanner/security/` implements an explicit URL/network policy (schemes, credentials, ports, URL length, IP-range classification incl. non-canonical IPv4 and IPv6 mappings, DNS resolution with ANY-prohibited-address rejection, and a trusted-seed-origin rule). Every navigation/redirect boundary the architecture can observe is validated; the residual limitations are documented in `SECURITY.md` section 6.5.
3. **Extraction scope**: Phase 4 extracts page metadata/structure only (title, meta description, canonical, robots meta, headings, internal/external links, image refs + alt, basic metrics, timestamp). DOM snapshots, computed styles, HAR, screenshots, and assets remain later phases.
4. **Protocol**: `extract` / `abort` are additive; `WORKER_PROTOCOL_VERSION` stays `1`.
5. **No persistence**: page results are returned as normalized, bounded objects; storing them (`scan_pages`) is the later workstream's responsibility.

### Phase 4 Implementation Notes (workstream 2, as built)

This workstream adds persistence, the scan lifecycle/cancellation, event wiring, and the crawler application service. UI remains workstream 3.

1. **Persistence**: a **new** migration `002_scan_pages.ts` (version `2`) creates `scan_pages` (child of `scans`, `ON DELETE CASCADE`) with a unique `(scan_id, url)` index; `001_init` is untouched. `ScanPageRepository` provides typed upsert/list/count APIs with bounded batch writes; `ScanRepository` gains `updateProgress()` and `findActive()` / `findActiveByProject()`. See `DATABASE.md` section 2.2.
2. **Lifecycle & cancellation**: `src/services/scanner/lifecycle.ts` is a pure state machine over the persisted `scans.status` union (`pending → in_progress → completed | failed | cancelled`). The service refuses duplicate concurrent scans with `SCAN_ALREADY_RUNNING`; `cancel(scanId)` aborts the in-flight worker extraction, persists partial progress, records `cancelled`, and releases the run slot. A scan is only marked `completed` after the final page batch is written.
3. **Events/errors**: `scanner.page_started`, `scanner.page_failed`, `scanner.progress`, and `scanner.cancelled` are added (see `EVENT-SYSTEM.md` section 3.3); `SCAN_ALREADY_RUNNING` is added to the taxonomy (`ERROR-HANDLING.md`). Recoverable page failures are distinguished from fatal scan failures.
4. **Orchestration**: `src/services/scanner/crawlerService.ts` composes the workstream-1 frontier/scope/normalization + `scannerWorkerClient` + repositories + events + cancellation, with all limits clamped into documented hard bounds (`src/services/scanner/crawlLimits.ts`). Traversal is a sequential BFS (`maxConcurrency` is 1) because the worker holds a single abort controller per session. The frontend never touches Playwright/child processes.
5. **UI**: out of scope (workstream 3); the scan route and its Start button remain unchanged.

### Phase 4 Implementation Notes (workstream 3, as built)

This final Phase 4 workstream wires the UI to the crawler, fixes the opt-in test flake, and finalizes the documentation. It adds **no** downstream features.

1. **Orchestration seam**: `src/services/scanner/scanService.ts` is the single entry point the UI uses to run a crawl. It validates the target, resolves the owning project, launches a browser session through the existing `BrowserRuntime` (sharing its worker process / `ProcessManager`), runs the `CrawlerService`, exposes cancellation, and always closes the session. Failures are returned as typed `StructuredError`s, never thrown at the UI.
2. **Store/UI**: `src/stores/scanStore.ts` mirrors the crawl's own `scanner.*` events into real progress, discovered pages, and an activity log (no fabricated percentages). `src/routes/ScanRoute.tsx` renders honest states, an actionable error alert, deliberate focus movement, and shows the multi-viewport controls disabled and labelled **Deferred** (they are not honored by the crawler yet). A project is auto-selected for the typed URL or can be created inline.
3. **Scope**: page metadata/structure extraction only. Technology detection, responsive capture, authentication, screenshots/assets, HAR, blueprint/clone/project generation, and admin remain later phases.
4. **Test determinism**: the three opt-in real-Chromium E2E files use distinct fixture ports (worker smoke `9099`, extraction `4000`, orchestration `8000`) so they no longer contend when run together.

---

## Phase 5: Authentication & Session Scanning
- **Goal**: Support authenticated crawling of pages behind login screens.
- **Scope**: Interactive login webview / browser capture, cookie injection, storageState capture.
- **Dependencies**: Phase 4.
- **Files/Modules Affected**: `src/services/scanner/authManager.ts`, `src/components/scanner/AuthModal.tsx`.
- **Implementation Tasks**:
  1. Provide interactive browser window for manual user login when needed.
  2. Save Playwright `storageState.json` (cookies, localStorage) securely to SQLite.
  3. Replay authenticated storage state during subsequent scan runs.
- **Tests**: Login flow test against a local authenticated test server.
- **Acceptance Criteria**: Crawler accesses protected routes using saved session state.
- **Potential Risks**: Token expiration and session invalidation during multi-page scans.
- **Verification**: Scan authenticated dashboard view; verify authenticated DOM is captured.

### Roadmap numbering reconciliation (as built)

The delivered work does **not** follow the numeric order of the phase headings above. Technology Detection (below, headed "Phase 6") was implemented and committed **before** Authentication & Session Scanning (headed "Phase 5"), as `2191b29 feat: implement technology detection`. The phase *numbers* are unchanged (Technology Detection remains "Phase 6" and Authentication remains "Phase 5"); only the delivery order differs. This note records the discrepancy rather than silently renumbering unrelated phases.

### Phase 5 Implementation Notes (as built)

The phase is delivered as a **cryptographically-bounded session core** that reuses the existing Phase 3 browser infrastructure and Phase 4 crawler. No second process manager, browser runtime, or crawler was created; the worker protocol was extended additively.

1. **Scope delivered**: session data model, AES-256-GCM encryption at rest, persistence, injection of a captured `storageState` into an isolated browser context, auth-wall detection/classification, session lifecycle/cleanup, and honest UI state. See `AUTH-SCANNING.md` section 4 and `SECURITY.md` section 3 for the authoritative model.
2. **Documented deviation - interactive capture window**: `AUTH-SCANNING.md` section 2.1 specifies a **headed** interactive browser window where the user completes login/MFA/SSO, followed by a "Capture Session" action. Phase 3's worker only ever launches headless and the spec forbids replacing that flow with credential automation. This build therefore **defers the interactive capture window** and the credential-entry UX; everything downstream of capture (encryption, storage, injection, classification, cleanup, UI status/clear) is implemented and tested. The UI states this limitation plainly. The `detectLogin` worker command (a pure presence probe, no data extraction) is provided so a future capture flow can verify a session; it is not a credential-entry surface.
3. **Crypto (documented reconciliation)**: `AUTH-SCANNING.md` section 4.1 names Argon2id while `SECURITY.md` section 3.1 names PBKDF2 (100k, SHA-512). The two spec sections disagree; PBKDF2-HMAC-SHA512 via Web Crypto is implemented (available in both the Tauri webview and Vitest, no new dependency). The installation seed is a random per-install value in `app_settings` (no OS keychain integration yet) and must not be presented as hardware-backed.
4. **Browser & isolation**: every worker session gets its own explicit Playwright context. A captured session is applied in-memory (`browser.newContext({ storageState })`), is never written to disk, and a plain launch can never inherit it. On `close`/shutdown the context is closed first (dropping all injected cookies/storage); no profile folder is written.
5. **Crawler integration**: `CrawlerService` classifies every page against the injected session (`public` / `authenticated` / `auth_required` / `blocked` / `unknown`, `src/services/scanner/authClassifier.ts`). An auth-walled page is **never** counted as a completed/authenticated result: its links are not enqueued and, when the caller required authentication, the scan is recorded `failed` (never `completed`). The `scan_pages.auth_status` column (migration 005) persists the classification.
6. **Persistence**: forward-only migrations `004_auth_sessions.ts` (version 4, `auth_sessions` with a partial UNIQUE index enforcing one active session per project) and `005_scan_page_auth.ts` (version 5, `scan_pages.auth_status`). `001`-`003` are untouched. Secrets live only inside the ciphertext; `scan_pages` never holds cookie values.
7. **UI**: `ScanRoute` gains an Authentication panel (mode selection, honest session-ready badge, capture-time/expiry, safe clear) backed by `src/stores/authStore.ts`. No secrets are rendered; a session can only be selected when the persisted metadata says one exists.
8. **Deferred**: the interactive capture window + credential entry; OS-keychain-backed key derivation; session verification via a pre-scan `detectLogin` round-trip in the UI; screenshots/assets/HAR (unchanged from Phase 4).

---

## Phase 6: Technology & Library Detection Engine
- **Goal**: Identify frameworks, libraries, fonts, and UI toolkits used by the target site.
- **Scope**: Heuristic & signature rules engine analyzing script tags, globals, headers, and CSS classes.
- **Dependencies**: Phase 4.
- **Files/Modules Affected**: `src/services/detector/`, `src/services/detector/rules/`.
- **Implementation Tasks**:
  1. Create signature database for React, Vue, Angular, Next.js, Tailwind, Bootstrap, Google Fonts, etc.
  2. Inspect window globals, HTML meta tags, and script URLs.
  3. Emit structured tech detection report.
- **Tests**: Test detector against sample HTML/JS fixtures of 10 major frameworks.
- **Acceptance Criteria**: Correctly identify frontend framework and styling engine with >90% precision on test fixtures.
- **Potential Risks**: Obfuscated or bundled production code hiding signatures.
- **Verification**: Scan a known React+Tailwind site; confirm detected badges in scan result.

### Phase 6 Implementation Notes (technology detection, as built)

> **Phase-number note (documented, not silent):** this work was commissioned and delivered as
> "Phase 5 - Technology Detection" against `docs/specs/TECHNOLOGY-DETECTION.md`. The PLAN.md phase
> list places technology detection at **Phase 6** and reserves **Phase 5** for Authentication &
> Session Scanning. The two are the same deliverable; the numbering differs between the commission
> and this plan. Authentication remains unimplemented.

1. **Evidence capture extension (authorized)**: because the Phase 4 crawler persisted only page metadata/structure, the extraction contract was extended with a bounded `PageTechEvidence` (`src/services/scanner/extraction/types.ts`) - response headers, cookie names only, script `src` URLs, meta tags, DOM markers, boolean JS-global probes, and a length-capped HTML snippet. All sizes are capped in `EXTRACTION_LIMITS`; cookie values are never retained; no page script is executed.
2. **Engine**: `src/services/detector/` implements the documented pipeline with separated concerns (evidence projection, data-driven rules, matcher, confidence, version extraction, cross-page aggregation). Confidence follows `C(T) = 1 - ∏(1 - w_i)` with the spec thresholds; weak signals are never presented as confirmed.
3. **Persistence**: migration `003_technology_detection.ts` extends the existing `scan_technologies` table (no redundant table) and adds a `(scan_id, technology_id)` UNIQUE index; `TechnologyRepository.upsertMany()` writes a report in one transaction. See `DATABASE.md` section 2.3.
4. **Lifecycle**: detection runs in `CrawlerService` after page batches are durable and before any terminal status; new `technology.*` events were added. A completed scan always has its detections; cancellation retains partial detections.
5. **UI**: a "Detected technologies" panel on the Scan route renders persisted rows only, with honest version/confidence labelling and loading/empty/error/partial states.
6. **Documented deviations from the spec's JSON example**: no runtime custom-rule file merge / `override` engine is implemented (rules are a static, data-driven table); `networkRequests` is derived from HTML attributes rather than a HAR; JS-global detection is presence-only. Coverage is limited to the implemented rule table.

---

## Phase 7: Responsive Layout & Viewport Analysis
- **Goal**: Capture layout variations across Mobile, Tablet, and Desktop resolutions.
- **Scope**: Multi-viewport Playwright rendering (`375px`, `768px`, `1920px`), media query extraction.
- **Dependencies**: Phase 4.
- **Files/Modules Affected**: `src/services/scanner/responsiveScanner.ts`, `src/components/scanner/ViewportPreview.tsx`.
- **Implementation Tasks**:
  1. Render target URL across standard viewports.
  2. Capture full-page screenshots and element bounding boxes per viewport.
  3. Extract CSS media query breakpoints and hidden/visible element states.
- **Tests**: Responsive layout test on responsive test fixture.
- **Acceptance Criteria**: Viewport analysis returns distinct screenshots and visible element maps for each breakpoint.
- **Potential Risks**: High memory usage when capturing high-DPI full-page screenshots.
- **Verification**: Inspect generated multi-viewport screenshots in UI gallery.

---

## Phase 8: Static Clone Engine & Local Asset Server
- **Goal**: Generate downloadable 1:1 offline static clone of scanned website.
- **Scope**: Asset downloader, relative URL rewriter, local static file server.
- **Dependencies**: Phase 4, Phase 7.
- **Files/Modules Affected**: `src/services/clone/`, `src/services/clone/assetDownloader.ts`, `src/services/clone/server.ts`.
- **Implementation Tasks**:
  1. Download all CSS, JS, image, font, and SVG assets.
  2. Rewrite internal URLs in HTML/CSS to point to local relative paths.
  3. Serve cloned folder via local HTTP server for embedded preview.
- **Tests**: Offline browseability verification on static clone output.
- **Acceptance Criteria**: Cloned website renders locally without 404s or external network dependencies.
- **Potential Risks**: Dynamic JavaScript fetching absolute remote endpoints at runtime.
- **Verification**: Disconnect internet, load local clone preview, verify layout and styling intact.

---

## Phase 9: Website Blueprint Specification & Normalization Engine
- **Goal**: Parse raw DOM and styles into structured Blueprint JSON schema.
- **Scope**: DOM-to-Component tree parser, design token extractor, route definition synthesizer.
- **Dependencies**: Phase 6, Phase 7.
- **Files/Modules Affected**: `src/services/blueprint/`, `src/types/blueprint.ts`.
- **Implementation Tasks**:
  1. Define rigid Zod schema for Blueprint (routes, components, tokens, state, forms).
  2. Extract color palette, font families, font sizes, and spacing tokens into design system spec.
  3. Segment DOM into semantic components (Header, Footer, Card, Navbar, Form, Modal).
- **Tests**: Blueprint schema validation tests on scanned fixtures.
- **Acceptance Criteria**: Emitted blueprint passes Zod validation schema completely.
- **Potential Risks**: Complex nested DOM structures leading to bloated component trees.
- **Verification**: Inspect generated `blueprint.json` structure for valid token and component nodes.

---

## Phase 10: AI Provider Abstraction & Engine
- **Goal**: Integrate unified AI client for cloud and local inference models.
- **Scope**: OpenAI-compatible REST client, prompt templates, token stream parsing, fallback handling.
- **Dependencies**: Phase 1, Phase 9.
- **Files/Modules Affected**: `src/services/ai/aiClient.ts`, `src/services/ai/prompts/`, `src/stores/aiStore.ts`.
- **Implementation Tasks**:
  1. Implement OpenAI REST client supporting custom `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`.
  2. Integrate structured output parser (Zod/JSON mode).
  3. Support Ollama, LM Studio, OpenRouter, and OpenAI endpoints with health check validation.
- **Tests**: Mock API server tests for streaming and schema validation.
- **Acceptance Criteria**: Successfully communicate with local Ollama or OpenAI endpoint and return valid structured JSON.
- **Potential Risks**: Model hallucinations or malformed JSON responses on smaller local models.
- **Verification**: Run prompt against test endpoint; verify valid typed object returned.

---

## Phase 11: AI-Powered Component Extraction & Synthesis
- **Goal**: Use AI to transform raw HTML/CSS component segments into clean React + Tailwind components.
- **Scope**: Component prompt engineering, code synthesis pipeline, JSX cleanliness optimizer.
- **Dependencies**: Phase 9, Phase 10.
- **Files/Modules Affected**: `src/services/generator/componentSynthesizer.ts`, `src/services/ai/prompts/componentPrompt.ts`.
- **Implementation Tasks**:
  1. Feed blueprint component nodes and extracted design tokens to AI engine.
  2. Generate clean TypeScript React components with Tailwind classes.
  3. Ensure no AI-slop code or useless comments are generated.
- **Tests**: Synthesizer unit tests on component fixtures.
- **Acceptance Criteria**: Generated components compile with TypeScript and render matching UI.
- **Potential Risks**: Exceeding model context window on massive DOM trees (mitigate via chunking).
- **Verification**: Generate button and card components; verify clean JSX and Tailwind syntax.

---

## Phase 12: Full-Stack Project Generator (Vite + React + TS + Tailwind)
- **Goal**: Assemble complete, runnable project repository from generated components and blueprint.
- **Scope**: Project file structure generator, package manifest, router config, design tokens integration.
- **Dependencies**: Phase 11.
- **Files/Modules Affected**: `src/services/generator/projectGenerator.ts`, `src/templates/project/`.
- **Implementation Tasks**:
  1. Create project boilerplate template (Vite, React 18/19, Tailwind, TS).
  2. Inject extracted routes into React Router config.
  3. Write synthesized components, hooks, and static assets to target folder.
- **Tests**: End-to-end build test: run `npm install && npm run build` inside generated project directory.
- **Acceptance Criteria**: Generated project builds cleanly without TypeScript or Vite errors.
- **Potential Risks**: Missing dependencies or broken relative import paths.
- **Verification**: Open generated project directory in terminal; run build and verify `dist/` created.

---

## Phase 13: Visual Verification & Diff Engine
- **Goal**: Compare original captured website against generated project rendering.
- **Scope**: Dual-preview side-by-side view, pixel-diff calculation (Pixelmatch/Playwright screenshot diff).
- **Dependencies**: Phase 8, Phase 12.
- **Files/Modules Affected**: `src/services/diff/visualDiff.ts`, `src/components/diff/DiffViewer.tsx`.
- **Implementation Tasks**:
  1. Launch generated project in background dev server.
  2. Capture screenshots of generated pages at matching viewports.
  3. Compute visual diff image and similarity score percentage.
- **Tests**: Visual diff calculation test with known mismatch images.
- **Acceptance Criteria**: Display side-by-side visual comparison with overlay diff slider and mismatch score.
- **Potential Risks**: Dynamic content (dates, carousels, animations) triggering false-positive diffs.
- **Verification**: Run diff comparison; view color-coded overlay highlighting layout variations.

---

## Phase 14: Project Documentation & Export Engine
- **Goal**: Auto-generate comprehensive documentation for generated projects and export archives.
- **Scope**: Markdown generator (`README.md`, `ARCHITECTURE.md`, `COMPONENTS.md`), ZIP export bundler.
- **Dependencies**: Phase 12.
- **Files/Modules Affected**: `src/services/exporter/docGenerator.ts`, `src/services/exporter/zipExporter.ts`.
- **Implementation Tasks**:
  1. Generate project-specific documentation detailing architecture, route structure, and components.
  2. Bundle project into standalone ZIP archive or export to selected local folder.
- **Tests**: ZIP integrity and documentation markdown syntax tests.
- **Acceptance Criteria**: Exported archive unpacks cleanly and contains complete source code and docs.
- **Potential Risks**: Large asset directories causing zip memory bloat.
- **Verification**: Export project to ZIP, unzip, verify presence of README and all source files.

---

## Phase 15: Settings, Telemetry, Security & Error Handling Hardening
- **Goal**: Finalize application settings, credential encryption, error boundaries, and crash recovery.
- **Scope**: Settings UI, API key secure storage, global React error boundary, error notification toast system.
- **Dependencies**: All prior phases.
- **Files/Modules Affected**: `src/components/settings/`, `src/services/security/`, `src/components/common/ErrorBoundary.tsx`.
- **Implementation Tasks**:
  1. Provide full settings management (AI base URL, keys, crawler concurrency, theme).
  2. Ensure API keys and session cookies are securely stored and sanitized from export logs.
  3. Wrap UI tree in error boundaries with user-friendly recovery actions.
- **Tests**: Security key leakage tests and error boundary trigger tests.
- **Acceptance Criteria**: Invalid configurations surface actionable errors without app crashes.
- **Potential Risks**: Unhandled exceptions in background workers breaking IPC bridge.
- **Verification**: Provide invalid AI URL; confirm clean error toast and recovery option.

---

## Phase 16: End-to-End Integration Testing & Release Packaging
- **Goal**: Full pipeline integration validation and desktop installer builds.
- **Scope**: E2E test runs (Scan -> Blueprint -> Project -> Build), production Tauri bundle generation.
- **Dependencies**: Phase 0 through Phase 15.
- **Files/Modules Affected**: `e2e/`, `src-tauri/tauri.conf.json`.
- **Implementation Tasks**:
  1. Execute automated end-to-end test suite against reference demo websites.
  2. Configure Tauri release bundler for Windows (.msi / .exe) and macOS (.dmg).
  3. Validate performance, scan speed, and memory consumption.
- **Tests**: Full E2E pipeline test with Vitest/Playwright.
- **Acceptance Criteria**: Single-click scan to generated project completes with 100% buildable output; native installer packages successfully.
- **Potential Risks**: Platform-specific installer code signing and packaging hurdles.
- **Verification**: Install generated desktop package on clean environment; execute full website reverse-engineering workflow.
