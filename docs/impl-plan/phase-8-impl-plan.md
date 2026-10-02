# Phase 8 Implementation Plan — Static Clone Engine & Local Asset Server

Source of truth: `docs/specs/CLONE-SPEC.md`. Supporting: `docs/architecture/ARCHITECTURE.md` (§2 Layer 1, §4 Rust boundary), `docs/architecture/DATABASE.md` (§3 `scan_assets` sketch, §6 filesystem layout), `docs/architecture/WORKER-PROTOCOL.md`, `docs/architecture/EVENT-SYSTEM.md`, `docs/product/PLAN.md` (Phase 8), `docs/security/SECURITY.md`, `docs/dev/TESTING.md`, `AGENTS.md`.

> This plan was written before implementation (Step 3) and is updated in place as "as built" notes are appended. Where the pre-implementation wording of the spec and the architecture docs disagree, the hierarchy **spec > architecture docs > PRD > roadmap** is applied, and any deviation is recorded here and in `CHANGELOG.md`.

---

## 1. Goal & acceptance criteria

Generate a **downloadable, offline-runnable static clone** of the scanned website: raw HTML, CSS, JS, images, fonts and SVGs captured during the crawl, rewritten so every internal reference resolves to a local relative path, plus a **local static file server** that serves the clone folder for an embedded/preview browser view.

- **Acceptance (PLAN.md Phase 8)**: cloned website renders locally without 404s or external network dependencies; disconnect the internet, load the local clone preview, verify layout and styling are intact.
- **Non-goals in this phase**: visual diffing (Phase 13), blueprint synthesis (Phase 9), component generation (Phase 10+).

### 1.1 CRITICAL GAP inherited from Phases 4 & 7

Phases 4 and 7 persisted page **metadata/structure** only: `scan_pages` holds links/headings/images *URLs*, and `responsive_captures` holds screenshot paths — **no raw HTML bodies and no asset bytes were ever captured**. The clone engine cannot fabricate a clone from metadata. Therefore the worker protocol **and** storage layer MUST be extended **first**:

1. capture the bounded raw HTML of each crawled page;
2. capture the bounded bytes of each referenced asset;
3. persist both (HTML path on the page row, asset bytes + metadata in `scan_assets`).

No clone output is ever synthesized from metadata alone — a page with no captured HTML is reported as **skipped**, never invented.

---

## 2. Files & modules expected to change

### 2.1 New

| Path | Responsibility |
| :--- | :--- |
| `src/services/storage/migrations/007_scan_assets.ts` | Migration 7 — `scan_assets` table + `scan_pages.raw_html_path` additive column. |
| `src/services/storage/repositories/assetRepository.ts` | Owns all SQL for `scan_assets` (upsert batch, list by scan/page, dedupe by sha256, delete by scan). |
| `src/services/clone/clonePaths.ts` | Pure, traversal-safe relative-path derivation for the clone tree (route → `pages/*.html`, asset → `assets/<type>/<hash>.<ext>`). |
| `src/services/clone/htmlRewriter.ts` | Pure, dependency-free HTML rewriting pipeline (CLONE-SPEC §3.1). |
| `src/services/clone/cssRewriter.ts` | Pure CSS `url(...)` / `@charset` rewriting (CLONE-SPEC §4). |
| `src/services/clone/mockClient.ts` | Emits the `js/mock-client.js` stub (CLONE-SPEC §5). |
| `src/services/clone/manifest.ts` | Builds/writes `manifest.json` (CLONE-SPEC §2). |
| `src/services/clone/assetDownloader.ts` | Drives the worker `captureAssets` command and writes bytes via the sandboxed clone IPC. |
| `src/services/clone/cloneService.ts` | Orchestration seam: builds route/asset maps, rewrites, writes the clone tree, emits `clone.*`, returns an honest partial report. |
| `src/services/clone/localServer.ts` | Start/stop the `ProcessManager`-managed local preview server; returns the loopback URL. |
| `src/services/clone/serverPathPolicy.ts` | Pure path-confinement policy for the preview server (traversal/absolute/symlink rejection). |
| `src/workers/cloneServer/index.ts` | Node stdio worker: minimal HTTP server bound to loopback, serving only the clone root. |
| `src/workers/cloneServer/protocol.ts` | Re-export seam for the clone-server wire shapes. |
| `src/stores/cloneStore.ts` | Read-only UI state for clone assets/output; honest loading/empty/error/partial. |
| `src/components/clone/ClonePanel.tsx` | Scan-route panel: generate clone, progress, preview, honest states. |
| `src/types/clone.ts` | Clone domain types (route map, manifest, capture limits). |
| `src-tauri/src/clone.rs` | Sandboxed clone-tree file I/O commands (`clone_root`/`clone_write`/`clone_read`/`clone_delete`). |
| `scripts/fixtures/clone/index.html` (+ `assets/style.css`, `assets/logo.svg`, `assets/app.js`, `assets/font.woff2`) | Offline clone fixture served by `fixtureServer.mjs`. |
| `src/services/clone/__tests__/*.test.ts` | Unit tests for paths, rewriters, manifest, service, server policy. |
| `src/workers/crawler/__tests__/cloneCapture.e2e.test.ts` | Opt-in real-Chromium E2E for raw-HTML + asset capture + clone rewrite. |
| `docs/impl-plan/phase-8-impl-plan.md` | This document. |

