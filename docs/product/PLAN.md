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
2. **Interactive capture window (delivered)**: `AUTH-SCANNING.md` section 2.1's headed interactive window is implemented. `BrowserRuntime.launchCaptureSession()` opens a headed window via the existing worker (`launch` with `capture: true`); the user logs in manually; `BrowserRuntime.captureSessionState()` uses the new worker `captureState` command to return a **host-scoped** storage state (unrelated cookies/origins dropped; `sessionStorage` read from the signed-in same-origin pages because `storageState()` omits it). `authSessionService` (`begin`/`complete`/`cancelInteractiveCapture`) drives the flow and reuses the existing encrypt+persist path. The capture context MUST be headed and MUST NOT carry an injected `authState` (enforced on the wire and in the worker), so it can never silently become a scan context. No credential is automated, read, logged, or persisted. The flow is split across separate requests, so a human login is not bounded by the 30s worker request ceiling.
3. **Crypto**: `AUTH-SCANNING.md` section 4.1 and `SECURITY.md` section 3.1 both mandate **PBKDF2 (100k, SHA-512)**; the earlier Argon2id wording was a stale draft and is corrected. PBKDF2-HMAC-SHA512 via Web Crypto is implemented (available in both the Tauri webview and Vitest, no new dependency). The installation seed is a random per-install value in `app_settings` (no OS keychain integration yet) and must not be presented as hardware-backed. Tampered ciphertext, wrong seed/salt, truncated tag, and malformed Base64 all fail closed.
4. **Browser & isolation**: every worker session gets its own explicit Playwright context. A captured session is applied in-memory (`browser.newContext({ storageState })`), is never written to disk, and a plain launch can never inherit it. On `close`/shutdown the context is closed first (dropping all injected cookies/storage); no profile folder is written.
5. **Crawler integration**: `CrawlerService` classifies every page against the injected session (`public` / `authenticated` / `auth_required` / `blocked` / `unknown`, `src/services/scanner/authClassifier.ts`). An auth-walled page is **never** counted as a completed/authenticated result: its links are not enqueued and, when the caller required authentication, the scan is recorded `failed` (never `completed`). The `scan_pages.auth_status` column (migration 005) persists the classification. **Semantics**: `authenticated` means "scanned with a session in effect", not independently verified protection; this is documented in the classifier and rendered nowhere in the UI, so nothing overclaims.
6. **Persistence**: forward-only migrations `004_auth_sessions.ts` (version 4, `auth_sessions` with a partial UNIQUE index enforcing one active session per project) and `005_scan_page_auth.ts` (version 5, `scan_pages.auth_status`). `001`-`003` are untouched. Secrets live only inside the ciphertext; `scan_pages` never holds cookie values.
7. **UI**: `ScanRoute` gains an Authentication panel (mode selection, honest session-ready badge, capture-time/expiry, safe clear) backed by `src/stores/authStore.ts`, plus a real capture flow (`src/components/auth/AuthCapturePanel.tsx`): sign-in URL input, "Open login window", "Capture Session", cancel, and honest states. No secrets are rendered; success is shown only after the session is persisted.
8. **Deferred**: OS-keychain-backed key derivation; session verification via a pre-scan `detectLogin` round-trip in the UI; screenshots/assets/HAR (unchanged from Phase 4).

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
> and this plan. (Authentication has since been delivered - see the Phase 5 notes above.)

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

### Phase 7 Implementation Notes (as built)

Delivered on top of the Phase 4 crawler; no new process manager, browser runtime, or crawler was created, and the worker protocol was extended additively (`WORKER_PROTOCOL_VERSION` stays `1`).

1. **Profiles**: the canonical matrix lives in `src/services/infra/workerProtocol.ts` (`desktop` 1440×900, `tablet` 768×1024, `mobile` 375×812), validated on the wire with a 4320 dimension cap.
2. **Worker**: the new `captureViewport` command renders ONE profile per call in a fresh isolated context (replaying an injected session read-only), returning a full-page PNG (12 MiB base64 cap; dropped with `truncated: true` beyond), a bounded visible-element map, and the page's media-query breakpoints.
3. **Persistence**: migration `006_responsive_captures` (version 6) + `ResponsiveCaptureRepository`. Screenshots are written to disk via a new narrow sandboxed Rust `asset_write`/`asset_delete` module confined to `<app_local_data_dir>/assets`; only the relative path is stored. See `DATABASE.md` section 2.5.
4. **Service**: `src/services/scanner/responsiveScanner.ts` runs after a **completed** crawl, gated by `scanService.runScan({ viewportProfiles })`; a per-profile failure is counted as a skip and never changes the crawl's terminal status.
5. **UI**: the Scan screen's viewport toggles are **enabled** (previously `Deferred`), and a `ViewportPreview` gallery (backed by `src/stores/responsiveStore.ts`) renders persisted captures with honest loading/empty/error states.
6. **Documented limitation**: the Tailwind responsive-rule synthesizer (`RESPONSIVE-SPEC.md` section 4) is **deferred**; this phase delivers the acceptance criterion's screenshots + visible element maps + detected breakpoints.

