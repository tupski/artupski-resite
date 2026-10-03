# Testing Strategy & Specification

## 1. Testing Philosophy & Pyramid

Artupski ReSite enforces a rigorous multi-tier testing strategy ensuring deterministic execution across native desktop bridges, browser crawling engines, and AI generation pipelines.

```
       /\
      /  \      E2E System Tests (Local Mock Web Fixtures -> Export Verification)
     /----\
    /      \    Integration Tests (Playwright Sandbox, SQLite, Mock LLM WireMock)
   /--------\
  /          \  Unit Tests (Regex Detectors, Zod Schemas, EventBus, Prompt Compilers)
 /------------\
```

---

## 2. Unit Testing Strategy

Unit tests execute in isolation using Vitest. Target 95%+ coverage on deterministic pure functions.

### 2.1 Technology Detection & Fingerprinting
- Path: `src/services/detector/__tests__/engine.test.ts` (as built; supersedes the illustrative `scanner/__tests__/techDetector.test.ts` path).
- Tests:
  - Confidence model (`1 - ∏(1 - w_i)`) and threshold classification.
  - Version extraction (exact / major-only / unavailable) and implausible-capture rejection.
  - Known positive signatures across categories; negative cases; false-positive-prone single-signal matches never presented as confirmed.
  - Ambiguous evidence kept as distinct technologies (no forced single identification).
  - Deduplication of repeated signals, cross-page union, and deterministic output.
  - Oversized/malformed/empty evidence handled safely; multiple technologies from one page.
- Fixtures: deterministic, inline, browser-free (no public websites).

### 2.2 Blueprint Zod Schema Validation
- Path: `src/services/blueprint/__tests__/schema.test.ts` (as built; supersedes the illustrative `schemaValidator.test.ts` path). The validator itself is `src/types/blueprint.ts` (`BlueprintSchema`, `validateBlueprint`).
- Tests:
  - Validate valid blueprint JSON documents against `BlueprintSchema`.
  - Validate schema rejection and descriptive error paths on missing/unknown sections (`.strict()`), bad enums/URLs, and an unsupported `blueprint_version` (`UNSUPPORTED_VERSION`).
  - Enforce bounded recursion (component depth, cycles, unknown child refs, page/route/component counts, navigation depth) and confirm the optional additive `provenance`/`confidence` extension does not loosen required fields.
- See section 5.7 for the full Phase 9 test tier.

### 2.3 EventBus & Serialization
- Path: `src/services/infra/__tests__/eventBus.test.ts`
- Tests:
  - Strongly typed event pub/sub dispatching.
  - Event listener cleanup and memory leak prevention.
  - Payload serialization/deserialization across thread boundaries.

### 2.4 Prompt Compilers
- Path: `src/services/ai/__tests__/promptCompiler.test.ts`
- Tests:
  - DOM token extraction and truncation boundaries.
  - System prompt XML isolation tag insertion.
  - PII scrubbing filter verification (regex checks for emails/phones).

### 2.5 Authentication & Session Security (as built)
- Paths: `src/services/auth/__tests__/crypto.test.ts`, `src/services/auth/__tests__/authSessionService.test.ts`, `src/services/scanner/authClassifier.test.ts`.
- Tests:
  - AES-256-GCM encrypt→decrypt round trip; fresh IV per encryption; tamper, wrong-seed, and wrong-salt all **fail closed** (no plaintext returned).
  - `redactSecrets` removes cookie/authorization/token/password fields recursively (arrays included).
  - Page-classifier taxonomy: `public` (no wall, no session), `authenticated` (no wall, session), `auth_required` (wall/401/403, with or without a session), `blocked` (CAPTCHA/429), `unknown` (failure/timeout); a wall is **never** reported `authenticated`.
  - Service lifecycle: capture → persist → load round trip; empty capture rejected (`LOGIN_FAILED`); no active session rejected; **domain mismatch rejected**; metadata carries no ciphertext; clear removes it; expired sessions purged; and an assertion that the plaintext token appears nowhere in the stored row.
- Fixtures: inline and deterministic (no public websites, no real credentials).

---

## 3. Integration Testing Strategy

Integration tests verify multi-subsystem communication without hitting external cloud networks.

### 3.1 Playwright Crawler Sandbox
- Path: `src/workers/crawler/__tests__/crawlerIntegration.test.ts`
- Setup: Local Node.js HTTP test server serving deterministic static and dynamic fixtures:
  - `http://127.0.0.1:9099/simple-page`: Basic HTML/CSS.
  - `http://127.0.0.1:9099/spa-route`: Dynamic client-side DOM rendering.
  - `http://127.0.0.1:9099/auth-protected`: Session-gated route returning 401 without cookie.