### 2.2 Changed (additive / backward-compatible)

| Path | Change |
| :--- | :--- |
| `src/services/infra/workerProtocol.ts` | `ExtractResultPayload.rawHtml`; new `captureAssets` command + result payloads; new limits (`MAX_RAW_HTML_BYTES`, `MAX_ASSET_COUNT`, `MAX_ASSET_BASE64_BYTES`); boundary validation for both. |
| `src/workers/crawler/protocol.ts` | Re-export the new protocol symbols/types. |
| `src/workers/crawler/index.ts` | Capture bounded raw HTML during `extract`; implement the `captureAssets` command. |
| `src/services/scanner/crawlerService.ts` | Persist captured raw HTML via the sandbox + `scan_pages.raw_html_path`. |
| `src/services/storage/{index.ts,types.ts,storageService.ts}` | Export `AssetRepository`; register it in `StorageRepositories`; add row/domain mappers. |
| `src/types/models.ts` | `CloneAsset` domain type; `ScanPage.rawHtmlPath`. |
| `src/services/ipc/commands.ts` | `cloneWrite` / `cloneRead` / `cloneDelete` wrappers. |
| `src/services/scanner/scanService.ts` | Optional clone generation hook after a completed crawl. |
| `src/services/infra/eventBus.ts` | Add `clone.asset_downloaded`, `clone.server_started`, `clone.server_stopped`, `clone.failed` (+ payload types). |
| `src/routes/ScanRoute.tsx` | Mount `ClonePanel`. |
| `src-tauri/src/lib.rs` | Register the clone commands. |
| `scripts/fixtureServer.mjs` | Serve the clone fixture routes. |
| Docs | `PLAN.md`, `CHANGELOG.md`, `CLONE-SPEC.md`, `ARCHITECTURE.md`, `DATABASE.md`, `TESTING.md`, `docs/README.md` (index gets the impl-plan folder). |

---

## 3. Database migration requirements

**Append-only.** Migrations `001`–`006` are never edited (their checksums are recorded in `schema_migrations`).

- **`007_scan_assets.ts` (version 7)**:
  - `CREATE TABLE scan_assets` matching the `DATABASE.md` §3 sketch: `id`, `scan_id` (FK → `scans`, `ON DELETE CASCADE`), `page_id` (FK → `scan_pages`, `ON DELETE SET NULL`), `source_url`, `local_path`, `mime_type`, `size_bytes`, `sha256`, `asset_type` (`CHECK IN ('image','stylesheet','script','font','video','audio','document','other')`), `created_at`.
  - **Additive extension over the sketch** (documented): `page_url TEXT` (the URL of the page the asset was discovered on) and a **unique** `idx_scan_assets_scan_sha (scan_id, sha256)` so identical payloads de-duplicate to one physical file (DATABASE.md §6 retention rule).
  - Indexes: `idx_scan_assets_scan_id`, `idx_scan_assets_page_id`, `idx_scan_assets_sha256`, `idx_scan_assets_asset_type`.
  - **Additive column** `scan_pages.raw_html_path TEXT` (`ALTER TABLE … ADD COLUMN`), the raw-HTML fix for the Phase 4/7 gap. Nullable ⇒ legacy rows and non-clone scans are unaffected.