---

## Phase 8: Static Clone Engine & Local Asset Server
- **Status**: COMPLETE (see the Phase 8 implementation notes below).
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

### Phase 8 Implementation Notes (as built)

Delivered on top of the Phase 4 crawler and Phase 7 responsive analysis; **no new process manager or browser runtime was created**, and the worker protocol was extended additively (`WORKER_PROTOCOL_VERSION` stays `1`). The full pre-implementation plan (files, migration, protocol, tests, risks, and the C3-C7 decision resolutions) is `docs/impl-plan/phase-8-impl-plan.md`.

1. **CRITICAL-GAP fix first (Phase 4/7 never persisted raw HTML or asset bytes)**: `extract` gains a bounded `captureHtml` option, and a new `captureAssets` command fetches a page's referenced assets (stylesheet/script/image/media) with the shared URL policy applied to **every** asset URL. `scan_pages` gains a nullable `raw_html_path` column; asset bytes are written to disk, only metadata + the relative path are persisted.
2. **Persistence**: forward-only migration `007_scan_assets` (version 7) creates `scan_assets` (with a UNIQUE `(scan_id, sha256)` de-dupe index and a `page_url` field) and `AssetRepository` owns all its SQL. See `DATABASE.md` section 2.6.
3. **Engine**: `src/services/clone/` - pure `clonePaths` / `htmlRewriter` / `cssRewriter` / `mockClient` / `manifest` modules (CLONE-SPEC sections 2-5) and the `cloneService` orchestrator. A page whose HTML cannot be captured is **skipped and counted**, never fabricated. **Documented deviation**: the spec's rewriter pseudocode imports `htmlparser2`/`dom-serializer`/`css-select`; those are not project dependencies, so a small bounded dependency-free rewriter is used instead (no new supply-chain dependency).
4. **Native boundary + local server**: `src-tauri/src/clone.rs` (confined to `<app_local_data_dir>/clones`) writes the clone tree at `<clones>/v1/`; `src/workers/cloneServer/` is a `ProcessManager`-managed Node child that serves the tree loopback-only with strict path confinement, opened in the system browser (no CSP widening).
5. **UI**: a `ClonePanel` on the Scan route (backed by `src/stores/cloneStore.ts`) offers "Generate static clone" + a local preview, with honest loading/empty/error/partial states; a partial run lists skipped pages/assets and never presents them as cloned.
6. **Open decisions (C3-C7)**: resolved in `docs/impl-plan/phase-8-impl-plan.md` section 10 - **C3** Phase 8 owns `scan_assets` (DATABASE.md); **C4** output at `<project>/clones/v1/` per CLONE-SPEC section 6 (spec over architecture doc); **C5** loopback-only, root-confined preview server as a managed process; **C6** ZIP export / folder-explorer **deferred** (out of Phase 8 scope, no `zip` dependency); **C7** Phase 7-style store seam + honest UI.
7. **Deferred / out of scope**: ZIP archiving + native folder-explorer trigger (CLONE-SPEC section 6.2-6.3); full CSS bundling/minification; the **Tailwind responsive-rule synthesis** (deferred Phase 7 work, explicitly NOT part of Phase 8).

---

## Phase 9: Website Blueprint Specification & Normalization Engine
- **Status**: COMPLETE (see the Phase 9 implementation notes below).
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

### Phase 9 Implementation Notes (as built)

Delivered on top of the Phase 4 crawler, Phase 6 technology detection, and Phase 7 responsive analysis; **no new process manager, browser runtime, or crawler was created**, and the worker protocol was extended additively (`WORKER_PROTOCOL_VERSION` stays `1`). The full pre-implementation plan (schema tables, module list, migration, protocol, tests, risks, and the C8-C13 decision resolutions) is `docs/impl-plan/phase-9-impl-plan.md`.

