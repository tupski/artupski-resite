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
- **Goal**: Configure SQLite database and repository abstraction layer.
- **Scope**: Database schema migrations, SQLite connection via Rust/Tauri bridge or better-sqlite3 worker.
- **Dependencies**: Phase 1.
- **Files/Modules Affected**: `src-tauri/src/db/`, `src/services/db/`, `src/types/models.ts`.
- **Implementation Tasks**:
  1. Define database schema (projects, scan_runs, assets, blueprints, settings).
  2. Implement migration runner on app startup.
  3. Expose TypeScript CRUD repository interfaces for frontend consumption.
- **Tests**: Database CRUD unit tests (in-memory SQLite for testing).
- **Acceptance Criteria**: Data persists across application restarts.
- **Potential Risks**: SQLite locking on concurrent writes from multiple processes.
- **Verification**: Store a test project record, restart app, verify retrieval.

---

## Phase 3: Infrastructure Subsystems (EventBus, Logger, ProcessManager)
- **Goal**: Build background process orchestration, logging, and event distribution.
- **Scope**: ProcessManager child-process runner, EventBus pub/sub, structured Logger.
- **Dependencies**: Phase 2.
- **Files/Modules Affected**: `src/services/infra/logger.ts`, `src/services/infra/eventBus.ts`, `src/services/infra/processManager.ts`.
- **Implementation Tasks**:
  1. Implement EventBus supporting typed events.
  2. Implement file & UI structured logging.
  3. Implement ProcessManager to spawn, stream stdout/stderr, and terminate workers safely.
- **Tests**: Process termination and zombie process cleanup tests.
- **Acceptance Criteria**: Worker processes terminate immediately when killed or when Tauri window closes.
- **Potential Risks**: Orphaned Node/Playwright processes on unexpected app exit.
- **Verification**: Spawn dummy child process, kill via ProcessManager, verify process tree clean.

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