- **No data loss / backward compatibility**: all changes are `CREATE … IF NOT EXISTS` / nullable `ADD COLUMN`; existing databases migrate forward without touching existing rows.

---

## 4. Worker protocol changes

Additive; `WORKER_PROTOCOL_VERSION` stays `1` (no existing frame shape changes meaning).

1. **Raw HTML on `extract`** — `ExtractResultPayload` gains `rawHtml: { html: string; byteLength: number; truncated: boolean }`. A page's HTML is captured from the same isolated context and **size-capped** by `MAX_RAW_HTML_BYTES` (4 MiB); over-cap content is stored truncated with `truncated: true` and surfaced honestly. Validated at the boundary (string + bounded length + boolean).
2. **New command `captureAssets`** — payload `{ command, sessionId, url, timeoutMs, maxAssets?, maxAssetBytes? }`. The worker navigates (every boundary policy-checked exactly as `extract` does), enumerates `<link rel=stylesheet>`, `<script src>`, `<img src/srcset>`, `<source>`, and `url(...)` refs in inline `style`, fetches each through the page request context with the URL policy applied to every URL before it is requested, base64-encodes the bytes, de-duplicates by SHA-256, and returns:
   `{ command, sessionId, url, finalUrl, status, assets: Array<{ sourceUrl, mimeType, assetType, sizeBytes, sha256, base64 }>, skipped: number, truncated: boolean }`.
   Caps: `MAX_ASSET_COUNT` (e.g. 200) and `MAX_ASSET_BASE64_BYTES` (e.g. 8 MiB per asset); assets over the cap are dropped and counted in `skipped`, never silently substituted.
3. **Validation** — `COMMAND_NAMES`, `validateCommandPayload`, and `validateResultPayload` are extended for both shapes, reusing the existing `isRecord` / `isNonEmptyString` / array-every primitives. Malformed frames stay `WORKER_PROTOCOL_VIOLATION`.
4. **No secrets** — asset bytes are content; cookie/token values are never echoed in any result, log, or event (the browser context attaches cookies transparently; nothing is read out).

---

## 5. Service & state-management changes

- **Asset persistence** — `AssetRepository` (owns `scan_assets` SQL) + `scan_pages.raw_html_path` written through the existing `CrawlerService` persistence port; both `upsertMany` writes are batched in one transaction + one persist.
- **Clone engine** (`src/services/clone/`):
  - `assetDownloader` asks the worker for a page's assets and writes the decoded bytes to the clone tree via the sandboxed clone IPC; returns metadata rows.
  - `htmlRewriter` / `cssRewriter` / `mockClient` / `manifest` / `clonePaths` are **pure** modules (unit-tested, no I/O).
  - `cloneService` composes them: builds a `RouteMap` (crawled URL → local page path) from persisted `scan_pages`, rewrites each captured page, writes `index.html`/`pages/*.html`/`css/styles.css`/`js/*`/`assets/**`/`manifest.json`, emits typed `clone.*` events, and returns `{ generated, skipped, assetsWritten, warnings }`. A page that failed to capture is **skipped and counted** — never fabricated.
- **Local preview server** — `localServer` starts/stops the `ProcessManager`-managed `cloneServer` Node child; only loopback binding; the served root is the resolved clone directory; `serverPathPolicy` enforces containment (reject `..`, absolute paths, symlink escapes). The URL is returned to the UI; the preview opens in the **system** browser so the webview CSP `connect-src` is never widened.
- **Clone store** — `cloneStore` reads persisted rows as the source of truth and mirrors the `clone.*` events for live refresh; it exposes honest `loading` / `empty` / `error` / `partial` states.

---

## 6. UI changes

- `src/components/clone/ClonePanel.tsx` mounted on the Scan route.
- Reuses existing primitives only (`Panel`, `Badge`, `Button`, `StatusIndicator`, `EmptyState`) and existing tokens from `src/styles/tokens.css`; no new palette, no low-contrast text, no fabricated progress.
- States: **idle** (explain what will be generated), **loading** (real event-driven progress, honest counts), **empty** (no captured pages/assets), **error** (structured message + suggested action), **partial** (N of M pages cloned; the skipped list is shown).
- Copy is English, matching the existing Scan route; Indonesian is used only where the current UI already uses it (nowhere on this screen).