1. **Prerequisite evidence capture (CRITICAL-GAP fix first, mirroring Phase 8)**: the Blueprint is defined as a normalization of parsed DOM + computed styles, but no phase persisted a traversable DOM or any computed-style evidence. Phase 9 therefore adds a bounded, read-only worker command `captureBlueprint` (`src/workers/crawler/blueprintCapture.ts`) and a persisted per-page evidence path (migration `008` `scan_pages.blueprint_evidence_path`). The probe walks a bounded DOM and reads a computed-style subset, CSS custom properties, `@font-face` metadata, form structure, nav regions, headings, links, and images (URL/alt only). It **never** reads cookie/storage values, input `value`s, password contents, or `Authorization` headers; attributes are allowlisted and `script`/`style` bodies are stripped.
2. **Schema**: `src/types/blueprint.ts` is the single runtime validator, mirroring `BLUEPRINT-SPEC.md` sections 3-4 with a strict Zod schema (`blueprint_version: 1`, every required section, bounded recursion: `MAX_COMPONENT_DEPTH`/`MAX_COMPONENTS`/`MAX_PAGES`/`MAX_ROUTES`/`MAX_NAV_DEPTH`, `.strict()` objects, cycle detection) plus an **optional, additive** `provenance` namespace and optional per-node `confidence` that distinguish observed evidence from inferred classification. **Dependency deviation**: `zod@^3.23.8` was added as a runtime dependency (the spec's authoritative validator is Zod; the repo previously had no runtime Zod).
3. **Normalization engine**: `src/services/blueprint/` - `domNormalizer`, `designTokens`, `routes`, `forms`, `content`, `assets`, `technologies`, `site`, `analytics`, `infrastructure`, `evidence`, `assemble`, `validate`, `util` (pure), composed by `blueprintService` and the `runBlueprint` UI seam. Missing/conflicting evidence is represented as absent/empty, never fabricated.
4. **Persistence**: forward-only migration `008_blueprints.ts` (version 8) creates `blueprints` (matching the `DATABASE.md` section 3 sketch, with a UNIQUE `(scan_id, version)` index so re-runs update a revision) and adds nullable `scan_pages.blueprint_evidence_path`. `BlueprintRepository` owns all its SQL. The document itself lives at `<app_local_data_dir>/blueprints/v1/<id>.json` through a new sandboxed `src-tauri/src/blueprint.rs`; only the path + validation metadata are stored in SQLite. See `DATABASE.md` section 2.7.
5. **Lifecycle**: `blueprintLifecycle.ts` runs synthesis -> writes the document -> upserts the row (rolling the file back if the row write fails) -> emits `blueprint.*`, and **never throws**. It is integrated in `scanService.runScan` after a COMPLETED crawl and after technology/responsive/evidence steps, gated by `runScan({ blueprint: true })`; a Blueprint failure can never change the crawl's terminal status. An **invalid** document is persisted with `is_valid = 0` rather than discarded.
6. **UI**: a read-only `BlueprintPanel` (`src/components/blueprint/BlueprintPanel.tsx`, backed by `src/stores/blueprintStore.ts`) is mounted on the Scan route, with honest `idle | loading | empty | ready | partial | error` states, a validator badge, and JSON export. No document, component, or token is fabricated.
7. **Documented decisions (C8-C13)**: resolved in `docs/impl-plan/phase-9-impl-plan.md` section 15 - **C8** optional additive provenance; **C9** navigation items validated with a concrete schema (the spec's §4 `z.array(z.any())` is a validator omission, §3 types them); **C10** state modeled via `interactions[]` + `variants` (no non-spec `state` section); **C11** output at `<app_local_data_dir>/blueprints/v1/` (sandbox over the `DATABASE.md` per-project path, same rationale as Phase 8 C4); **C12** new additive `captureBlueprint` command + persisted evidence path (not a second crawler); **C13** synthesis is opt-in via `runScan({ blueprint: true })`.
8. **Deferred / out of scope**: AI/LLM synthesis (Phase 10-11), code generation (Phase 12), visual diffing (Phase 13), and doc/ZIP export (Phase 14). Tailwind responsive-rule inference from responsive captures stays deferred Phase 7 work and is **not** part of Phase 9.

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
