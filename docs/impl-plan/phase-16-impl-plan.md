# Phase 16 Implementation Plan — End-to-End Integration Testing & Release Packaging

Source of truth: `docs/product/PLAN.md` (Phase 16 §638-651). Supporting:
`docs/dev/TESTING.md` §4 (E2E strategy) and §5 (CI commands), `docs/architecture/ARCHITECTURE.md`,
`docs/architecture/WORKER-PROTOCOL.md`, `docs/security/SECURITY.md` §6 (process sandbox),
`docs/product/PRD.md` §4 (MVP = Phase 0-16), `CONTRIBUTING.md` §2/§4, `AGENTS.md` §9,
`docs/impl-plan/phase-12-impl-plan.md` (opt-in build E2E precedent) and
`docs/impl-plan/phase-14-impl-plan.md` (opt-in artifact E2E precedent).

> Written after the mandatory repository audit and **before** any implementation. Where the
> pre-implementation roadmap wording and the as-built repository disagree, the hierarchy
> **PLAN.md (authoritative, newest) > spec > architecture docs > PRD** is applied and every
> deviation is recorded in §14 here and in `CHANGELOG.md`.

---

## 1. Phase identification

**Phase 16 — End-to-End Integration Testing & Release Packaging.** This is the final MVP phase
(`PRD.md` §4 scopes the MVP to Phase 0-16). It adds **no new product feature**: it proves the whole
pipeline (Scan → Blueprint → Project → Build/Export) runs end-to-end, packages the desktop app for
release, and documents installation/release.

## 2. Objective

1. **E2E pipeline validation** — an automated suite that drives the real post-crawl pipeline
   (Blueprint synthesis → component synthesis → project generation → generated-project build →
   documentation/ZIP export) and asserts the output is buildable, with no fabricated success.
2. **Desktop packaging** — a working, correctly-configured Tauri release bundle for Windows
   (`.msi`/`.exe`) and macOS (`.dmg`), including the **critical fix** that the Node worker
   entrypoints are currently unresolvable in a packaged app (§3.1).
3. **Release process + docs** — a root `README.md` (install, usage, build, troubleshoot), a
   `RELEASE.md` (versioning + release steps), CI workflows that build/verify, and a tagged release
   with artifacts.
4. **Performance/limits note** — record the measured scan/build timing and memory envelope honestly
   rather than asserting unverified numbers.

## 3. Repository audit (actual repository state)

- Branch `main`; HEAD is the Phase 15 work (PLAN.md §577-634); working tree is clean; **no root
  `README.md` exists** (only `docs/README.md`), and **no `.github/` directory exists** (no CI).
- Baseline gates (per the Phase 15 as-built note): `typecheck`, `lint`, `test`
  (**986 passed / 25 skipped**), `build`, `cargo check`, `cargo clippy --all-targets` all PASS.
  `format:check` is pre-existing RED (106 files) and **not** in the DoD (`AGENTS.md` §9).
- `package.json` version `0.1.0`; `src-tauri/tauri.conf.json` version `0.1.0`;
  `src-tauri/Cargo.toml` version `0.1.0`. `bundle.targets` is `"all"`.
- The opt-in E2E precedent already exists and is the pattern to follow:
  `RUN_PROJECT_BUILD=1` (`projectGenerator.build.e2e.test.ts`) and `RUN_EXPORT_E2E=1`
  (`zipExporter.e2e.test.ts`); real-browser tests gate on `RUN_BROWSER_TESTS=1`.

### 3.1 CRITICAL packaging gap (found in audit — must be fixed first)

The crawler worker and the clone preview server are launched as **TypeScript** entrypoints resolved
relative to the module location:

- `src/workers/crawler/workerPaths.ts` → `resolveWorkerScriptPath()` returns
  `join(dirname(import.meta.url), 'index.ts')` and spawns
  `node --experimental-strip-types <…>/index.ts`.
