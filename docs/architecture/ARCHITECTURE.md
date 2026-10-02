# Architecture Specification - Artupski ReSite

## 1. System Overview
Artupski ReSite is a desktop application combining a Tauri 2 native layer with a TypeScript/React user interface. Core business logic runs in TypeScript inside the desktop runtime or background worker processes, while Rust provides OS integration, filesystem access, child process management, and high-performance native bridges.

```
+-----------------------------------------------------------------------+
|                         Tauri 2 Frontend                              |
|   React 18/19 | TypeScript | Zustand | React Router | Tailwind CSS    |
+-----------------------------------+-----------------------------------+
                                    | (IPC / Events / Commands)
+-----------------------------------+-----------------------------------+
|                        Tauri Rust Native Core                         |
|   OS Shell | FS Access | SQLite Native Driver | Child Process Manager |
+-----------------------------------+-----------------------------------+
                                    | (Child Process IPC / stdio)
+-----------------------------------+-----------------------------------+
|                     Background Workers & Engines                      |
|   Playwright Engine | AI Provider Client | Code Generation Pipeline   |
+-----------------------------------------------------------------------+
```

---

## 2. Layer Separation Model

### Layer 1: Static Clone
- Downloads exact static files (raw HTML, CSS, JavaScript, fonts, SVGs, images).
- Resolves relative URLs to local file paths.
- Serves static snapshot locally via internal HTTP server for exact 1:1 preview.

### Layer 2: Website Blueprint
- Normalizes parsed DOM and layout data into intermediate JSON schema.
- Structures routing topology, design tokens (colors, typography, spacing), component trees, input forms, and data contracts.
- Independent of output target framework.

### Layer 3: Full Project
- Consumes Blueprint and user configurations.
- Synthesizes full-stack source code (components, hooks, state, routing, asset bundling).
- Emits structured codebase ready to run (`package.json`, Vite config, Tailwind config, source files).

---

## 3. Subsystem Architecture

### 3.1 Scanner Engine
- Controls Playwright browser automation instances (Chromium, Firefox, WebKit).
- Collects DOM tree snapshots, computed styles, runtime JS variables, network HAR logs, and page screenshots.
- Manages authentication sessions via cookie extraction, storage state injection, or interactive login forms.

### 3.1a Authentication & Session Scanning (as built)
- **Seam**: `src/services/auth/` (`crypto.ts` cipher, `authSessionService.ts` capture/load/clear, `types.ts` taxonomy). The React UI never imports the cipher or the repository directly; it uses `src/stores/authStore.ts`, which reads persisted metadata as the source of truth.
- **Ownership/lifecycle**: `captureSession` → encrypt (AES-256-GCM) → `AuthSessionRepository.saveSession` (one active session per project, enforced by a partial UNIQUE index) → `loadSessionForScan` (domain-scoped, purges expired) → injected into a dedicated worker context → cleared on close/cancel/clear. Plaintext lives only in memory for the duration of a capture/inject call.
- **Browser boundary**: the existing Phase 3 `BrowserRuntime` gained `launchSession({ authState })`, `detectLogin(...)`, and the interactive capture methods `launchCaptureSession()` / `captureSessionState()` / `cancelCapture()`; the worker `launch` applies the state to an isolated `newContext` and `launch` with `capture: true` opens a headed window. No second runtime, worker, or spawner was created.
- **Interactive capture (§2.1)**: the headed window, host-scoped `captureState` snapshot, and encrypt/persist path are delivered. `authSessionService.beginInteractiveCapture` / `completeInteractiveCapture` / `cancelInteractiveCapture` drive the flow; the capture context must be headed and must not carry an injected `authState` (enforced on the wire and in the worker), so it can never silently become a scan context. Cancellation/failure/shutdown close the window.
- **Crawler**: `CrawlerService` classifies each page (`src/services/scanner/authClassifier.ts`) and persists `scan_pages.auth_status`. `scanService.runScan({ authenticated })` loads the session and sets `requireAuthentication`, so a session that does not hold fails the scan instead of producing a false success.
- **Deferred**: OS-keychain-derived key (the seed is a per-install value in `app_settings`; see `SECURITY.md` section 3.3). The interactive headed capture window is **delivered** (see above and `AUTH-SCANNING.md` section 5.3).

### 3.2 AI Engine
- Interfaces with OpenAI-compatible REST API endpoints.
- Structures prompts for component extraction, blueprint generation, code conversion, and test generation.
- Handles token streaming, schema validation via JSON-mode/Zod, and retry policies.

### 3.3 Clone Engine
- Processes network responses and DOM assets.
- Sanitizes file paths, handles asset deduplication, and writes clean local directories.

### 3.4 Project Generator
- Template-driven code generation engine.
- Transforms blueprint component trees into idiomatic React components, Tailwind utility classes, and TypeScript interfaces.

