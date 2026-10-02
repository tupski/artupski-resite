# Changelog

All notable changes to the Artupski ReSite project specification and architecture will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Phase 13 - Visual verification & diff engine

Compares an original captured website against the generated project's rendering: it launches the
generated project's built output on a loopback-only managed server, screenshots it at the same
viewports as the Phase 7 captures, and computes a pixel diff image plus a similarity score. It is a
**service-layer + UI** increment with a **dependency-free** diff core: **no new worker, no new
runtime dependency**, and `WORKER_PROTOCOL_VERSION` stays `1`.

- **Pure diff core**: `src/services/diff/visualDiff.ts` exposes `computeVisualDiff(original,
  comparison, options)` over two RGBA buffers. It returns an exact mismatched-pixel count, a
  similarity percentage, a colour-coded (magenta/red) diff image, and bounded discrepancies. A size
  mismatch is an error unless `allowSizeMismatch` pads to a common canvas (and then the difference is
  reported, never hidden). A wide contiguous mismatch is surfaced as a `layout_shift`; otherwise the
  discrepancy is a generic `pixel_mismatch`.
- **Dependency-free PNG codec**: `src/services/diff/png.ts` decodes/encodes 8-bit non-interlaced
  RGB/RGBA PNGs with a self-contained DEFLATE inflate (stored/fixed/dynamic Huffman) and a
  stored-block zlib encode, so it runs identically in the Tauri webview, Node, and jsdom. The
  roadmap's "Pixelmatch" reference is an example; no `pngjs`/`pixelmatch` dependency is added.
- **Service**: `src/services/diff/diffService.ts` exposes `runVisualDiff(projectRoot, request, deps)`.
  It starts the generated project's `dist/` output on a loopback-only managed server, captures each
  route at the requested viewports through the Phase 3 browser worker (`captureViewport`), reads the
  matching Phase 7 original capture, and returns an honest `VisualDiffReport`. All collaborators are
  injectable; the service never throws past its boundary, and a single viewport failing sets
  `partial` rather than failing the run.
- **Server reuse**: `src/services/diff/generatedServer.ts` reuses the Phase 8 clone preview server
  (loopback + root confinement via the shared `serverPathPolicy`) to serve the generated `dist/`
  tree; no install or framework dev server is needed at diff time.
- **Native boundary**: `src-tauri/src/asset.rs` adds a READ-only `asset_read` command (same
  validation and containment as `asset_write`) so the diff engine can read the original screenshot
  from the sandboxed `assets/` root; the TS wrapper is `assetRead` in `src/services/ipc/commands.ts`.
- **Events**: a bounded `diff.*` domain (`started`, `captured`, `computed`, `completed`, `failed`)
  carries viewport names, counts, and a similarity percentage only - never image bytes or page text.
- **UI**: `src/components/diff/DiffViewer.tsx` (backed by `src/stores/diffStore.ts`, wired into
  `ScanRoute`) renders side-by-side, slider-overlay, and colour-coded diff modes with a mismatch/score
  header and a discrepancy inspector, plus honest `idle | running | ready | partial | error` states.
  The generated project root is caller-supplied (Phase 12 added no UI/persistence), so nothing is
  guessed. Reuses the existing `Panel`/`Badge`/`Button`/`EmptyState` primitives.
- **Tests**: `src/services/diff/__tests__/` (visualDiff core, PNG codec, service, paths/server),
  `src/stores/diffStore.test.ts`, and `src/components/diff/DiffViewer.test.tsx` - **51 new tests**
  covering happy paths, invalid input, boundary conditions, failure isolation, abort, and
  security-sensitive path/traversal cases. Full suite: **865 passed / 24 skipped**.
- **Deviations** (see `docs/impl-plan/phase-13-impl-plan.md` §17): no `pixelmatch`/`pngjs`
  dependency; the Phase 8 server worker is reused; original images come from the Phase 7 persisted
  captures rather than a fresh live capture. **Deferred**: doc/ZIP export (Phase 14).

### Phase 12 - Full-stack project generator (Vite + React + TS + Tailwind)

Assembles a complete, runnable, **standalone** Vite + React 18 + TypeScript 5 + Tailwind 3 project
from a validated Phase 9 Blueprint plus the Phase 11 synthesized components (and optional hook/asset
inputs). It is an opt-in **service-layer** increment: **no new worker, IPC command, database
migration, or runtime dependency**, and `WORKER_PROTOCOL_VERSION` stays `1`.

- **Generator service**: `src/services/generator/projectGenerator.ts` exposes `generateProject(deps,
  input)`; it is deterministic, provider-agnostic (no AI import), never executes generated code, and
  never throws past its boundary. Types live in `src/types/projectGen.ts`.