- `src/workers/cloneServer/workerPaths.ts` is identical.

`vite build` emits only the webview bundle into `dist/`; it does **not** copy `src/workers/**`, and
`tauri.conf.json` declares **no `bundle.resources`**. Therefore a packaged installer would ship no
worker script and the crawler/clone-preview features would fail at runtime with an unresolvable
path. This is the phase's top risk and is resolved in §8 (C1). No Phase 16 E2E or release is
"done" while a packaged app cannot locate its workers.

### 3.2 Other audit findings relevant to packaging

- The Rust process layer enforces an executable allowlist of `node`/`node.exe`
  (`src-tauri/src/process.rs:40`) — packaging **cannot** switch to a bundled binary without also
  changing the allowlist, so §8 keeps the Node-runtime model and documents the prerequisite.
- `src-tauri/capabilities/default.json` grants only `core:default`; custom app commands need no
  extra capability, so no capability change is required.
- The worker protocol version is `1`; Phase 16 adds no protocol change.
- The Phase 12 build E2E and Phase 14 export E2E are the authoritative per-stage artifacts; Phase 16
  composes them rather than duplicating their assertions.

## 4. Requirements traceability matrix

| # | Requirement (PLAN §) | Existing coverage | Required change | Verification |
| :-- | :-- | :-- | :-- | :-- |
| **R1** | "Execute automated end-to-end test suite against reference demo websites." (§644) | Per-stage opt-in E2Es; no composed pipeline test | New offline composed pipeline E2E + opt-in browser E2E against the local fixture server (no public sites) | `phase16Pipeline.e2e.test.ts`, `phase16FullPipeline.e2e.test.ts` |
| **R2** | "Configure Tauri release bundler for Windows (.msi/.exe) and macOS (.dmg)." (§645) | `targets: "all"`, no explicit config, no resources | Explicit per-OS bundle targets + **worker resource packaging** + metadata | `tauri.conf.json`; `cargo tauri build` artifact |
| **R3** | "Validate performance, scan speed, and memory consumption." (§646) | None | A bounded performance harness that records real numbers (no asserted thresholds) | `phase16Pipeline.perf.test.ts` |
| **R4** | "Full E2E pipeline test with Vitest/Playwright." (§647) | Vitest used; no browser E2E for the full pipeline | Opt-in real-Chromium E2E that composes crawl → blueprint → generate → build | `RUN_BROWSER_TESTS=1` suite |
| **R5** | "Single-click scan to generated project completes with 100% buildable output; native installer packages successfully." (§648) | Project build E2E proves buildability | Compose + assert `dist/` exists from the E2E-generated project; build installer | E2E + installer artifact |
| **R6** | "Install generated desktop package on clean environment; execute full website reverse-engineering workflow." (§650) | None | `README.md` install/usage + `RELEASE.md` manual clean-install checklist (manual, recorded) | Docs + recorded manual result |
| **R7** | User request: "update README.md how to install and so on" | No root README | New root `README.md` | Render/review |
| **R8** | User request: "create release" | No CI, no tag process | `RELEASE.md` + CI workflows + version/tag + local Windows artifacts | Tag + artifacts |

## 5. Exact implementation scope

Authoritative `PLAN.md` text (verbatim, §638-651):

> **Phase 16: End-to-End Integration Testing & Release Packaging**
> - **Goal**: Full pipeline integration validation and desktop installer builds.
> - **Scope**: E2E test runs (Scan -> Blueprint -> Project -> Build), production Tauri bundle generation.
> - **Dependencies**: Phase 0 through Phase 15.
> - **Files/Modules Affected**: `e2e/`, `src-tauri/tauri.conf.json`.
> - **Implementation Tasks**:
>   1. Execute automated end-to-end test suite against reference demo websites.
>   2. Configure Tauri release bundler for Windows (.msi / .exe) and macOS (.dmg).
>   3. Validate performance, scan speed, and memory consumption.
> - **Tests**: Full E2E pipeline test with Vitest/Playwright.
> - **Acceptance Criteria**: Single-click scan to generated project completes with 100% buildable output; native installer packages successfully.
> - **Potential Risks**: Platform-specific installer code signing and packaging hurdles.
> - **Verification**: Install generated desktop package on clean environment; execute full website reverse-engineering workflow.