### 3.5 Local Storage Subsystem
- SQLite embedded database.
- Stores project metadata, scan runs, captured assets, blueprints, settings, and logs.

### 3.6 Infrastructure Subsystem
- **EventBus**: Asynchronous event dispatch for UI updates (scan progress, generation logs, process exits).
- **Logger**: Centralized logging emitting structured JSON logs to both UI console and file storage.
- **ProcessManager**: Manages life cycles of child processes (Playwright workers, dev preview servers).

---

## 4. Rust vs TypeScript Boundary
- **Rust Responsibility**: Window management, OS-level file system I/O, SQLite database driver initialization, native menu handling, and spawn/kill operations for child processes.
- **TypeScript Responsibility**: All business logic, DOM parsing rules, UI state management, scan configuration, AI prompt orchestration, code synthesis algorithms, and view layer rendering.

---

## 5. Playwright Integration Model
- Playwright runs as a dedicated Node.js child process managed by the TypeScript/Rust infrastructure.
- **Communication via JSON-RPC-style messages over stdio** (newline-delimited JSON). *Resolved in Phase 3: WebSocket was rejected so the webview CSP `connect-src` is not widened.* See `docs/architecture/WORKER-PROTOCOL.md`.
- Supports multi-viewport rendering (`375x667` mobile, `768x1024` tablet, `1920x1080` desktop).
- Captures full-page screenshots and element-level bounding boxes for visual verification.

### 5.1 Phase 3 Runtime Foundation (as built)

Phase 3 established the process boundary and a **launch/navigate-only** browser runtime. Extraction/analysis is Phase 4.

- **Process boundary**: `src-tauri/src/process.rs` spawns the worker with `std::process::Command` (array args, no shell) and exposes four narrow commands: `process_spawn`, `process_write`, `process_kill`, `process_status`. The executable is allowlisted (`node`), arguments are validated, the environment is sanitized, and stdout/stderr stream as bounded lines over `process://stdout|stderr|exit` events.
- **Lifecycle (TS)**: `src/services/infra/processManager.ts` owns a guarded state machine (`not_started → starting → ready ⇄ busy → stopping → stopped`, plus `failed`), duplicate-start prevention, startup/communication timeouts (≤30s), graceful-then-forced shutdown, unexpected-exit handling, and bounded buffering. It is injectable via `ProcessSpawner` (Rust IPC in prod, fake in tests).
- **Protocol**: `src/services/infra/workerProtocol.ts` (shared with the worker via `src/workers/crawler/protocol.ts`) - versioned envelopes, correlation ids, deterministic JSON, runtime validation.
- **Browser runtime**: `src/services/browser/browserRuntime.ts` - detection/diagnostics without download, Chromium-only MVP, controlled launch/navigate/close. Non-blocking init from `App.tsx`; a missing browser is reported as `BROWSER_NOT_INSTALLED` and never blocks the UI.
- **Worker**: `src/workers/crawler/index.ts` runs via Node's native TypeScript stripping (`--experimental-strip-types`) and supports `ping` / `launch` / `navigate` / `close` / `extract` / `abort` / `detectLogin` / `captureState` / `captureViewport` / `captureAssets`. A second managed worker, `src/workers/cloneServer/`, serves the static clone (`serveClone` / `stopClone`).
- **Native assets (Phase 7)**: `src-tauri/src/asset.rs` exposes narrow `asset_write` / `asset_delete` commands confined to `<app_local_data_dir>/assets`, rejecting absolute paths and `..`. It is the only way generated binary assets (responsive screenshots) reach disk; the database stores only the relative path. **Phase 8** adds the parallel `src-tauri/src/clone.rs` (`clone_root` / `clone_write` / `clone_read` / `clone_delete`) confined to `<app_local_data_dir>/clones`.
- **Packaging limitation (deferred)**: the worker script and the Playwright browser are **not** bundled into the release artifact in Phase 3. Dev runs use source; release packaging (bundling the worker + installing the browser) is deferred to a later phase.

### 5.2 Phase 4 Crawler & Scan UI (as built)

Phase 4 turns the launch/navigate foundation into a working page crawler and wires it to the Scan screen. It extracts **page metadata/structure only** - no DOM snapshots, computed styles, HAR, screenshots, or assets (later phases).