- Tests:
  - DOM extraction correctness.
  - Network asset discovery and local disk download pipeline.
  - Cookie injection and session persistence across redirects.
- **Authenticated crawl (as built)**: `src/services/scanner/authScanIntegration.test.ts` (fake worker + in-memory storage) covers a page reached within a session (`authenticated`), an unsatisfied session failing a `requireAuthentication` scan (`failed`, page persisted `auth_required`, no `scanner.completed`), a CAPTCHA/429 (`blocked`), an unauthenticated regression (`public`, `completed`), and that an auth-walled page's links are not followed. `src/services/browser/browserRuntime.auth.test.ts` (fake adapter) asserts the injected `storageState` is passed to `launch`, that a plain launch omits it, that `detectLogin` returns only signals, and that the capture lifecycle opens a headed `capture` session, refuses a second window, rejects a non-http(s) target, and closes on cancel.
- **Interactive capture E2E (opt-in, real Chromium)**: `src/workers/crawler/__tests__/authCapture.e2e.test.ts` opens a real headed window (fixture port `3001`), simulates a login via a fixed non-credential fixture link, captures the host-scoped state (including `sessionStorage`), closes the window, encrypts + decrypts the state, replays it in a NEW headless context, and confirms the protected fixture page returns 200 - plus that the same page without a session returns 401. Requires `npx playwright install chromium` and `RUN_BROWSER_TESTS=1`.

### 3.2 SQLite Database Repositories
- Path: `src/services/db/__tests__/repositories.test.ts`
- Setup: In-memory SQLite instance (`:memory:`).
- Tests:
  - Migration script execution from version 0 to current.
  - Foreign key cascading deletes (`projects` -> `scan_runs` -> `assets`).
  - Concurrency locks under simulated parallel write load.

### 3.3 Mock LLM Provider
- Path: `src/services/ai/__tests__/llmMockAdapter.test.ts`
- Setup: Mock HTTP server returning pre-recorded streaming and non-streaming responses.
- Tests:
  - Fallback logic: Provider failure on primary -> automated retry on secondary provider.
  - Rate-limit backoff handling (HTTP 429).
  - Malformed LLM JSON stream repair pipeline.

---

## 4. End-to-End (E2E) Testing Strategy

E2E tests automate complete user journeys from URL input to code export using Playwright E2E and mock fixtures.

### 4.1 Test Scenarios
```
Test Workflow: E2E Pipeline Run
[Local Mock Server] -> [Tauri App Window] -> [Crawler Worker] -> [Mock LLM] -> [Disk Export Check]
```

1. Scenario 1: Unauthenticated Static Site
   - Input: `http://localhost:9099/fixtures/portfolio`
   - Actions: Trigger Scan -> Verify Event Stream -> Inspect Blueprint Inspector -> Trigger Vite React Generation.
   - Assertions: Output folder contains runnable Vite project; `npm run build` exits code 0 in sandbox.

2. Scenario 2: Authenticated App Flow
   - Input: `http://localhost:9099/fixtures/saas-dashboard`
   - Actions: Spawn interactive login modal -> Inject mock credentials -> Capture session -> Crawl dashboard -> Synthesize Blueprint.
   - Assertions: Protected dashboard DOM elements correctly reflected in extracted component tree.

3. Scenario 3: Error Recovery & Cancellation
   - Actions: Start crawl on unresponsive target (`http://10.255.255.1`) -> Click "Cancel Scan".
   - Assertions: ProcessManager kills crawler process within 500ms; UI state resets to Idle.

---

## 5. Continuous Integration (CI) Pipeline Commands

```bash
# Unit & component tests (Vitest + React Testing Library) - Phase 1
npm run test:unit

# Storage layer tests only (`vitest run src/services/storage`) - Phase 2
npm run test:storage

# Process/worker/browser foundation tests - Phase 3 (no browser download needed)
npm run test:browser

# Opt-in real-browser smoke test (requires `npx playwright install chromium`)
RUN_BROWSER_TESTS=1 npm run test:browser

# Typecheck & Lint
npm run typecheck && npm run lint

# Production build
npm run build

# Native build (requires a Rust toolchain: rustc + cargo)
npm run tauri:build
```

### 5.1 Phase 3 test tier (browser / process foundation)

The default suite (`npm run test`) covers the Phase 3 foundation **without any browser download** by injecting fakes for the process spawner and the browser worker:

- `src/services/infra/workerProtocol.test.ts` - envelope/version handling, deterministic serialization, correlation ids, malformed frames, unknown types, structured-error propagation, framing/buffering limits.
- `src/services/infra/processManager.test.ts` - startup, duplicate-start prevention, shutdown, startup timeout, communication timeout, unexpected exit, invalid transitions, cleanup after failure, and the **kill-within-500ms** assertion (TESTING.md Scenario 3).
- `src/services/browser/browserRuntime.test.ts` - detection, missing executable, launch failure, and cleanup after launch (fake worker; no real browser).

