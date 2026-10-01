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
- Path: `src/services/blueprint/__tests__/schemaValidator.test.ts`
- Tests:
  - Validate valid blueprint JSON documents against `SiteBlueprintSchema`.
  - Validate schema rejection and descriptive error paths on missing node types, invalid color hexes, or missing layout coordinates.
  - Test backward-compatibility schema migrations.

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

Port isolation for the three opt-in real-Chromium files: worker smoke `9099`, extraction E2E `4000`, orchestration E2E `8000`. They can be run together (`RUN_BROWSER_TESTS=1 npx vitest run src/workers/crawler`) without contending for a fixture port.

Phase 1 test layout (co-located with source, per Vitest include glob `src/**/*.{test,spec}.{ts,tsx}`):

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