Scope decisions:

1. **S1 — E2E harness in `e2e/`** (the PLAN-named directory), mirroring the existing opt-in gate
   convention. Three tiers:
   - **Offline pipeline** (default-skipped, no browser): real in-memory SQLite → persisted
     Blueprint evidence → `runBlueprint` → `synthesizeComponents` (scripted engine) →
     `generateProject` → `exportProject` (ZIP) → `readZip` verify. Proves the wiring between all
     real post-crawl services with no network and no browser.
   - **Real-browser pipeline** (`RUN_BROWSER_TESTS=1`): fixture server → real Chromium crawl →
     real Blueprint lifecycle (sandboxed file I/O via Node fs injection) → generate → real
     `npm install && npm run build` → assert `dist/`. This is the R4/R5 authoritative test.
   - **Desktop shell smoke** (`RUN_DESKTOP_E2E=1`, opt-in): documented as manual/CI-desktop; see §9.
2. **S2 — Worker packaging fix**: add `bundle.resources` for the worker trees and a packaged-aware
   worker path resolver (§8 C1).
3. **S3 — Bundler config**: explicit `bundle.targets` per OS, `bundle.windows` (NSIS + MSI),
   `bundle.macOS` (dmg), `bundle.category`, `bundle.shortDescription`/`longDescription`,
   `bundle.publisher`, `bundle.copyright`, and `bundle.createUpdaterArtifacts: false`.
4. **S4 — Performance harness**: a bounded, deterministic perf test that records Blueprint/generator
   timing and byte counts; **no threshold assertions** (flaky) — it prints and asserts only
   invariants (e.g. generator completes within the test timeout, output within documented caps).
5. **S5 — README.md**: install (prereqs per `CONTRIBUTING.md` §2.1), quick start, first scan,
   build/packaging, troubleshooting, security posture, docs links.
6. **S6 — Release process**: `RELEASE.md` (semver, version bump locations, tag format, artifact
   matrix, code-signing notes) + `.github/workflows/` (CI verify on push/PR; release build on tag).
7. **S7 — Version + tag**: bump the three version locations to the release version and create a git
   tag; produce local Windows artifacts.

## 6. Explicit exclusions

- **No new product feature** and no new worker protocol command (`WORKER_PROTOCOL_VERSION` stays 1).
- **No new SQLite migration** (`001`-`008` checksums remain stable).
- **No bundling of Chromium or Node**: the app keeps requiring the host Node runtime + a
  Playwright-installed Chromium; §8 C1 documents this and the honest runtime error already exists.
- **No macOS build on Windows**: only Windows artifacts are produced locally; macOS `.dmg` is
  configured and built by the macOS CI job (§9). This is stated, not silently skipped.
- **No code signing**: unsigned local artifacts; signing is documented as a release-time step
  (PLAN risk §649).
- **No `format:check` fix** (pre-existing RED, not a gate; Phase 15 C8).
- **No fabricated performance claims**: numbers come from the perf harness run in this phase.

## 7. Existing architecture / components to reuse (do not duplicate)

