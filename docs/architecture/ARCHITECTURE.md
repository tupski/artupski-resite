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
- **Worker**: `src/workers/crawler/index.ts` runs via Node's native TypeScript stripping (`--experimental-strip-types`) and only supports `ping` / `launch` / `navigate` / `close`.
- **Packaging limitation (deferred)**: the worker script and the Playwright browser are **not** bundled into the release artifact in Phase 3. Dev runs use source; release packaging (bundling the worker + installing the browser) is deferred to a later phase.

### 5.2 Phase 4 Crawler & Scan UI (as built)

Phase 4 turns the launch/navigate foundation into a working page crawler and wires it to the Scan screen. It extracts **page metadata/structure only** - no DOM snapshots, computed styles, HAR, screenshots, or assets (later phases).

- **Extraction & worker**: the worker (`src/workers/crawler/index.ts`) adds `extract`/`abort`; `extract` enforces the shared URL/network policy at the pre-navigation and post-redirect boundaries, pins sub-resource routing against prohibited IPs, and returns a bounded, normalized `NormalizedPage` (`src/services/scanner/extraction/`). See `docs/specs/SCANNER-SPEC.md` section 7.
- **Orchestration**: `src/services/scanner/crawlerService.ts` composes the frontier/scope/normalization + `scannerWorkerClient` + repositories + events + cancellation; `crawlLimits.ts` clamps all limits into hard bounds; `lifecycle.ts` is a pure scan state machine.
- **Persistence**: `scan_pages` (migration `002`) via `ScanPageRepository`; `scans` gains progress counters and live-scan queries. See `docs/architecture/DATABASE.md` section 2.2.
- **UI seam**: `src/services/scanner/scanService.ts` is the only module the UI uses to run a crawl. It validates the target, resolves the project, launches the shared browser session through `BrowserRuntime`, runs the crawl, and exposes cancellation. `src/stores/scanStore.ts` mirrors the crawl's own `scanner.*` events into real progress; `src/routes/ScanRoute.tsx` renders honest lifecycle states. The React UI still never touches Playwright or child processes - it goes through this service and consumes events.
- **Documented limitation (unchanged)**: packaging the worker + Chromium into the release artifact is still deferred; the crawler requires the desktop runtime (the browser preview reports an honest "desktop application required" state).

---

## 6. Frontend Skill Requirement
- Any frontend implementation or UI refactoring task MUST adhere to `C:\Users\Kakarama Room\.agents\skills\anti-ui-slop\SKILL.md`.