- **Extraction & worker**: the worker (`src/workers/crawler/index.ts`) adds `extract`/`abort`; `extract` enforces the shared URL/network policy at the pre-navigation and post-redirect boundaries, pins sub-resource routing against prohibited IPs, and returns a bounded, normalized `NormalizedPage` (`src/services/scanner/extraction/`). See `docs/specs/SCANNER-SPEC.md` section 7.
- **Orchestration**: `src/services/scanner/crawlerService.ts` composes the frontier/scope/normalization + `scannerWorkerClient` + repositories + events + cancellation; `crawlLimits.ts` clamps all limits into hard bounds; `lifecycle.ts` is a pure scan state machine.
- **Persistence**: `scan_pages` (migration `002`) via `ScanPageRepository`; `scans` gains progress counters and live-scan queries. See `docs/architecture/DATABASE.md` section 2.2.
- **UI seam**: `src/services/scanner/scanService.ts` is the only module the UI uses to run a crawl. It validates the target, resolves the project, launches the shared browser session through `BrowserRuntime`, runs the crawl, and exposes cancellation. `src/stores/scanStore.ts` mirrors the crawl's own `scanner.*` events into real progress; `src/routes/ScanRoute.tsx` renders honest lifecycle states. The React UI still never touches Playwright or child processes - it goes through this service and consumes events.
- **Documented limitation (unchanged)**: packaging the worker + Chromium into the release artifact is still deferred; the crawler requires the desktop runtime (the browser preview reports an honest "desktop application required" state).

### 5.x Technology Detection Engine (Phase 5)

- **Engine**: `src/services/detector/` is a deterministic, rule-based engine consuming the bounded page evidence the crawler already captured (`PageTechEvidence`). It runs host-side (never in the browser worker) and makes **no network requests**; detection is a pure function of persisted evidence.
- **Separation**: evidence projection (`evidence.ts`), rule data (`rules.ts`), matching (`matcher.ts`), confidence (`confidence.ts`), version extraction (`version.ts`), and cross-page aggregation (`engine.ts`) are independent modules; new signatures are added to the rule table without touching the engine.
- **Integration**: `src/services/scanner/crawlerService.ts` runs detection after page batches are durable and before the scan reaches a terminal status, persists via `TechnologyRepository.upsertMany`, and emits `technology.scan_started` / `technology.detected` / `technology.scan_completed`.
- **UI seam**: `src/stores/technologyStore.ts` reads persisted rows (`scan_technologies`) as the source of truth and mirrors the `technology.*` events for live refresh; `src/components/scan/TechnologyPanel.tsx` renders them. The React UI never imports the engine internals.
- **Deferred**: no custom-rule file merge, no HAR-based `networkRequests`, no JS-global value inspection (presence only), and version detection is best-effort.

### 5.y Static Clone Engine & Local Asset Server (Phase 8, as built)

Phase 8 turns the crawled pages into a self-contained offline clone and serves it locally. It **fixes the Phase 4/7 critical gap** first: those phases persisted only metadata/structure, so the clone engine had no raw HTML or asset bytes.

- **Capture (worker)**: `extract` gains `captureHtml` (bounded raw HTML) and a new `captureAssets` command fetches a page's referenced assets (bounded base64, SHA-256 de-duplicated) with the shared URL policy applied to **every** asset URL. See `docs/architecture/WORKER-PROTOCOL.md` section 6.
- **Engine (pure)**: `src/services/clone/` - `clonePaths.ts` (traversal-safe path derivation), `htmlRewriter.ts` / `cssRewriter.ts` (CLONE-SPEC section 3-4 reference remapping; **dependency-free**, a documented deviation from the spec pseudocode), `mockClient.ts` (the section-5 stub), `manifest.ts` (the section-2 `manifest.json`). These are pure and directly unit-tested.
- **Orchestration**: `src/services/clone/cloneService.ts` builds the route/asset maps from persisted `scan_pages`, captures each page's HTML + assets via the worker, writes the rewritten tree, and returns an honest report. A page with no captured HTML is **skipped and counted**, never fabricated. `runClone.ts` is the UI seam (launch session → resolve clone root → run → close).
- **Storage**: `scan_assets` (migration `007`) via `AssetRepository`; `scan_pages.raw_html_path` records the raw HTML location. See `docs/architecture/DATABASE.md` section 2.6.
- **Native boundary**: `src-tauri/src/clone.rs` exposes `clone_root` / `clone_write` / `clone_read` / `clone_delete`, confined to `<app_local_data_dir>/clones` (the same hard sandbox as `asset.rs`). Clone output lives at `<clones>/v1/` (open decision C4: spec `CLONE-SPEC.md` section 6 over `DATABASE.md`).
- **Local preview server**: `src/workers/cloneServer/` is a `ProcessManager`-managed Node child that binds **loopback only**, serves strictly the canonical clone root (`serverPathPolicy` rejects traversal/absolute/NUL/backslash and re-verifies the symlink-resolved target), and is opened in the **system** browser so the webview CSP `connect-src` is never widened. See `docs/impl-plan/phase-8-impl-plan.md` (open decision C5).
- **UI seam**: `src/stores/cloneStore.ts` reads persisted `scan_assets` as the source of truth and mirrors the `clone.*` events; `src/components/clone/ClonePanel.tsx` renders honest loading/empty/error/partial states. The React UI never imports the engine internals.
- **Deferred**: ZIP export / native folder-explorer trigger (`CLONE-SPEC.md` section 6.2-6.3; no `zip` crate dependency) and full CSS bundling/minification. Tailwind responsive-rule synthesis remains deferred Phase 7 work and is **not** part of Phase 8.