---

## 7. Test coverage

- **Unit** (`src/services/clone/__tests__/`): path derivation + traversal rejection; HTML rewriting (absolute/protocol-relative remap, anchors, external `target=_blank rel`, `<base>` stripping, tracking-script stripping, mock-client injection, `srcset`); CSS rewriting + `@charset` dedupe; manifest shape; snapshot-free fixture-based rewriter golden tests; server path policy (accept in-root, reject `..`/absolute/symlink).
- **Storage** (`src/services/storage/__tests__/`): migration 007 applies forward, `raw_html_path` column exists, `scan_assets` CRUD + sha256 dedupe + FK cascade; reopen persistence.
- **Protocol** (`src/services/infra/workerProtocol.test.ts` + extract test): `captureAssets` command/result validation (valid + malformed), raw-HTML bounding.
- **Service** (integration): `cloneService` over a fake worker + in-memory storage → asserts a rewritten `index.html` pointing at local assets, `manifest.json`, and honest skipping when HTML is absent.
- **Real-browser E2E** (opt-in, `RUN_BROWSER_TESTS=1 npm run test:browser`): `cloneCapture.e2e.test.ts` drives the **real** worker against the local clone fixture through `extract` (raw HTML) + `captureAssets` (asset bytes), then runs the pure rewriter and asserts zero remaining external references.
- **Tooling**: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:storage`, `npm run build`, the opt-in browser suite, and `cargo check` / `cargo clippy` / `cargo fmt --check` in `src-tauri`.

---

## 8. Regression risks & mitigations

| Risk | Mitigation |
| :--- | :--- |
| Editing an applied migration breaks checksums. | New `007` only; `001`–`006` untouched; checksum test still passes. |
| Worker protocol change breaks existing consumers. | Purely additive; version stays `1`; every new frame validated at the boundary; existing tests must still pass. |
| New worker command bypasses the URL/network policy. | Reuse `evaluateUrlPolicy` at every navigation **and** every asset URL before requesting it, exactly as `extract` does. |
| Local server path traversal / directory escape. | `serverPathPolicy` canonicalizes and re-verifies containment; rejects `..`, absolute paths, and symlink escapes; loopback-only bind; no CSP widening. |
| Raw HTML / asset capture balloons memory or the DB. | Hard byte/count caps in the protocol; over-cap content truncated + flagged; bytes go to disk, only metadata + path in SQLite. |
| Asset bytes or session material leak into logs/events. | Asset payloads never logged; only counts/shas/mime are emitted on `clone.*`; cookies are never read out. |
| Visual fidelity "fabricated". | Honest partial reporting — uncaptured pages/assets are counted and listed; never invented. |

---

## 9. Out of scope (explicit)

- **Tailwind responsive-rule synthesis** (deferred Phase 7 work) — **not** part of Phase 8.
- **ZIP export / native folder-explorer trigger** (CLONE-SPEC §6.2–6.3) — deferred: no `zip` crate is a dependency and packaging changes are out of this phase's scope. Documented as deferred in the plan + `CHANGELOG.md`.
- **Full CSS bundling/minification and `@font-face` merging** — this phase rewrites references and preserves captured stylesheets; deep bundling is deferred.
- **Runtime JS de-obfuscation / API mocking beyond the static stub** — only the CLONE-SPEC §5 stub is emitted.
- Phase 9+ (blueprint, AI, generation) and unrelated refactors/format sweeps/config changes.

---

## 10. Open decisions (C3–C7) — resolution & rationale

| # | Decision | Resolution | Rationale (hierarchy) |
| :- | :--- | :--- | :--- |
| **C3** | Who owns the `scan_assets` table? | **Phase 8** creates and owns `scan_assets` in migration `007`, with `AssetRepository` owning all its SQL. | `DATABASE.md` §3 already defines the table and §2.1 lists it as *deferred to its owning phase*; migration `002` explicitly deferred it to "the assets phase". The assets phase **is** Phase 8. |
| **C4** | Where does clone output live? | `<project storage path>/clones/v1/`, using the CLONE-SPEC §2 internal layout (`index.html`, `pages/`, `css/`, `js/`, `assets/{images,fonts,media}`, `manifest.json`). | Direct conflict: `CLONE-SPEC.md` §6 ("inside `<PROJECT_DIR>/clones/v1/`") vs `DATABASE.md` §6 (`<project>/clone/…`). Hierarchy is **spec > architecture doc** ⇒ follow CLONE-SPEC. |
| **C5** | Sandbox scope of the local server. | Loopback-only (`127.0.0.1`, ephemeral port); serves **only** the canonicalized clone root; rejects `..`, absolute paths, and symlink escapes; opened in the system browser so the webview CSP `connect-src` is **not** widened; run as a `ProcessManager`-managed child. | `SECURITY.md` (path-traversal/local-FS threat), `WORKER-PROTOCOL.md` (no CSP widening), `AGENTS.md` (no unmanaged long-running processes). |
| **C6** | ZIP export. | **Deferred** to a later phase; the code/plan records it. | `PLAN.md` Phase 8 scope is only "Asset downloader, relative URL rewriter, local static file server"; no `zip` dependency exists; adding a native dependency + packaging is a scope expansion, not required by any Phase 8 acceptance criterion. |
| **C7** | Clone metadata/UI seam. | Mirror Phase 7 exactly: repositories via `storageService`, a `cloneStore` that reads persisted rows as the source of truth and mirrors `clone.*` events, and a token-compliant `ClonePanel` with honest states. | `ARCHITECTURE.md` §5/§3.6 (store-seam pattern), `EVENT-SYSTEM.md` (`clone.*` taxonomy), `UI-SPEC.md` + `anti-ui-slop`. |

---

## 11. As-built notes

Appended as the implementation landed. Verification evidence (exact command results) is reported with the Step 5 verification.

- **New files**: `src/services/storage/migrations/007_scan_assets.ts`; `src/services/storage/repositories/assetRepository.ts`; `src/services/clone/{clonePaths,htmlRewriter,cssRewriter,mockClient,manifest,assetDownloader(part of cloneService),cloneService,cloneFactory,localServer,serverPathPolicy,runClone,index}.ts`; `src/workers/cloneServer/{index,protocol,workerPaths}.ts`; `src/stores/cloneStore.ts`; `src/components/clone/ClonePanel.tsx`; `src/types/clone.ts`; `src-tauri/src/clone.rs`; fixtures `scripts/fixtures/clone/**`; unit/E2E tests under `src/services/clone/__tests__/`, `src/services/storage/__tests__/scanAssets.test.ts`, `src/stores/cloneStore.test.ts`, `src/workers/crawler/__tests__/cloneCapture.e2e.test.ts`.
- **Changed (additive)**: `workerProtocol.ts` (+`src/workers/crawler/protocol.ts` re-export), `src/workers/crawler/index.ts`, `scannerWorkerClient.ts`, `eventBus.ts`, `ipc/commands.ts` (+`index.ts`), `storage/{index,types,storageService}.ts`, `repositories/scanPageRepository.ts`, `types/models.ts`, `routes/ScanRoute.tsx`, `src-tauri/src/lib.rs`, `scripts/fixtureServer.mjs`, and the docs listed in section 2.2.
- **Protocol limits**: `MAX_RAW_HTML_BYTES` = 4 MiB; `MAX_ASSET_COUNT` = 200; `MAX_ASSET_BYTES` = 8 MiB. `WORKER_PROTOCOL_VERSION` stays `1`.
- **Deviations from the plan text**: `assetDownloader.ts` and `server.ts` (named in the plan's file table) were folded into `cloneService.ts` + `localServer.ts` respectively - same responsibilities, fewer files. The `cloneServer` worker reuses `src/services/clone/serverPathPolicy.ts` verbatim (single source of truth for path confinement).
- **Verification deltas**: `docs/architecture/DATABASE.md` section 2.1's "deferred tables" list no longer includes `scan_assets`; `src/services/storage/__tests__/database.test.ts` was updated accordingly. `cargo fmt --check` fails on **pre-existing** files (`asset.rs`, `process.rs`, `storage.rs` at HEAD `552e495`); `clone.rs` intentionally matches that established hand style and no repo-wide format sweep was performed (out of scope).