| Need | Reuse (exact symbol + path) |
| :-- | :-- |
| Crawl orchestration | `CrawlerService`, `createCrawlerService` (`src/services/scanner/crawlerFactory.ts`) |
| Blueprint synthesis + persistence | `runBlueprint` (`src/services/blueprint/runBlueprint.ts`), `runBlueprintLifecycle` + `BlueprintFilePort` (`src/services/blueprint/blueprintLifecycle.ts`) |
| Component synthesis | `synthesizeComponents`, `ComponentSynthesisEngine` (`src/services/generator/componentSynthesizer.ts`) |
| Project generation | `generateProject` (`src/services/generator/projectGenerator.ts`) |
| Export | `exportProject`, `createNodeExportIo`, `readZip` (`src/services/exporter/`) |
| In-memory DB | `createTestStorage()` (`src/services/storage/__tests__/helpers.ts`) |
| Fixture server | `startFixtureServer` (`scripts/fixtureServer.mjs`) |
| Real-browser stdio adapter pattern | `StdioWorkerAdapter` (`src/workers/crawler/__tests__/crawlerService.e2e.test.ts`) |
| Opt-in build E2E precedent | `projectGenerator.build.e2e.test.ts` (`RUN_PROJECT_BUILD`) |
| Opt-in artifact E2E precedent | `zipExporter.e2e.test.ts` (`RUN_EXPORT_E2E`) |
| Worker spawn descriptor | `resolveWorkerEntrypoint` (`src/workers/crawler/workerPaths.ts`), `resolveCloneServerEntrypoint` (`src/workers/cloneServer/workerPaths.ts`) |

## 8. Input / output / public contracts

### 8.1 E2E harness (`e2e/`)

```ts
// e2e/harness/pipeline.ts (test-only; not shipped in the app bundle)
export interface PipelineRunResult {
  ok: boolean;
  crawl?: CrawlResult;
  blueprint?: BlueprintLifecycleOutcome;
  synthesis?: ComponentSynthesisSummary;
  project?: ProjectGenerationReport;
  export?: ExportProjectReport;
  timingsMs: { crawl?: number; blueprint: number; synthesis: number; generate: number; export: number };
  error?: StructuredError;
}

/** Offline: real services, injected storage/file/engine seams. */
export function runOfflinePipeline(input: OfflinePipelineInput): Promise<PipelineRunResult>;
```

Gates (mirroring existing names): `RUN_BROWSER_TESTS`, `RUN_PROJECT_BUILD`, `RUN_EXPORT_E2E`
(reused), plus a new `RUN_DESKTOP_E2E` for the optional packaged-shell check.

### 8.2 Packaged worker resolution (`workerPaths` change)

The resolver must return a path that exists in **both** dev and a packaged app. Decision (§8 C1):
keep the Node-runtime model and add a packaged fallback.

```ts
/**
 * Resolution order:
 *  1. Dev/tsx: the co-located `.ts` entrypoint (current behaviour).
 *  2. Packaged: `<resourceDir>/workers/<name>/index.js` copied by the bundler.
 * Returns the first candidate that exists, else the dev candidate (honest failure
 * surfaces through the existing PROCESS_SPAWN_FAILED path).
 */
export function resolveWorkerScriptPath(): string;
```

This is test-only observable via an injected `exists`/resource-dir seam (no Tauri dependency in the
pure resolver).

### 8.3 Bundler config (`tauri.conf.json`)

```jsonc
"bundle": {
  "active": true,
  "targets": ["nsis", "msi", "dmg", "app"],   // explicit; Windows job builds nsis+msi, macOS dmg+app
  "category": "DeveloperTool",
  "publisher": "Artupski",
  "shortDescription": "Desktop-native website reverse engineering and blueprinting tool.",
  "longDescription": "…",
  "createUpdaterArtifacts": false,
  "resources": {
    "workers": "resources/workers"            // staged by the build script (§8 C1)
  },
  "icon": [ /* unchanged */ ]
}
```

### 8.4 Release metadata

- Version bump locations (all three): `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` (plus `Cargo.lock` refresh).
- Tag format: `v<major>.<minor>.<patch>` (e.g. `v0.1.0`).

## 9. Test plan

### 9.1 Offline composed pipeline (default suite, no browser/network)