The **opt-in** smoke test (`src/workers/crawler/__tests__/workerSmoke.test.ts`) is the only test that launches a real Chromium. It is gated by `RUN_BROWSER_TESTS` and is skipped by default, so `npm run test` and CI never require a browser binary or an external website. It starts the local fixture server (`scripts/fixtureServer.mjs`, `127.0.0.1:9099`) and the real worker, then pings, launches, navigates to `http://127.0.0.1:9099/simple-page`, and closes cleanly.

### 5.2 Phase 4 crawler core test tier

The default suite covers the Phase 4 crawler core **without any browser download**:

- `src/services/scanner/security/ipPolicy.test.ts` - IP-literal parsing (incl. non-canonical IPv4, IPv6 mappings) and range classification.
- `src/services/scanner/security/urlPolicy.test.ts` - scheme/credential/port/length rejection, IP/DNS blocking, and the trusted-seed-origin rule.
- `src/services/scanner/normalization.test.ts`, `crawlScope.test.ts`, `frontier.test.ts` - normalization, origin scope, and bounded traversal.
- `src/services/scanner/extraction/normalize.test.ts`, `inPageExtractor.test.ts` - extraction normalization, size limits, and the self-contained in-page extractor run against jsdom.
- `src/services/scanner/scannerWorkerClient.test.ts`, `src/services/infra/workerProtocol.extract.test.ts` - the `extract`/`abort` protocol surface via injected fakes.

The **opt-in** `src/workers/crawler/__tests__/crawlerExtraction.e2e.test.ts` (gate `RUN_BROWSER_TESTS=1`) launches real Chromium against the local fixture server and exercises the essential end-to-end path: metadata/headings/links/images extraction, canonical resolution, in-scope redirect following, non-HTML skip, 404 extraction, navigation timeout, and a metadata-address redirect block.

### 5.3 Phase 4 crawler persistence / lifecycle / orchestration test tier

The default suite covers the Phase 4 workstream-2 additions **without any browser download**:

- `src/services/storage/__tests__/scanPages.test.ts` - migration 002 registration/checksum/table+indexes, `ScanPageRepository` upsert/dedupe/counters/JSON round-trip, foreign-key integrity and cascades, and reopen persistence.
- `src/services/storage/__tests__/scanProgress.test.ts` - `ScanRepository.updateProgress` clamping/partial updates and `findActive` / `findActiveByProject`.
- `src/services/scanner/lifecycle.test.ts`, `crawlLimits.test.ts` - the pure scan state machine and documented hard-bound clamping.
- `src/services/scanner/crawlerService.test.ts` - successful crawl, recoverable partial failures, fatal worker crash, cancellation with partial-progress retention, duplicate-scan prevention (in-process + persisted), cleanup/active-slot release, invalid seed, and page JSON round-trip (all via injected fakes + a real in-memory SQLite database).

The **opt-in** `src/workers/crawler/__tests__/crawlerService.e2e.test.ts` (gate `RUN_BROWSER_TESTS=1`) launches real Chromium and drives the whole orchestration (frontier + worker client + real SQLite persistence + events + cancellation) against the local fixture server on **port 8000** (a dedicated port so it never contends with the workstream-1 extraction E2E on 4000 or the worker smoke test on 9099). It is skipped cleanly by default.

### 5.4 Phase 4 crawler UI integration test tier (workstream 3)

The default suite covers the UI seam **without any browser download**:

- `src/stores/scanStore.test.ts` - the store lifecycle plus a full crawl run through `startScan()` against an injected fake browser runtime and a real in-memory SQLite database: it asserts the crawl's *real* counters (`pagesScanned`/`pagesDiscovered`), discovered URLs, completion status, and the honest runtime-unavailable failure state (no fabricated progress). `scanService` exposes `setScanRuntimeProviderForTests` / `resetScanServiceForTests` so the seam is testable without a Tauri shell.

Port isolation for the seven opt-in real-Chromium files: worker smoke `9099`, extraction E2E `4000`, orchestration E2E `8000`, interactive capture E2E `3001`, responsive capture E2E `5173`, clone capture E2E `4173`, blueprint capture E2E `3000`. They can be run together (`RUN_BROWSER_TESTS=1 npx vitest run src/workers/crawler`) without contending for a fixture port.

### 5.6 Phase 8 static clone test tier

The default suite covers the Phase 8 clone engine **without any browser download**:

- `src/services/clone/__tests__/clonePaths.test.ts` - traversal-safe route/asset path derivation, content-hashed asset names, depth-relative references.
- `src/services/clone/__tests__/htmlRewriter.test.ts` - absolute/root-relative remap, `srcset`, internal anchors + hash fragments, external `target=_blank rel`, tracking-script stripping, `<base>` removal, mock-client injection, determinism.
- `src/services/clone/__tests__/cssRewriter.test.ts` - `url(...)` remap and duplicate `@charset` collapse.
- `src/services/clone/__tests__/serverPathPolicy.test.ts` - accept in-root; reject traversal (raw + percent-encoded), absolute-override, backslash, NUL, malformed encoding; content-type map.
- `src/services/clone/__tests__/cloneService.test.ts` - full rewrite+write+manifest over a fake worker + in-memory IO, and the honest **skip** path when a page's HTML cannot be captured.
- `src/services/storage/__tests__/scanAssets.test.ts` - migration 007 registration/table/indexes + `raw_html_path` column, `AssetRepository` CRUD, `(scan_id, sha256)` de-dupe, scan-delete cascade, reopen persistence.
- `src/stores/cloneStore.test.ts` - honest loading/empty/error states from persisted rows.
- `src/services/infra/workerProtocol.test.ts` - validation of `captureAssets`, `serveClone`/`stopClone`, and the `extract` `rawHtml` field.

The **opt-in** `src/workers/crawler/__tests__/cloneCapture.e2e.test.ts` (gate `RUN_BROWSER_TESTS=1`) launches real Chromium against the clone fixture (`127.0.0.1:4173`), captures the bounded raw HTML and the referenced assets, runs the pure rewriter, and asserts the result is self-contained (no `googletagmanager.com`, `js/mock-client.js` injected, local asset paths present).

### 5.7 Phase 9 website blueprint test tier

The default suite covers the Blueprint schema, engine, persistence, and lifecycle **without any browser download**:

