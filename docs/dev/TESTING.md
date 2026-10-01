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
- Path: `src/services/scanner/__tests__/techDetector.test.ts`
- Tests:
  - Regex signature verification against raw HTML/header/script mock inputs.
  - Multi-version extraction accuracy (e.g., Next.js `14.2.1`, Tailwind `3.4.0`).
  - Edge cases: Malformed HTML, missing meta tags, obscured build hashes.

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

Phase 1 ships only the unit/component tier. Integration and E2E scripts below are reserved for later phases; the current `package.json` provides `test` / `test:unit` (both run Vitest), and the finer-grained scripts are added when those suites exist.

```bash
# Unit & component tests (Vitest + React Testing Library) - implemented in Phase 1
npm run test:unit

# Storage layer tests only (`vitest run src/services/storage`) - Phase 2
npm run test:storage

# Typecheck & Lint
npm run typecheck && npm run lint

# Production build
npm run build

# Native build (requires a Rust toolchain: rustc + cargo)
npm run tauri:build
```

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