`e2e/phase16Pipeline.e2e.test.ts` — **skipped by default** (it runs real `npm install && build` only
in its second half; the first half is pure). To keep the default `npm run test` fast and hermetic,
the file gates the build half on `RUN_PROJECT_BUILD=1` and the pure half always runs. It asserts:
real SQLite evidence → real `runBlueprint` → scripted `synthesizeComponents` → real `generateProject`
→ real `exportProject` ZIP → `readZip` contains the generated docs and every source file.

### 9.2 Real-browser pipeline (opt-in `RUN_BROWSER_TESTS=1`)

`e2e/phase16FullPipeline.e2e.test.ts` — fixture server (`127.0.0.1`, dedicated port `8080`; see C8
below) → real
Chromium crawl → real Blueprint lifecycle → generate → `RUN_PROJECT_BUILD` build → assert
`dist/index.html`. Honest BLOCKED (skip) when npm or Chromium is unavailable, never a false PASS.

### 9.3 Performance harness (default suite)

`e2e/phase16Pipeline.perf.test.ts` — deterministic synthetic Blueprint (bounded N pages/components)
through `generateProject`; records elapsed ms and bytes; asserts only invariants (completes, within
caps, deterministic byte count across two runs). No timing thresholds.

### 9.4 Worker packaging unit test (default suite)

`src/workers/crawler/__tests__/workerPaths.test.ts` (extend) — resolver returns the dev entrypoint
when only it exists, the packaged entrypoint when a resource dir is provided and the file exists,
and never a shell string; args remain an array; command stays on the `node`/`node.exe` allowlist.

### 9.5 Manual/CI-desktop smoke (documented, `RUN_DESKTOP_E2E=1`)

Documented in `RELEASE.md` §clean-install: install the artifact on a clean machine, launch, run one
fixture scan end-to-end. Not automatable in this environment (no clean VM); recorded honestly.

## 10. Verification commands

```text
npm run typecheck
npm run lint
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
npm run tauri:build            # Windows installer (nsis + msi)
```

Opt-in E2E:

```text
RUN_BROWSER_TESTS=1 npx vitest run e2e
RUN_PROJECT_BUILD=1 npx vitest run e2e
RUN_EXPORT_E2E=1 npx vitest run e2e
```

`npm run format:check` remains pre-existing RED and is **not** a Phase 16 gate.

## 11. Documentation changes

- New root `README.md` (install/usage/build/troubleshoot/security/docs).
- New `RELEASE.md` (versioning, release steps, artifact matrix, clean-install checklist, signing).
- `docs/product/PLAN.md`: mark Phase 16 COMPLETE with an as-built note (mirroring Phases 8-15).
- `docs/dev/TESTING.md`: add §5.14 (Phase 16 E2E + perf tier) and the `RUN_DESKTOP_E2E` gate.
- `docs/README.md`: index this plan and the root README.
- `CHANGELOG.md`: new `[Unreleased]` Phase 16 entry.
- `CONTRIBUTING.md`: link the new build/release docs.
- `.github/workflows/`: `ci.yml` (verify) and `release.yml` (tag → build artifacts).

## 12. Git / commit strategy

One focused commit on `main`:

```text
test(e2e): add end-to-end pipeline suite and release packaging (phase 16)
```

Then a release tag `v0.1.0` (annotated). Do not amend earlier phases.

## 13. Risks / unverifiable assumptions (stated, not guessed)

1. **Packaged worker resolution** (§3.1) is the top risk; §8 C1 fixes it and §9.4 tests the resolver,
   but the true packaged check is the manual clean-install smoke (§9.5).
2. **Host prerequisites**: the packaged app still needs the host Node runtime and a
   Playwright-installed Chromium. This is documented, not hidden; the app already fails honestly
   (`PROCESS_SPAWN_FAILED` / `browser.missing`).
3. **Code signing** is out of scope; unsigned artifacts may show OS warnings (PLAN risk §649).
4. **macOS artifacts** cannot be produced on this Windows host; the macOS job is configured and
   documented but its output is unverified here.