- **Templates**: `src/templates/project/` renders `index.html`, `package.json`, `tsconfig.json` /
  `tsconfig.node.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `.gitignore`,
  `src/main.tsx`, `src/App.tsx`, `src/router.tsx`, `src/tokens.ts`, and `src/styles/index.css`. The
  generated project depends only on React, React Router, `clsx`, and `tailwind-merge`.
- **Routes**: Blueprint routes feed a generated `createBrowserRouter` config; a route referencing a
  missing page is dropped with a recorded reason; required component props are filled with neutral
  Blueprint defaults so pages type-check.
- **Design tokens**: the Blueprint `design_system` is projected verbatim into `src/tokens.ts` (Tailwind
  theme extension) and CSS custom properties; absent categories are empty and nothing is fabricated.
- **Security & limits**: `src/services/generator/projectPaths.ts` confines every generated path to a
  single `targetRoot`, rejecting `..`, absolute, Windows drive, UNC, backslash, and control-character
  paths. Emission is staged (validate all, then atomic per-file writes). Bounded caps:
  `MAX_PROJECT_FILES` (2000), `MAX_PROJECT_FILE_BYTES` (1 MiB), `MAX_PROJECT_TOTAL_BYTES` (64 MiB),
  `MAX_PROJECT_COMPONENTS` (500), `MAX_PROJECT_ASSETS` (500), `MAX_PROJECT_PATH_DEPTH` (16).
- **Failure isolation**: malformed components/assets are skipped and reported (`partial`); an invalid
  Blueprint writes nothing; cancellation returns `aborted: true` and removes the partial root unless
  `keepPartial`.
- **Events**: `project.started`, `project.file_generated`, `project.completed` added to the EventBus
  payload map (`src/services/infra/eventBus.ts`); payloads carry paths/counts/bytes only, never file
  contents.
- **Tests**: focused `projectGenerator*.test.ts` + `projectPaths.test.ts` suites, plus an opt-in real
  build E2E (`projectGenerator.build.e2e.test.ts`, `RUN_PROJECT_BUILD=1`) that runs the generated
  project's own `npm install && npm run build` and asserts `dist/` exists — verified PASS.
- **Deviations**: Vite only (not the spec's multi-framework adapter table); no Prettier pass; no
  `build_tmp` directory rename. See `docs/impl-plan/phase-12-impl-plan.md` §11.

### Phase 11 - AI-powered component extraction & synthesis

Turns a validated Phase 9 Blueprint into clean React + Tailwind TSX components using the Phase 10
AI engine. It is an opt-in **service-layer** increment: **no new worker, IPC command, database
migration, or runtime dependency**, and `WORKER_PROTOCOL_VERSION` stays `1`.

- **Prompt engineering**: `src/services/ai/prompts/componentPrompt.ts` authors a fixed, trusted
  instruction for one component and always prepends the AI-SPEC §5.1 security directives via
  `buildSystemPrompt`. All Blueprint/HTML/CSS evidence is untrusted and isolated in
  `<DATA_PAYLOAD>` by the Phase 10 pipeline; no crawler text is concatenated into the prompt.
- **Chunking & payload**: `src/services/generator/componentPayload.ts` projects one component at a
  time into a bounded, deterministic payload (variant/prop/token/fragment caps, sorted) — the
  AI-SPEC §3.2 chunking strategy that keeps massive DOM trees within the model context window.
- **Synthesis**: `src/services/generator/componentSynthesizer.ts` depends on a narrow
  `ComponentSynthesisEngine` seam (`{ generate }`) satisfied by the Phase 10 `AiEngine`; it never
  imports a provider. Output is structured JSON validated by `ComponentOutputSchema` (Zod,
  `src/services/generator/componentSchema.ts`) with bounded repair (`maxRepairAttempts: 1`) and a
  `componentId` echo cross-check. Types live in `src/types/componentSynth.ts`.
- **JSX cleanliness optimizer**: `src/services/generator/jsxCleanliness.ts` is a deterministic gate
  that rejects unsafe constructs (`<script>`, `dangerouslySetInnerHTML`, `eval`, `Function`,
  `require`, dynamic `import`, `process.env`), unbalanced/excessive nesting, a missing component
  declaration, and AI-slop (filler prose, comments, `any`/`@ts-ignore`, `console.*`, empty
  handlers, unused imports), then normalizes whitespace/import order. Generated code is never
  executed — validation is textual.
- **Honesty & isolation**: a `componentId` mismatch or a cleanliness failure marks that component
  `failed` with a bounded structured error; other components continue. Cancellation stops remaining
  work and reports `aborted`. A Blueprint that fails validation is refused without fabrication.
- **Events**: `src/services/infra/eventBus.ts` adds a bounded `component.*` domain (`started`,
  `generated`, `failed`, `completed`) carrying ids/counts only — never generated code or evidence.
- **Tests**: `src/services/generator/__tests__/*` and
  `src/services/ai/prompts/__tests__/componentPrompt.test.ts` cover payload bounding, prompt
  isolation, schema/echo validation, unsafe/sloppy rejection, failure isolation, cancellation,
  event emission, deterministic identifier de-duplication, and file-name sanitization.
- **Deferred**: persisting/emitting generated files and project assembly (Phase 12), visual diffing
  (Phase 13), doc/ZIP export (Phase 14). Phase 11 adds no UI and does not wire into the scan
  lifecycle. **Recorded deviation**: "render matching UI" is implemented as evidence-grounded,
  framework-idiomatic TSX, not pixel equivalence (Phase 13 owns pixel diffing).

### Phase 10 - AI provider abstraction & engine

A **provider-agnostic AI engine** in the TypeScript layer for any OpenAI-compatible REST endpoint (OpenAI, OpenRouter, 9Router, Ollama, LM Studio, LocalAI/vLLM, or a custom base URL). It performs a real health check, structured-output generation with bounded self-repair, and defensive untrusted-data isolation. **No new process manager, browser runtime, worker, or migration was created**; the engine is a plain TypeScript service in the main process and `WORKER_PROTOCOL_VERSION` stays `1`.

- **Provider client**: `src/services/ai/provider.ts` — one `OpenAICompatibleProvider` for `GET /models` and `POST /chat/completions` with non-streaming and SSE **streaming**, `response_format: json_object`, per-request timeouts, abort signals, and usage/finish-reason normalization. `fetch` is injectable for tests, so the whole wire path is exercised without a live network. Every transport/HTTP failure maps to a redacted `StructuredError` in the reserved `ai` category (`API_KEY_INVALID` 401/403, `RATE_LIMIT_EXCEEDED` 429, `CONTEXT_LENGTH_EXCEEDED` 413/context 400, `IPC_ERROR`, `CONNECTION_TIMED_OUT`); the API key never appears in any message.
- **Presets & health check**: `src/services/ai/presets.ts` encodes the `AI-SPEC.md` §2.2 matrix and `validateBaseUrl` enforces http(s) with no embedded credentials. `validateCredentials()`/`listModels()` perform a real `/models` round-trip; an empty model list is still a successful connection (never a false failure or false success).
- **Structured output pipeline**: `src/services/ai/pipeline.ts` (`GenerationPipeline`) sanitizes + wraps the payload in `<DATA_PAYLOAD>` (embedded boundary tags escaped via `payload.ts`), guards the token budget, requests JSON, extracts JSON (raw or fenced), validates with **Zod**, and runs **bounded repair passes** before failing honestly with `MALFORMED_OUTPUT`. `src/services/ai/tokenBudget.ts` implements `MODEL_BUDGET_PROFILES` from `AI-SPEC.md` §3.1 and rejects over-budget tasks with `CONTEXT_LENGTH_EXCEEDED` before any network call.
- **Prompt isolation**: `src/services/ai/prompts/systemPrompt.ts` carries the verbatim `AI-SPEC.md` §5.1 security directives; app-authored task instructions are appended after the base directives, and crawled/Blueprint content is only ever placed inside the escaped `<DATA_PAYLOAD>` block. Injected phrases are preserved as literal text and can never break out of the boundary.
- **Configuration & persistence**: `src/services/ai/config.ts` stores `ai.config` (non-secret JSON) and `ai.credentials` (the API key) in the existing **`app_settings`** table — **no migration**. The key is stored under a separate key, never logged, never emitted in events, and masked (`type=password`) in the UI.
- **Engine & events**: `src/services/ai/engine.ts` (`createAiEngine`) resolves config+key → provider, exposes `loadConfig`/`saveConfig`/`isConfigured`/`healthCheck`/`chatCompletion`/`generate`, and never throws. A new bounded `ai.*` event domain (`config_saved`, `connection_started|verified|failed`, `generation_started|completed|failed`) carries ids/counts only — never secrets, headers, or prompt/completion content.
- **UI**: `src/stores/aiStore.ts` mirrors the persisted config and the last real health check with honest `unconfigured | idle | testing | ready | error` states (no fabricated "connected" badge); `src/components/settings/AiProviderPanel.tsx` renders the provider form, model list, and connection test, wired into `SettingsRoute`.
- **Tests**: `src/services/ai/__tests__/` — presets, token budget, payload/injection, pipeline (repair + budget), provider (chat/SSE/errors/redaction), config (secret isolation), and engine (`ai.*` events). Store and panel tests cover the honest states. An opt-in real-socket E2E against a local mock OpenAI-compatible server runs under the `node` environment (`RUN_AI_TESTS=1 npx vitest run src/services/ai`).
- **Deferred**: component/HTML→React synthesis (Phase 11), full project generation (Phase 12), visual diffing (Phase 13), doc/ZIP export (Phase 14), OS-keychain credential storage (Phase 15). Phase 10 does not wire the engine into the scan lifecycle.

### Phase 9 - website blueprint specification & normalization engine

Produces one schema-validated `blueprint.json` document per scan: a framework-agnostic intermediate representation normalizing captured DOM, page metadata, design tokens, routing topology, components, forms, and detected technologies into the exact structure of `BLUEPRINT-SPEC.md`. **No new process manager, browser runtime, or crawler was created**; the worker protocol was extended additively and `WORKER_PROTOCOL_VERSION` stays `1`.

- **Prerequisite evidence capture (critical-gap fix, mirrors Phase 8)**: the Blueprint normalizes parsed DOM + computed styles, but no prior phase persisted a traversable DOM or computed-style evidence. A new bounded, read-only worker command `captureBlueprint` (`src/workers/crawler/blueprintCapture.ts`) navigates with the shared URL policy (pre-navigation + final-URL checks) and returns a bounded semantic DOM tree + computed-style subset, CSS custom properties, `@font-face` metadata, form structure, nav regions, headings, links, and images (URL/alt only). Caps: `MAX_BLUEPRINT_NODES` (5000), `MAX_BLUEPRINT_BYTES` (4 MiB), `MAX_BLUEPRINT_TEXT_CHARS` (200), `MAX_BLUEPRINT_FORMS` (50), `MAX_BLUEPRINT_CSS_VARS` (500), plus per-depth/per-category caps; over-cap content is truncated and flagged. **No secrets**: the probe never reads cookie/storage values, input `value`s, password contents, or `Authorization` headers; attributes are allowlisted and `script`/`style` bodies are stripped.
- **Schema**: `src/types/blueprint.ts` is the single runtime validator - a strict Zod schema mirroring `BLUEPRINT-SPEC.md` sections 3-4 (`blueprint_version: 1`, all required sections, bounded recursion with depth/cycle/count limits and `.strict()` objects) plus an **optional, additive** `provenance` namespace and optional per-node `confidence` distinguishing observed evidence from inferred classification. **New runtime dependency `zod@^3.23.8`** (the spec's authoritative validator is Zod; the repo had none).
- **Normalization engine**: `src/services/blueprint/` - `domNormalizer`, `designTokens`, `routes`, `forms`, `content`, `assets`, `technologies`, `site`, `analytics`, `infrastructure`, `evidence`, `assemble`, `validate`, `util` (pure) composed by `blueprintService`, with `runBlueprint` as the UI seam. Missing/conflicting evidence is represented as absent/empty, never fabricated.
- **Persistence**: forward-only migration `008_blueprints.ts` (version 8) creates `blueprints` (matching the `DATABASE.md` section 3 sketch; UNIQUE `(scan_id, version)` so re-runs update a revision) and adds nullable `scan_pages.blueprint_evidence_path`; `BlueprintRepository` owns all its SQL. The document lives at `<app_local_data_dir>/blueprints/v1/<id>.json` through a new sandboxed `src-tauri/src/blueprint.rs`; only the path + validation metadata are stored in SQLite. See `DATABASE.md` section 2.7.
- **Lifecycle**: `blueprintLifecycle.ts` runs synthesis -> writes the document -> upserts the row (rolling the file back if the row write fails) -> emits `blueprint.*`, and **never throws**. Integrated in `scanService.runScan` after a COMPLETED crawl (after technology/responsive/evidence steps), gated by `runScan({ blueprint: true })`; a Blueprint failure can never change the crawl's terminal status. An **invalid** document is persisted with `is_valid = 0` rather than discarded. IPC: `blueprintGenerate` / `blueprintGetLatest` / `blueprintExport`.
- **UI**: a read-only `BlueprintPanel` (`src/components/blueprint/BlueprintPanel.tsx`, backed by `src/stores/blueprintStore.ts`) on the Scan route with honest `idle | loading | empty | ready | partial | error` states, a validator badge, and JSON export. Nothing is fabricated.
- **Events**: `blueprint.started`, `blueprint.generated`, `blueprint.validation_failed`, `blueprint.completed` payload contracts added to the taxonomy (ids/counts/validity/bounded messages only, no document bytes or secrets). Ordering: `started` -> (`generated` | `validation_failed`) -> `completed`.
- **Tests**: schema (valid/rejection/bounds/cycles/provenance), migration `008` + `BlueprintRepository` (checksum/cascade/reopen), `captureBlueprint` protocol validation + pure harness, the normalization units (dom/tokens/routes/forms/technologies/evidence/service), lifecycle (round-trip/regeneration/invalid-persistence/no-orphan/event order), `scanServiceBlueprint` integration + failure isolation + opt-out, `blueprintStore` honest states, and an **opt-in real-Chromium** E2E (`blueprintCapture.e2e.test.ts`, fixture port 3000) asserting bounded landmark/token/form evidence and that no planted secret leaks.
- **Documented decisions (C8-C13)**: resolved in `docs/impl-plan/phase-9-impl-plan.md` section 15 - **C8** optional additive provenance; **C9** concrete navigation-item schema (spec §4 `z.array(z.any())` is a validator omission; §3 types them); **C10** state via `interactions[]` + `variants` (no non-spec `state` section); **C11** output at `<app_local_data_dir>/blueprints/v1/` (sandbox over the `DATABASE.md` per-project path); **C12** new additive `captureBlueprint` command + persisted evidence path (not a second crawler); **C13** opt-in synthesis via `runScan({ blueprint: true })`.
- **Deferred / out of scope**: AI/LLM synthesis (Phase 10-11), code generation (Phase 12), visual diffing (Phase 13), doc/ZIP export (Phase 14), and Tailwind responsive-rule inference from responsive captures (deferred Phase 7 work).

### Phase 8 - static clone engine & local asset server

Generates a self-contained, offline static clone of a scanned site and serves it from a local preview server. **No new process manager or browser runtime was created**; the worker protocol was extended additively and `WORKER_PROTOCOL_VERSION` stays `1`.

- **Critical-gap fix (Phase 4/7 never persisted raw HTML or asset bytes)**: the worker `extract` command gains a bounded `captureHtml` option (4 MiB cap, truncated + flagged), and a new `captureAssets` command fetches a page's referenced assets (stylesheet/script/image/media) with the shared `evaluateUrlPolicy` applied to **every** asset URL and de-duplication by SHA-256 (caps: 200 assets, 8 MiB each; over-cap assets are dropped and counted, never substituted).
- **Persistence**: forward-only migration `007_scan_assets.ts` (version 7) creates `scan_assets` (with a UNIQUE `(scan_id, sha256)` de-dupe index, a `page_url` field, FK cascade, and the `asset_type` CHECK) and adds a nullable `scan_pages.raw_html_path` column. `AssetRepository` owns all its SQL. See `DATABASE.md` section 2.6.
- **Engine**: `src/services/clone/` - pure `clonePaths` (traversal-safe paths), `htmlRewriter` / `cssRewriter` (CLONE-SPEC sections 3-4), `mockClient` (section 5), and `manifest` (section 2), composed by `cloneService`; `runClone` is the UI seam. Asset bytes are written to disk, only metadata + the relative path are persisted. A page whose HTML cannot be captured is **skipped and counted**, never fabricated.
- **Native boundary + local server**: `src-tauri/src/clone.rs` adds `clone_root` / `clone_write` / `clone_read` / `clone_delete`, confined to `<app_local_data_dir>/clones` (same hard sandbox as `asset.rs`). `src/workers/cloneServer/` is a `ProcessManager`-managed Node child that binds loopback-only, serves strictly the canonical clone root (`serverPathPolicy` rejects traversal/absolute/NUL/backslash and re-verifies the symlink-resolved target), and is opened in the system browser so the webview CSP `connect-src` is never widened.
- **UI**: a `ClonePanel` on the Scan route (backed by `src/stores/cloneStore.ts`) offers "Generate static clone" + a local preview, with honest loading/empty/error/partial states; a partial run lists skipped pages/assets.
- **Events**: `clone.started`, `clone.file_generated`, `clone.asset_downloaded`, `clone.server_started`, `clone.server_stopped`, `clone.completed`, `clone.failed` added to the taxonomy (counts/paths/SHAs only, no file contents).
- **Tests**: path/rewriter/CSS/manifest/server-policy units, migration 007 + `AssetRepository` (+ de-dupe/cascade/reopen) tests, protocol validation for the new frames, the `cloneService` orchestration (including the honest skip path), `cloneStore` state tests, and an **opt-in real-Chromium** E2E (`cloneCapture.e2e.test.ts`, fixture port 4173) that captures raw HTML + assets and asserts a self-contained rewrite.
- **Documented deviations**: the CLONE-SPEC rewriter pseudocode's parser dependencies (`htmlparser2`/`dom-serializer`/`css-select`) are not project dependencies, so a bounded dependency-free rewriter is used. **Deferred**: ZIP export and the native folder-explorer trigger (CLONE-SPEC section 6.2-6.3; no `zip` crate dependency), and full CSS bundling/minification. Tailwind responsive-rule synthesis remains deferred Phase 7 work and is **not** part of Phase 8.
- **Open decisions**: C3-C7 resolved in `docs/impl-plan/phase-8-impl-plan.md` section 10.

### Phase 7 - responsive layout & viewport analysis

Multi-viewport capture on top of the Phase 4 crawler. **No new process manager, browser runtime, or crawler was created**; the worker protocol was extended additively and `WORKER_PROTOCOL_VERSION` stays `1`.

- **Worker/protocol**: new `captureViewport` command renders one page under a single emulation profile (desktop 1440×900, tablet 768×1024, mobile 375×812) in a fresh isolated context and returns a full-page PNG (base64, bounded), a bounded visible-element map, and the media-query breakpoints the page declares. Profiles are validated on the wire (`isViewportProfile`, dimension cap 4320). The screenshot is dropped (with `truncated: true`) when it exceeds 12 MiB.
- **Persistence**: forward-only migration `006_responsive_captures.ts` (version 6) adds `responsive_captures` (one row per page + profile, `screenshot_path` + JSON `detected_breakpoints`/`element_map`, `ON DELETE CASCADE`); `ResponsiveCaptureRepository` owns all its SQL. Screenshots are written to disk (a new sandboxed Rust `asset_write`/`asset_delete` module confined to `<app_local_data_dir>/assets`, rejecting absolute paths and `..`), so the database stays small.
- **Service**: `src/services/scanner/responsiveScanner.ts` orchestrates capture after a completed crawl (opt-in via `scanService.runScan({ viewportProfiles })`), writing screenshots and persisting metadata. A per-profile failure is recorded as a skip and never changes the crawl's terminal status.
- **UI**: the Scan screen's viewport toggles are now enabled (were `Deferred`); a `ViewportPreview` gallery (`src/components/scan/ViewportPreview.tsx`, backed by `src/stores/responsiveStore.ts`) shows per-breakpoint captures with honest loading/empty/error states. No screenshot or breakpoint is fabricated.
- **Events**: `responsive.captured` added to the taxonomy (counts only, no secret material).
- **Tests**: profile selection + path sanitisation + orchestration units, migration + repository (+ cascade/reopen) tests, protocol validation tests, and an **opt-in real-Chromium** E2E (`responsiveCapture.e2e.test.ts`) that asserts the desktop and mobile captures are distinct (different screenshot bytes; `nav` visible on desktop, hidden on mobile) and that media-query breakpoints are detected.
- **Documented limitation**: the Tailwind responsive-rule synthesizer (inferred `hidden md:flex` classes; `desktopPattern`/`mobilePattern` classification) from `RESPONSIVE-SPEC.md` section 4 is deferred to a later phase. This phase delivers the acceptance criterion's screenshots + visible-element maps + detected breakpoints.

### Phase 5 - authentication & session scanning

Authentication and session scanning on top of the Phase 3 browser foundation and Phase 4 crawler. **No new process manager, browser runtime, or crawler was created**; the worker protocol was extended additively and `WORKER_PROTOCOL_VERSION` stays `1`. A captured session is encrypted at rest, injected into an isolated browser context, and never logged or transmitted.

- **Crypto/persistence**: `src/services/auth/crypto.ts` implements AES-256-GCM with a PBKDF2 (100k, SHA-512) derived key. Forward-only migration `004_auth_sessions.ts` (version 4) adds `auth_sessions` with a partial UNIQUE index enforcing **one active session per project**; migration `005_scan_page_auth.ts` (version 5) adds `scan_pages.auth_status`. `001`–`003` are untouched. `AuthSessionRepository` (the only SQL for the table) performs the save/deactivate/purge/delete lifecycle.
- **Interactive capture window (delivered)**: `AUTH-SCANNING.md` section 2.1's headed interactive capture is implemented. `BrowserRuntime.launchCaptureSession()` opens a headed window (`launch` with `capture: true`), the user logs in manually, and `BrowserRuntime.captureSessionState()` uses the new worker `captureState` command to return a **host-scoped** storage state (cookies/origins not belonging to the sign-in host are dropped; `sessionStorage` is read from the signed-in same-origin pages because `storageState()` omits it). `authSessionService.beginInteractiveCapture` / `completeInteractiveCapture` / `cancelInteractiveCapture` drive the flow and reuse the existing encrypt+persist path. The capture context MUST be headed and MUST NOT carry an injected `authState` (enforced at the protocol boundary and in the worker), so a capture context can never silently become a scan context. No credential is ever automated, read, logged, or persisted. Split across separate requests, so a human login is never bounded by the 30s worker request ceiling.
- **Crypto (spec reconciliation)**: `AUTH-SCANNING.md` section 4.1 and `SECURITY.md` section 3.1 both mandate **PBKDF2 (100k, SHA-512)**; the earlier Argon2id mention was a stale draft and the docs/comment are now consistent. AES-256-GCM with a fresh IV per encryption; tampered ciphertext, wrong seed/salt, truncated tag, and malformed Base64 all fail closed with `STORAGE_READ_FAILED` (Base64 decoding moved inside the guard).
- **Classification honesty**: `authenticated` is documented in code, spec, and UI as "scanned with a session in effect", NOT independently proven protection. No UI renders `authStatus`, so nothing overclaims.
- **Worker**: `launch` accepts an optional `authState` and an optional `capture` flag; the worker creates an explicit isolated Playwright context for every session (`storageState` applied in-memory only). `detectLogin` (pure presence probe) and the new `captureState` command (host-scoped snapshot, capture sessions only) extend the protocol without capturing any secret through automation.
- **Crawler**: `src/services/scanner/authClassifier.ts` assigns each page `public` / `authenticated` / `auth_required` / `blocked` / `unknown`. An auth-walled page is never a completed/authenticated result: its links are not enqueued and, when authentication was required, the scan is recorded `failed`, not `completed`.
- **UI**: `ScanRoute`'s Authentication panel (backed by `src/stores/authStore.ts`) gains a real capture flow (`src/components/auth/AuthCapturePanel.tsx`): sign-in URL input, "Open login window", "Capture Session", cancel, and honest states (`launching`/`awaiting_login`/`capturing`/`saved`/`error`). No secrets are rendered; success is shown only after the session is persisted.
- **Events/Errors**: `auth.completed`, `auth.session_cleared`, `auth.session_expired`, and `auth.scan_started` added to the taxonomy (no secret material in any payload).
- **Tests**: crypto round-trip/tamper/wrong-seed-wrong-salt/malformed-Base64/truncated-tag/redaction, page-classifier taxonomy incl. the session-use caveat and conflicting-signal precedence, `auth_sessions` migration + repository + cascade/reopen, `authSessionService` capture/load/clear/purge + no-plaintext-persistence, worker-protocol `authState`/`detectLogin`/`captureState` (incl. capture-invariant) validation, browser auth injection + `detectLogin` + capture lifecycle, authenticated crawler integration, the honest UI panel, and an **opt-in real-Chromium** headed-capture E2E (`authCapture.e2e.test.ts`) that opens a headed window, simulates login against a local fixture, captures + encrypts + replays the state, and reaches the protected fixture page.

### Phase 6 - technology detection (delivered before Phase 5; numbering unchanged)

Rule-based technology detection running over the evidence the Phase 4 crawler already collects. **No new network access** is introduced: detection consumes bounded, persisted page evidence only. No authentication, responsive capture, AI, or blueprint/clone/project generation.

- **Evidence capture (Phase 4 extension, authorized)**: the in-page extractor and worker now also collect a bounded `PageTechEvidence` record per page - response headers, cookie **names only** (never values), script `src` URLs, technology-relevant `<meta>` tags, distinctive DOM markers, boolean JS-global presence probes (no page script is executed), and a length-capped structural HTML snippet. All fields are size-capped by `EXTRACTION_LIMITS`.
- **Detection engine**: `src/services/detector/` - a deterministic, data-driven engine with cleanly separated evidence projection (`evidence.ts`), rule table (`rules.ts`), matcher (`matcher.ts`), confidence model (`confidence.ts`), version extraction (`version.ts`), and cross-page aggregation (`engine.ts`). Confidence follows the documented formula `C(T) = 1 - ∏(1 - w_i)` with the spec's thresholds (Detected ≥ 0.75, Probable ≥ 0.50, suppressed below 0.50).
- **Persistence**: forward-only migration `003_technology_detection.ts` adds `technology_id`, `confidence_status`, `version_status`, `evidence`, `pages`, and `limitation` to the existing `scan_technologies` table, plus a `(scan_id, technology_id)` UNIQUE index for idempotent re-runs. `TechnologyRepository.upsertMany()` writes a whole report in one transaction. `001`/`002` are untouched.
- **Lifecycle**: detection runs inside `CrawlerService` after pages are durable but **before** any terminal status, so a `completed` scan always has its detections persisted. New `technology.scan_started` / `technology.detected` / `technology.scan_completed` events were added to the taxonomy.
- **UI**: `src/routes/ScanRoute.tsx` renders a "Detected technologies" panel driven by persisted rows (via `src/stores/technologyStore.ts` and `src/components/scan/TechnologyPanel.tsx`). It shows name, category, version (with an honest "version n/a"/"major" label when not exact), confidence status, and an expandable evidence list; loading, empty, error, and partial-capture states are covered.
- **Documented limitations**: coverage is limited to the implemented rule table and the captured vectors; `networkRequests` is derived from HTML `href`/`src`/`action` attributes (no HAR yet); JS-global detection is presence-only; version detection is best-effort and never guessed.

### Phase 4 (workstream 3) - scan UI integration and documentation

Wires the existing Scan route/controls to the real crawler and finalizes the Phase 4 docs. **No technology detection, responsive analysis, authentication, AI, or blueprint/clone/project generation** - those remain later phases.

- **Scan application service**: `src/services/scanner/scanService.ts` is the single seam the UI uses to run a crawl. It validates the target, resolves the owning project, launches the shared browser session through the existing `BrowserRuntime` (reusing its worker process/`ProcessManager`), starts the `CrawlerService`, exposes `cancelScan`, and always closes the session. It reports honest typed failures (no desktop runtime, runtime not ready, storage not ready, already running) instead of throwing.
- **Store**: `src/stores/scanStore.ts` now drives the real lifecycle. `startScan()` delegates to the service and mirrors the crawl's own `scanner.*` events into `progress` (scanned / discovered / percentage / current URL), `discoveredPages`, and the activity log; `cancelScan()` requests cooperative cancellation. No progress or metric is fabricated.
- **UI**: `src/routes/ScanRoute.tsx` renders honest states (validation, ready, scanning, cancellation, completed, failed, cancelled), real progress plus a live activity/discovery console, an actionable error alert (message + suggested action, never a raw stack trace), deliberate focus movement (to Cancel on start, to the result region on completion), and an auto-selected/creatable project for the typed URL. Multi-viewport controls are shown disabled and explicitly labelled **Deferred** because the crawler does not honor them yet.
- **Small additive support**: `BrowserRuntime.getWorkerAdapter()` (service-to-service only) so a crawl shares the runtime's worker process; an optional `suggestedAction` override on the scanner/process error factories for precise, honest UI messages.
- **Test determinism fix**: the three opt-in real-Chromium E2E files now bind distinct fixture ports (worker smoke `9099`, extraction `4000`, orchestration `8000`) so they no longer contend when run together; assertions are unchanged.
- **Tests**: `src/stores/scanStore.test.ts` adds integration coverage that runs a full crawl through the store against a fake worker and real in-memory SQLite and asserts the real counters/discovery, plus honest failure states. A real render inspection of the Scan route was performed against the Vite dev server.
- **Docs**: `PLAN.md`, `SCANNER-SPEC.md`, `ARCHITECTURE.md`, `TESTING.md`, `UI-SPEC.md`, and this changelog updated to reflect the as-built Phase 4 scope, crawl/extraction policy, lifecycle/cancellation, persistence, test strategy, and documented limitations.

### Deferred (Phase 4 workstream 3)
Technology detection, responsive/multi-viewport capture, authentication, screenshots/assets, HAR capture, blueprint/clone/project generation, and admin remain unimplemented.

### Added
Phase 4 (workstream 2) - crawler persistence, scan lifecycle/cancellation, event wiring, and the crawler application service. **No UI, technology detection, responsive analysis, authentication, AI, or blueprint/clone/project generation** - those remain later workstreams/phases.

- **Migration + schema**: a **new** versioned migration `src/services/storage/migrations/002_scan_pages.ts` (version `2`) creates `scan_pages` (child of `scans`, `ON DELETE CASCADE`) with a unique `(scan_id, url)` index and per-column indexes; `001_init` is never edited. Documented adaptation of the `DATABASE.md` sketch (page metadata/structure only; no screenshot/dom/har/content_type columns).
- **Persistence**: typed `ScanPageRepository` (`upsertMany` bounded batch writes in one transaction + one persist, `listByScan`, `countByScan`, `countFailedByScan`, `deleteByScan`); `ScanRepository` gains `updateProgress()` and `findActive()` / `findActiveByProject()`. `ScanPage` / `ScanPageStatus` domain models added.
- **Lifecycle & cancellation**: pure scan state machine (`src/services/scanner/lifecycle.ts`) over the persisted `scans.status` union; duplicate concurrent scans refused with `SCAN_ALREADY_RUNNING`; `cancel(scanId)` aborts the in-flight worker extraction, retains partial progress, records `cancelled`, and releases the run slot; a scan is only marked `completed` after the final page batch is written.
- **Events/errors**: `scanner.page_started`, `scanner.page_failed`, `scanner.progress`, and `scanner.cancelled` event keys/payloads; new `SCAN_ALREADY_RUNNING` error code. Recoverable page failures are distinguished from fatal scan failures.
- **Orchestration**: `src/services/scanner/crawlerService.ts` composes frontier/scope/normalization + `scannerWorkerClient` + persistence + events + cancellation; `src/services/scanner/crawlLimits.ts` clamps all limits into documented hard bounds; `src/services/scanner/crawlerFactory.ts` wires it to storage. Sequential BFS (`maxConcurrency` is 1) because the worker holds one abort controller per session.
- **Tests**: deterministic lifecycle/persistence/cancellation/duplicate/crash/cleanup suites plus an opt-in real-Chromium end-to-end (`src/workers/crawler/__tests__/crawlerService.e2e.test.ts`, gate `RUN_BROWSER_TESTS=1`).

### Deferred (Phase 4 workstream 2)
UI wiring of the scan route, broader UX/docs, technology detection, responsive analysis, authentication, screenshots/assets, HAR capture, blueprint/clone/project generation, and admin remain unimplemented.

### Phase 4 (workstream 1) - website crawler & data-extraction core: URL/network security policy, deterministic URL normalization + crawl scope/traversal, page extraction, and the dedicated Playwright worker operations. **No technology detection, responsive analysis, authentication, AI, blueprint/clone/project generation, or persistence/lifecycle/UI** - those remain later workstreams/phases.

- **URL & network security policy**: `src/services/scanner/security/ipPolicy.ts` (IP-literal parsing incl. non-canonical IPv4 and IPv6 mappings, and classification of loopback/private/link-local/ULA/multicast/metadata ranges) and `src/services/scanner/security/urlPolicy.ts` (scheme/credential/port/length checks, DNS resolution with ANY-prohibited-address rejection, and a trusted-seed-origin concept so a user-chosen local target is reachable while metadata/link-local stay blocked).
- **Normalization & traversal**: `src/services/scanner/normalization.ts` (fragment/tracking-param stripping, query sorting, trailing-slash policy), `crawlScope.ts` (origin-based internal/external classification), and `frontier.ts` (deterministic BFS with hard depth/page bounds and duplicate/loop prevention).
- **Extraction**: `src/services/scanner/extraction/` (raw-evidence vs normalized models, hard size limits, an in-page self-contained extractor, and a pure normalizer) - title, meta description, canonical, robots meta, headings, internal/external links, image refs + alt text, basic structure/metrics, and capture timestamp. No DOM snapshot, computed styles, HAR, screenshots, or assets.
- **Worker protocol + worker**: new `extract` and `abort` operations in `src/services/infra/workerProtocol.ts` (additive; `WORKER_PROTOCOL_VERSION` stays `1`) with a `NormalizedPage` result and structural validation. `src/workers/crawler/index.ts` performs navigation + extraction, enforces the URL policy at the pre-navigation and post-redirect boundaries, pins sub-resource routing against prohibited IPs, and returns normalized results. New `src/services/scanner/scannerWorkerClient.ts` is the typed host client over the existing `ProcessManager`.
- **Events/Errors**: `scanner.*` event payloads in `eventBus.ts` / `EVENT-SYSTEM.md`; new codes `URL_POLICY_VIOLATION` and `UNSUPPORTED_CONTENT_TYPE` in `errors.ts` / `ERROR-HANDLING.md`; `src/services/scanner/errors.ts` factory.
- **Fixtures/Tests**: multi-page crawler fixtures + behavioural routes in `scripts/fixtureServer.mjs`; deterministic unit tests for policy/normalization/scope/frontier/extraction and an opt-in real-Chromium E2E (`src/workers/crawler/__tests__/crawlerExtraction.e2e.test.ts`, gate `RUN_BROWSER_TESTS=1`).

### Deferred (Phase 4 workstream 1)
Persistence of pages, scan lifecycle/orchestration, UI, technology detection, responsive analysis, authentication, screenshots/assets, HAR capture, blueprint/clone/project generation, and admin remain unimplemented.

### Phase 3 - browser / Playwright foundation: a typed child-process boundary and a launch/navigate-only browser runtime. **No crawling, DOM/CSS/JS analysis, network analysis, technology detection, or screenshots** - those remain Phase 4.

- **Worker protocol**: `src/services/infra/workerProtocol.ts` - versioned newline-delimited JSON over **stdio** (not WebSocket, so the CSP `connect-src` is not widened). Deterministic serialization, correlation ids, integer protocol version with rejection of unknown versions, runtime validation of every frame, bounded framing, and `WORKER_PROTOCOL_VIOLATION` on malformed input. Shared with the worker via `src/workers/crawler/protocol.ts`. Documented in `docs/architecture/WORKER-PROTOCOL.md`.
- **ProcessManager**: `src/services/infra/processManager.ts` - guarded state machine (`not_started | starting | ready | busy | stopping | stopped | failed`), duplicate-start prevention, startup/communication timeouts (≤30s), graceful-then-forced shutdown (500ms grace), unexpected-exit handling, bounded buffering, listener cleanup, and no leaked processes. Injectable via `ProcessSpawner` (Rust IPC in prod, fake in tests).
- **Rust boundary**: `src-tauri/src/process.rs` - `std::process::Command` with array args and **no shell**, a `node` executable allowlist, argument/env validation, environment sanitization, bounded stdout/stderr streaming, and kill-tree termination. Four narrow commands registered in `src-tauri/src/lib.rs`: `process_spawn`, `process_write`, `process_kill`, `process_status`.
- **Browser runtime**: `src/services/browser/` - detection/diagnostics without download, Chromium-only MVP, controlled launch/navigate/close via the worker, and `BROWSER_NOT_INSTALLED` when missing. Non-blocking init from `App.tsx`; never blocks or crashes the UI. UI-inert (scan route unchanged).
- **Worker**: `src/workers/crawler/` - a dedicated Node process (Node native type stripping) supporting only `ping` / `launch` / `navigate` / `close`, plus `src/workers/crawler/workerPaths.ts` for spawn resolution.
- **Events/Errors**: new `process.*` and `browser.*` event domains in `EVENT-SYSTEM.md` / `eventBus.ts`, and new codes (`PROCESS_SPAWN_FAILED`, `PROCESS_TIMEOUT`, `PROCESS_EXITED_UNEXPECTEDLY`, `WORKER_PROTOCOL_VIOLATION`, `WORKER_SHUTDOWN_FAILED`, `BROWSER_NOT_INSTALLED`) in `ERROR-HANDLING.md` / `errors.ts` / `processErrors.ts`.
- **IPC**: typed `processSpawn` / `processWrite` / `processKill` / `processStatus` wrappers and `onProcessEvent` in `src/services/ipc/`.
- **Tooling**: `playwright-core@1.63.0` (pinned devDependency); `npm run test:browser`; `npm run fixture:serve`; local fixture (`scripts/fixtures/simple-page/`) and fixture server (`scripts/fixtureServer.mjs`) on `127.0.0.1:9099`.
- **Tests**: protocol, lifecycle (incl. kill-within-500ms), and browser-runtime suites run by default with injected fakes (no browser download). The real-browser smoke test is opt-in via `RUN_BROWSER_TESTS=1`.

### Deferred (not in Phase 3)
The Playwright crawler, DOM/network extraction, technology detection, responsive capture, authentication/session encryption, blueprint generation, AI, clone generation, project generator, and admin remain unimplemented. Packaging the worker script and the Playwright browser into the release artifact is deferred.

### Phase 2 - local storage foundation
A real, persisted SQLite database behind a typed repository layer.

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