### 5.z Website Blueprint Specification & Normalization Engine (Phase 9, as built)

Phase 9 normalizes the captured evidence into the schema-validated `blueprint.json` (`BLUEPRINT-SPEC.md`). It **fixes its own critical gap** first: no prior phase persisted a traversable DOM or any computed-style evidence, so the engine could not normalize from page metadata alone.

- **Capture (worker, prerequisite)**: a new additive `captureBlueprint` command (`src/workers/crawler/blueprintCapture.ts`) navigates under the shared URL policy (pre-navigation + final-URL checks, exactly as `extract`/`captureAssets`) and returns a bounded semantic DOM tree + computed-style subset, CSS custom properties, `@font-face` metadata, form structure, nav regions, headings, links, and images (URL/alt only). It is **secret-free**: no cookie/storage values, input `value`s, password contents, or `Authorization` headers are ever read; attributes are allowlisted and `script`/`style` bodies stripped. See `docs/architecture/WORKER-PROTOCOL.md` section 7.
- **Schema (single validator)**: `src/types/blueprint.ts` mirrors `BLUEPRINT-SPEC.md` sections 3-4 as a strict Zod schema (`blueprint_version: 1`, all required sections, `.strict()` objects, bounded recursion: component depth/cycle detection, page/route/component counts, navigation depth) plus an **optional, additive** `provenance` namespace and optional per-node `confidence` separating observed evidence from inferred classification. `zod` is a new runtime dependency.
- **Engine (pure)**: `src/services/blueprint/` - `domNormalizer` (bounded DOM -> component segmentation), `designTokens` (colors/typography/spacing/radii/shadows from computed styles), `routes` (pages/routes/navigation + dynamic-route inference), `forms`, `content`, `assets`, `technologies`, `site`, `analytics`, `infrastructure`, `evidence` (provenance), `assemble`, `validate`, and `util`. `blueprintService` composes them; `runBlueprint` is the pure synthesis entrypoint (reads storage only). Missing/conflicting evidence is represented as absent/empty, never fabricated.
- **Lifecycle & persistence**: `src/services/blueprint/blueprintLifecycle.ts` runs synthesis -> writes the document through the sandboxed `blueprint_write` seam -> upserts the `blueprints` row -> emits `blueprint.*`. It **never throws**: synthesis/file/persistence failures return an honest outcome with `failed: true`, so a Blueprint problem can never change a crawl's terminal status. The file is written before the row; if the row write fails the file is rolled back (no orphan). A re-run computes `version + 1` (UNIQUE `(scan_id, version)`). An **invalid** document is persisted with `is_valid = 0` + bounded `validation_errors` rather than discarded.
- **Storage**: `blueprints` (migration `008`) via `BlueprintRepository`; `scan_pages.blueprint_evidence_path` records the captured evidence location. The document itself lives at `<app_local_data_dir>/blueprints/v1/<id>.json` (open decision C11: sandbox over the `DATABASE.md` per-project path), so the DB (exported as one WASM buffer) stays small. See `docs/architecture/DATABASE.md` section 2.7.
- **Native boundary**: `src-tauri/src/blueprint.rs` exposes `blueprint_root` / `blueprint_write` / `blueprint_read` / `blueprint_delete`, confined to `<app_local_data_dir>/blueprints` (the same hard sandbox as `asset.rs`/`clone.rs`), with atomic temp-file writes and a 64 MiB cap.
- **Integration point**: `src/services/scanner/scanService.ts` runs the lifecycle after a COMPLETED crawl, after technology detection and the optional responsive/evidence steps, gated by `runScan({ blueprint: true })`. The honest outcome is attached as `ScanRunOutcome.blueprint`.
- **UI seam**: `src/stores/blueprintStore.ts` reads persisted rows as the source of truth and mirrors the `blueprint.*` events; `src/components/blueprint/BlueprintPanel.tsx` renders honest `idle | loading | empty | ready | partial | error` states with a validator badge and JSON export. The React UI never imports the engine internals.
- **Deferred**: AI/LLM synthesis (Phase 10-11), code generation (Phase 12), visual diffing (Phase 13), doc/ZIP export (Phase 14), and Tailwind responsive-rule inference from responsive captures (deferred Phase 7 work).

---

## 6. Frontend Skill Requirement
- Any frontend implementation or UI refactoring task MUST adhere to `C:\Users\Kakarama Room\.agents\skills\anti-ui-slop\SKILL.md`.