5. **Real `npm install` in E2E** depends on network/registry availability; the suite reports BLOCKED
   rather than PASS when it cannot run.

## 14. Specification discrepancies & justified deviations

1. **C1 — Worker packaging model.** The repo runs TS workers via `node --experimental-strip-types`
   and resolves them next to the module, which cannot work in a packaged app. Phase 16 keeps the
   Node-runtime model (changing it would break the Rust executable allowlist and add a bundler) and
   instead stages the worker trees as Tauri `resources` with a packaged-aware resolver. **Recorded,
   not silent.**
2. **C2 — "reference demo websites" = local fixtures.** PLAN §644 says "reference demo websites";
   the repo's established rule is **no public websites** in tests (`TESTING.md` §2.1/§3.1), so the
   E2E uses the deterministic local fixture server. This is safer and deterministic.
3. **C3 — Performance is recorded, not asserted.** PLAN §646 says "validate performance"; asserting
   wall-clock thresholds is flaky across machines, so the harness records real numbers and asserts
   only invariants. The measured values are written into the as-built note.
4. **C4 — No bundled browser/Node.** Consistent with Phase 3/8 decisions and the `TODO.md` open
   question; documented as a prerequisite, not silently claimed solved.
5. **C5 — macOS build delegated to CI.** Cross-compiling a `.dmg` on Windows is not supported;
   configuration is delivered and the macOS CI job owns the artifact.
6. **C6 — `format:check` remains RED** (pre-existing, not a gate; Phase 15 C8).
7. **C7 — No `e2e/` directory was scaffolded before**; the PLAN-named `e2e/` is created now and the
   Vitest `include` glob is extended to cover it (it currently matches only `src/**`).
8. **C8 — Full-pipeline fixture port is `8080`, not the plan's `8100`.** §9.2 named port `8100`, but
   the crawler's SSRF port allowlist (`ALLOWED_PORTS` in
   `src/services/scanner/security/urlPolicy.ts`) does not include `8100`; a crawl of it is honestly
   rejected with `port_rejected` and persists zero pages. Widening that security control for a test
   would be a product change this phase forbids, so the suite uses `8080` — an allowlisted port no
   other suite uses. **Recorded, not silent.**

### 14.1 As-built note (C1 staging mechanism)

The staging mechanism chosen for C1 is a dedicated script, `scripts/stageWorkers.mjs`, invoked by
`tauri.conf.json`'s `beforeBuildCommand` (`npm run build && npm run stage-workers`). It esbuild-bundles
`src/workers/crawler/index.ts` and `src/workers/cloneServer/index.ts` into self-contained CommonJS
`index.js` files under `src-tauri/resources/workers/<name>/` (each with a local
`package.json` marking the directory CommonJS), and copies the runtime `playwright-core` package to
`src-tauri/resources/node_modules/playwright-core`. `bundle.resources` then maps the staged trees into
`$RESOURCE/workers` and `$RESOURCE/node_modules/playwright-core`. `playwright-core` is external (not
inlined) because it resolves its own optional `chromium-bidi` modules at runtime; the Playwright
browser binary remains the host prerequisite and is never bundled.

## 15. Acceptance criteria (1:1 with PLAN §638-651)

1. An automated E2E suite drives Scan → Blueprint → Project → Build (offline + opt-in browser). (§644)
2. The Tauri bundler is configured for Windows `.msi`/`.exe` and macOS `.dmg`, and the packaged app
   can locate its workers. (§645, §3.1)
3. Performance/scan-speed/memory numbers are measured and recorded. (§646)
4. A full Vitest/Playwright pipeline test exists. (§647)
5. The E2E-generated project builds (`dist/`) and a native installer packages successfully. (§648)
6. `README.md` documents installation/usage; `RELEASE.md` documents the clean-install verification. (§650)
7. All verification gates (§10) pass; Phases 1-15 behavior, events, and schema are unchanged.
8. A tagged release exists with Windows artifacts (and macOS via CI).