- `src/services/blueprint/__tests__/schema.test.ts` - `BlueprintSchema` accepts a valid document; rejects missing sections, unknown keys (`.strict()`), bad enum/URL/version values; enforces bounded recursion (component depth, cycles, unknown child refs, page/route/component counts, navigation depth); and confirms the optional additive `provenance`/`confidence` extension does not loosen required fields. `fixtures.ts` holds deterministic inline documents.
- `src/services/blueprint/__tests__/domNormalizer.test.ts`, `designTokens.test.ts`, `routes.test.ts`, `forms.test.ts`, `technologies.test.ts` - the pure normalization units (component segmentation + bounds, token extraction, route/nav inference, form modeling, technology projection); missing/conflicting evidence is represented, never fabricated.
- `src/services/blueprint/__tests__/evidence.test.ts` - provenance (observations/inferences/evidence_summary) construction and secret-absence.
- `src/services/blueprint/__tests__/blueprintService.test.ts` - end-to-end assembly + validation over injected storage.
- `src/services/blueprint/__tests__/blueprintLifecycle.test.ts` - round-trip, regeneration (`version + 1`), invalid-document persistence (`is_valid = 0`), the no-orphan rollback, and `blueprint.*` event ordering.
- `src/services/scanner/scanServiceBlueprint.test.ts` - the `runScan({ blueprint: true })` integration, failure isolation (a Blueprint failure never changes the crawl's terminal status), and the opt-out path.
- `src/services/storage/__tests__/blueprints.test.ts` - migration `008` registration/checksum/table+indexes + the `blueprint_evidence_path` column, `BlueprintRepository` upsert/list/latest/delete, the UNIQUE `(scan_id, version)`, scan-delete nulling, and reopen persistence.
- `src/stores/blueprintStore.test.ts` + `src/components/blueprint/BlueprintPanel.test.tsx` - honest `idle | loading | empty | ready | partial | error` states and the panel render.
- `src/workers/crawler/__tests__/blueprintCapture.test.ts` - the pure capture harness (`buildBlueprintProbe`/`normalizeBlueprintEvidence`): bounding/truncation and the attribute allowlist (no `value`/`style`/event handlers), with no browser needed.
- `src/services/scanner/__tests__/blueprintEvidenceCapture.test.ts` - the host-side evidence-capture service seam.
- `src/services/infra/workerProtocol.test.ts` - validation of the `captureBlueprint` command/result wire shape (limits, malformed frames).

The **opt-in** `src/workers/crawler/__tests__/blueprintCapture.e2e.test.ts` (gate `RUN_BROWSER_TESTS=1`, fixture port `3000`) launches real Chromium against `scripts/fixtures/blueprint/index.html` and asserts the evidence is bounded and contains the expected landmarks/headings/tokens/form/nav, that a huge DOM is flagged `truncated`, and - critically - that no planted secret (localStorage token, input `value`, hidden field) leaks into the evidence.

### 5.8 Phase 10 AI engine test tier

The default suite covers the provider client, token budgeting, payload isolation, the generation pipeline, configuration persistence, the store, and the settings panel **without any network access** (`fetch` is injected in unit tests):

- `src/services/ai/__tests__/presets.test.ts` - the `AI-SPEC.md` §2.2 provider matrix, base-URL normalization (trailing slashes), and `validateBaseUrl` rejection of non-http(s), relative, whitespace, and **credential-in-URL** values.
- `src/services/ai/__tests__/tokenBudget.test.ts` - `MODEL_BUDGET_PROFILES` lookup, the default fallback, the estimate heuristic, `getUsableInputBudget`, and `fitsInContext` boundaries.
- `src/services/ai/__tests__/payload.test.ts` + `systemPrompt` - data-URI truncation, recursive sanitization, boundary escaping (an injected `</DATA_PAYLOAD>` cannot break out), and the verbatim `AI-SPEC.md` §5.1 security directives.
- `src/services/ai/__tests__/pipeline.test.ts` - raw + fenced JSON extraction, Zod validation, the bounded repair pass (success and exhaustion), over-budget rejection (`CONTEXT_LENGTH_EXCEEDED`, no provider call), and provider-throw mapping.
- `src/services/ai/__tests__/provider.test.ts` - chat completion mapping (usage/finish reason/model), `baseUrl` normalization + bearer header, SSE stream assembly, HTTP→`StructuredError` mapping (401/403/429/400), and **key redaction** in error messages.
- `src/services/ai/__tests__/config.test.ts` - config round-trip over an in-memory settings accessor, invalid-base-URL rejection, and **secret isolation** (`ai.credentials` separate from `ai.config`).
- `src/services/ai/__tests__/engine.test.ts` - health verified/failed transitions and the `ai.*` event sequences, plus `saveConfig` emitting `hasApiKey` only (the key is never in the config blob or event).
- `src/stores/aiStore.test.ts` + `src/components/settings/AiProviderPanel.test.tsx` - honest `unconfigured | idle | testing | ready | error` states, the no-fabricated-connection guarantee, key masking, and the bounded model list.

The **opt-in** `src/services/ai/__tests__/aiEngine.e2e.test.ts` (gate `RUN_AI_TESTS=1`, `@vitest-environment node`) boots a real local OpenAI-compatible HTTP server (`node:http`, `127.0.0.1:7331`) and drives the full stack over a real socket: `/models` health check, a typed non-streaming completion, and a schema-constrained generation task returning valid structured JSON. It touches no external network.

### 5.9 Phase 11 component synthesis test tier

The default suite covers the prompt, payload projection, output contract, cleanliness gate, and the orchestrator **without any network access** (a scripted engine is injected; no live model):

- `src/services/ai/prompts/__tests__/componentPrompt.test.ts` - the AI-SPEC §5.1 directives are always prepended, the authored task contract is present, strict-JSON output is required, AI-slop constructs are forbidden, and no untrusted evidence leaks into the instruction.
- `src/services/generator/__tests__/componentPayload.test.ts` - bounded projection (variant/prop/token/fragment caps, sorted), child names without bodies, observed-vs-inferred `confidence` preserved, absent evidence omitted (no fabrication), and PascalCase identifier derivation.
- `src/services/generator/__tests__/componentSchema.test.ts` - `ComponentOutputSchema` accepts well-formed output and rejects non-PascalCase names, empty/oversized code, and unknown keys (strict).
- `src/services/generator/__tests__/jsxCleanliness.test.ts` - the structural gate (unsafe constructs, unbalanced/excessive nesting, missing declaration, invalid identifier) and the AI-slop gate (filler, comments, `any`/`@ts-ignore`, `console.*`, empty handlers, unused imports) plus the deterministic, idempotent normalizer.
- `src/services/generator/__tests__/componentSynthesizer.test.ts` - end-to-end synthesis from a validated Blueprint, the schema-constrained task shape, per-component failure isolation, `componentId` echo cross-check, `SLOPPY_OUTPUT`, engine-throw handling, invalid-Blueprint refusal, the component cap, `componentIds` filtering, cancellation (`aborted`), deterministic identifier de-duplication, `component.*` event sequences with bounded payloads, and file-name sanitization.

All Phase 11 tests use deterministic fixtures and a scripted/JSON engine; none require an API key.

### 5.10 Phase 12 project generator test tier

The default suite covers the generator structure, Blueprint integration, component/hook/asset
assembly, standalone independence, path safety, resource limits, failure isolation, and events —
**without any network access** and writing only into per-case `node:fs` temp directories:

- `src/services/generator/__tests__/projectGenerator.test.ts` — expected boilerplate files/dirs, a
  valid `package.json` free of ReSite-only dependencies, determinism, route injection, missing-page
  drop-with-reason, token integration (no fabrication), invalid-Blueprint refusal, component/hook
  assembly with resolving relative imports, duplicate-name resolution, malformed-component skip,
  asset copy/skip, no ReSite runtime import in any generated source, `project.*` events, abort
  handling, and the never-throws boundary. `projectFixtures.ts` holds deterministic fixtures.
- `src/services/generator/__tests__/projectPaths.test.ts` — traversal, absolute, Windows drive, UNC,
  backslash, control-character, and empty-segment rejection; `resolveWithinRoot` confinement
  (including sibling-prefix escapes); asset/component/hook filename derivation.
- `src/services/generator/__tests__/projectGenerator.limits.test.ts` — excessive file count, oversized
  single file, excessive total output, and the component cap; nothing is written when a limit is
  breached.
- `src/services/generator/__tests__/projectGenerator.failure.test.ts` — a target inside a file (io
  error), invalid Blueprint (no writes), partial marking on skip, and abort (`keepPartial` true/false).

The **opt-in** `src/services/generator/__tests__/projectGenerator.build.e2e.test.ts` (gate
`RUN_PROJECT_BUILD=1`) is the authoritative Phase 12 verification: it generates a real project into
an isolated temp directory and runs the generated project's **own** `npm install` + `npm run build`
(never mocked), asserting the build exits 0 and `dist/index.html` exists. Set `KEEP_PROJECT_BUILD=1`
to preserve the generated directory. If npm cannot run in the environment, the suite reports BLOCKED
(skipped) rather than a false PASS.

### 5.11 Phase 13 visual verification test tier

The Phase 13 diff engine is verified through the pure core, the codec, the orchestrating service, and
the UI — all deterministic and free of a real browser or network:

- `src/services/diff/__tests__/visualDiff.test.ts` — the pure core: exact mismatch counts and
  similarity for known images, threshold noise rejection, layout-shift classification, size-mismatch
  error vs padded comparison, diff-image colours, and invalid-input handling.
- `src/services/diff/__tests__/png.test.ts` — encode/decode round-trip byte-for-byte, a valid PNG
  signature/IHDR, alpha preservation, and rejection of empty/non-PNG/truncated/invalid images.
- `src/services/diff/__tests__/diffService.test.ts` — the happy path (matching images, with the diff
  PNG decoded back as a real artifact check), partial runs (missing original / unavailable generated
  capture), server- and browser-launch failures (with no leaked server), empty-input rejection, and
  abort (collaborators stopped).
- `src/services/diff/__tests__/diffPaths.test.ts` — root confinement for the generated server
  (traversal, encoded traversal, NUL, backslash, empty root), the `dist/` root derivation, and the
  managed server lifecycle.
- `src/stores/diffStore.test.ts` — honest status derivation (`idle | ready | partial | error`).
- `src/components/diff/DiffViewer.test.tsx` — empty/loading/error states, the score and discrepancy
  list, partial marking, mode switching (pixel diff), and viewport selection.

All Phase 13 tests build their own RGBA/PNG fixtures in-process; none require a browser, a server, or
network access. The Phase 12 generator suite (including its opt-in build E2E) and the Phase 8
`serverPathPolicy` suite are re-run unchanged as regression coverage.

### 5.12 Phase 14 documentation & export test tier

The Phase 14 exporter is verified through the pure doc generator, the dependency-free ZIP codec, and
the orchestrating service — deterministic, no network, writing only into per-case `node:fs` temp
directories:

- `src/services/exporter/__tests__/docGenerator.test.ts` — the three documents for the canonical
  Phase 12 fixture; Markdown syntax validation (single H1, balanced fenced blocks, table header +
  separator, no unescaped pipes); sections reflect `report.routes`/`components`/`assets`/`summary`;
  absent data omitted, never fabricated; an over-cap document is refused.
- `src/services/exporter/__tests__/zip.test.ts` — CRC-32 known-answer vectors (`"123456789"` →
  `0xCBF43926`); local-header/central-directory/EOCD signatures and offsets; `buildZip` → `readZip`
  round-trip restores every path and byte; entries sorted; fixed `0x0021`/`0x0000` timestamp; UTF-8
  flag set; byte-for-byte determinism across two builds; corrupt/truncated input rejected; empty
  archive handled.
- `src/services/exporter/__tests__/zipExporter.test.ts` — zip and folder happy paths over an injected
  in-memory reader/writer; boundary limits (entries, per-entry bytes, total bytes); traversal
  (`..`, absolute, backslash, drive, NUL) rejected; duplicate/case-colliding entries rejected; a
  missing source file skipped (`partial`); abort cleans up; bounded `export.*` events; unavailable
  deps → `EXPORT_UNAVAILABLE`; the never-throws boundary; independent unzip/verify via
  `zlib.inflateRawSync`.
- `src/services/exporter/__tests__/exportFixtures.ts` — deterministic Phase 12 report fixtures.

The **opt-in** `src/services/exporter/__tests__/zipExporter.e2e.test.ts` (gate `RUN_EXPORT_E2E=1`) is
the authoritative real-artifact check: it calls the real `generateProject` into an isolated temp dir,
exports a real ZIP via a Node-`fs` reader/writer, then unzips and verifies that `README.md`,
`ARCHITECTURE.md`, `COMPONENTS.md`, and every `report.files` source file are present and
byte-identical. Set `KEEP_EXPORT_E2E=1` to preserve the temp dirs. If the environment cannot run it,
the suite reports BLOCKED (skipped) rather than a false PASS. Run it with:

```text
RUN_EXPORT_E2E=1 npx vitest run src/services/exporter/__tests__/zipExporter.e2e.test.ts
```

**Responsive capture (Phase 7, as built)**: `src/services/scanner/responsiveScanner.test.ts` covers profile selection, path sanitisation, and orchestration (including the honest skip-on-failure path). `src/services/storage/__tests__/responsiveCaptures.test.ts` covers the migration + repository (one-per-page/profile, cascade, reopen). `src/services/infra/workerProtocol.test.ts` validates the `captureViewport` wire shape (including the profile bounds). The opt-in `src/workers/crawler/__tests__/responsiveCapture.e2e.test.ts` renders the responsive fixture at desktop AND mobile and asserts the captures are distinct (different screenshot bytes; `nav` visible on desktop, hidden on mobile) with detected media-query breakpoints.

### 5.13 Phase 15 settings / security / error-handling test tier

The Phase 15 hardening is verified through the PLAN-mandated suites plus the supporting
store/UI/service suites — deterministic, no network, no live OS keychain:

- **Key leakage (PLAN-mandated)** — `src/services/security/__tests__/keychain.test.ts`: the
  `secret_*` IPC mapping (available/unavailable, get/set/delete, invalid-account rejection, fail
  closed) and an assertion that the key value never appears in any `app_settings` value, log entry,
  or emitted event; `src/services/security/__tests__/redaction.test.ts`: recursive, non-mutating
  scrubbing of `apiKey`/`authorization`/`cookie`/`token`/`password`/`key` fields (incl. arrays and
  nested objects) in log metadata and an export-shaped payload. `src/services/ai/__tests__/config.test.ts`
  (extended): keychain-first read, one-time legacy migration + plaintext deletion only after a
  confirmed write, and the fail-closed `SECRET_STORAGE_UNAVAILABLE` path.
- **Error-boundary trigger (PLAN-mandated)** — `src/components/common/ErrorBoundary.test.tsx`: a
  thrown child renders the fallback (no raw stack), `role="alert"`, focus movement to the heading,
  and each recovery action (reset / reload / copy) invoked correctly.
- **Toast system** — `src/components/common/ToastRegion.test.tsx`: render by tone, auto-dismiss,
  action invocation, `aria-live` politeness, `Escape` dismiss, and the bounded (max 5) queue;
  `src/stores/uiStore.test.ts` (extended): queue cap, `durationMs`, and `pushErrorNotice`.
- **Settings** — `src/stores/settingsStore.test.ts` (extended): `CrawlerSettings` round-trip +
  clamp/re-seed; `src/components/settings/CrawlerSettingsPanel.test.tsx` and
  `SecuritySettingsPanel.test.tsx`: render/change/revoke/purge and the honest unavailable states.
- **Bridge** — `src/components/common/errorBridge.test.ts`: worker/global error → scrubbed notice;
  no secret in the payload; the handlers never rethrow.
- **Native** — `cargo check` and `cargo clippy --all-targets` validate `src-tauri/src/secret.rs`
  (which also carries Rust unit tests for the account-slug validator). A real keychain round-trip is
  environment-dependent; where no OS store is present the suite asserts the honest unavailable path
  rather than a false PASS.

Run the focused suites with:

```text
npx vitest run src/services/security
npx vitest run src/components/common
npx vitest run src/components/settings
npx vitest run src/stores/uiStore.test.ts src/stores/settingsStore.test.ts
```

### 5.14 Phase 16 end-to-end integration & release test tier

The final MVP phase adds a composed end-to-end suite in the PLAN-named `e2e/` directory (the Vitest
`include` glob and the `tsconfig` `include` now cover `e2e/**/*.{test,spec}.{ts,tsx}` — deviation C7).
It composes the REAL Phase 9-14 services; only the AI provider is replaced (by a deterministic
scripted engine). No public website is ever contacted (deviation C2: "reference demo websites" =
local fixtures).

- **Offline composed pipeline** — `e2e/phase16Pipeline.e2e.test.ts` (pure half always runs): real
  in-memory SQLite (`createTestStorage`) → real `runBlueprintLifecycle` (real `runBlueprint` +
  real persistence + sandboxed file-write seam) → real `synthesizeComponents` (scripted engine) →
  real `generateProject` → real `exportProject` ZIP → `readZip` verification of `README.md`/
  `ARCHITECTURE.md`/`COMPONENTS.md` and **every** source file byte-for-byte, plus a determinism
  assertion across two runs. The REAL `npm install && npm run build` half is gated on
  `RUN_PROJECT_BUILD=1` and reports BLOCKED (skip) when npm is unavailable.
- **Real-browser full pipeline** — `e2e/phase16FullPipeline.e2e.test.ts` (opt-in
  `RUN_BROWSER_TESTS=1`, dedicated fixture port **8080** — an allowlisted crawler port, see
  impl-plan C8): fixture server → real Chromium crawl
  (real worker over stdio + real `CrawlerService`) → real Blueprint evidence capture + synthesis →
  real `generateProject` → real build (gated on `RUN_PROJECT_BUILD=1`) → assert `dist/index.html`.
  It reports **BLOCKED** (skip) when npm or Chromium is unavailable, never a false PASS.
- **Performance harness** — `e2e/phase16Pipeline.perf.test.ts` (default suite): a bounded synthetic
  Blueprint through the real `generateProject` + `exportProject`. It **records** elapsed ms + byte
  counts and asserts only invariants (completes, within the Phase 12/14 caps, deterministic byte
  count across two runs). **No timing thresholds** (deviation C3).
- **Worker packaging unit test** — `src/workers/crawler/__tests__/workerPaths.test.ts` (§9.4): the
  pure resolver returns the dev entrypoint when only it exists, the packaged
  `<resourceDir>/workers/<name>/index.js` when provided and present, never a shell string, keeps
  `args` an array, and keeps `command` on the `node`/`node.exe` allowlist.
- **Desktop shell smoke** — `RUN_DESKTOP_E2E=1` (documented, manual/CI-desktop only): install the
  packaged artifact on a clean machine and run one fixture scan end-to-end. It is **not** automated
  here (no clean VM) and is recorded honestly in `RELEASE.md` §5.

Run the tier with:

```text
npx vitest run e2e                                   # offline half + perf (hermetic)
RUN_PROJECT_BUILD=1 npx vitest run e2e               # + the real generated-project build
RUN_BROWSER_TESTS=1 RUN_PROJECT_BUILD=1 npx vitest run e2e   # + the real-browser full pipeline
```

Phase 1 test layout (co-located with source; the Vitest include glob covers both
`src/**/*.{test,spec}.{ts,tsx}` and `e2e/**/*.{test,spec}.{ts,tsx}`):

- `src/lib/url.test.ts` - URL normalization and validation.
- `src/stores/*.test.ts` - store lifecycle and persistence behavior.
- `src/services/infra/eventBus.test.ts` - typed pub/sub and payload validation.
- `src/services/infra/errors.test.ts` - structured error model.
- `src/services/infra/logger.test.ts` - level filtering and sinks.
- `src/services/theme/themeController.test.ts` - theme resolution and DOM application.
- `src/app/AppShell.test.tsx` - routing, navigation, URL entry, and settings rendering.

### Storage layer (Phase 2)

The storage layer is verified against a real (in-memory) SQLite database - never a mock - using the same `sql.js` engine the application runs. `src/services/storage/__tests__/helpers.ts` exposes `createTestStorage()`, which returns an isolated instance backed by a fresh in-memory database and a `MemoryStorageFile`; tests never touch the real `app.db`.

- `database.test.ts` - open/close, applied pragmas, transaction rollback, export, and the created-vs-deferred table set.
- `migrations.test.ts` - fresh application, tracking rows, idempotent re-runs, pending-only application, checksum mismatch, and rollback of a failing migration (injected).
- `repositories.test.ts` - per-entity CRUD, missing-id behavior, and constraints (NOT NULL, primary-key uniqueness, CHECK status, confidence bounds, FK cascade).
- `persistence.test.ts` - export bytes, reopen into a new database, data survival, and a second open without re-running migrations.
- `storageService.test.ts` - the singleton lifecycle (`uninitialized` -> `initializing` -> `ready`/`error`), `STORAGE_NOT_READY` guards, and `projectService` URL validation.
- `src/stores/projectsStore.test.ts` - transient store state and delegation to `projectService`.
