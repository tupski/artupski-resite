# Phase 13 Implementation Plan — Visual Verification & Diff Engine

Source of truth: `docs/product/PLAN.md` (Phase 13 §451-463). Supporting:
`docs/design/UI-SPEC.md` §2.7 (Visual Comparison Screen),
`docs/design/RESPONSIVE-SPEC.md` §2/§5 (viewport profiles, responsive captures),
`docs/architecture/ARCHITECTURE.md` §2 Layer 1 (loopback static server), §4 (Rust/TS boundary),
`docs/architecture/EVENT-SYSTEM.md` (event taxonomy), `docs/architecture/ERROR-HANDLING.md`,
`docs/architecture/WORKER-PROTOCOL.md`, `docs/dev/TESTING.md`, `docs/impl-plan/phase-12-impl-plan.md`,
`docs/impl-plan/phase-8-impl-plan.md`, `AGENTS.md`, and the anti-ui-slop skill (operate playbook).

> Written after the mandatory audit and before implementation. Where the pre-implementation
> roadmap wording and the architecture/spec docs disagree, the hierarchy
> **PLAN.md (authoritative, newest) > spec > architecture docs > PRD** is applied and any
> deviation is recorded in §17 here and in `CHANGELOG.md`.

---

## 1. Phase identification

**Phase 13 — Visual Verification & Diff Engine.**

## 2. Objective

Compare the **original captured website** against the **generated project's rendering**: launch the
generated project on a local dev server, capture screenshots of the generated pages at viewport
profiles that match the Phase 7 captures, compute a pixel-level diff image and a similarity score,
and present a side-by-side / slider-overlay viewer with a mismatch score and an honest list of
missing fonts / layout shifts / missing image assets.

## 3. Audit findings (actual repository state)

- Branch `main`, HEAD `8162cf1` = Phase 12 commit
  `feat(generator): add full-stack project generator (phase 12)`; working tree clean.
- Baseline verification gates are all green: `typecheck` PASS, `lint` PASS, `test` PASS
  (**814 passed / 24 skipped**, 85 files passed / 9 files skipped), `build` PASS,
  `cargo check` PASS, `cargo clippy --all-targets` PASS.
- **Phase 8** delivered the sandboxed loopback clone preview server:
  `src/workers/cloneServer/index.ts` (dedicated `ProcessManager`-managed Node child, binds
  `127.0.0.1` only, serves strictly inside the canonical clone root), `src/services/clone/localServer.ts`
  (lifecycle owner, injectable `CloneServerAdapter`), and `src/services/clone/serverPathPolicy.ts`
  (pure traversal/absolute/NUL/backslash rejection, URL-decode, `index.html` directory resolution).
- **Phase 7** delivered responsive capture: `src/services/scanner/responsiveScanner.ts` calls the
  crawler worker `captureViewport(sessionId, url, profile, timeoutMs)` and writes the PNG through the
  sandboxed Rust `asset_write` command; metadata + element map persist as `ResponsiveCapture`
  (`src/types/models.ts` §193-215, migration 006). **The PNG bytes themselves are NOT in SQLite** —
  only `screenshotPath` is stored, under the app-local `assets/` root.
- **Phase 12** delivered `generateProject(deps, input)` (`src/services/generator/projectGenerator.ts`)
  + templates (`src/templates/project/`). It emits a standalone Vite + React + TS + Tailwind project
  with its own `package.json` and a real `npm run build` (opt-in build E2E verified PASS).
- **No** `src/services/diff/` module, **no** `src/components/diff/` component, and **no** `diff.*`
  event type exists yet. Phase 13 is greenfield at the diff layer.
- The shared `ProcessManager` (`src/services/infra/processManager.ts`) + `TauriProcessSpawner`
  spawn child processes through the Rust `process_spawn` allowlist (commands allowed include `node`,
  `npm`); no shell strings are ever used.
- `eventBus` (`src/services/infra/eventBus.ts`) has a fixed `AppEventType` union with a `project`
  domain (`project.started|file_generated|completed`). **No `diff` domain is declared yet.**

## 4. Exact Phase 13 scope (from `PLAN.md`)

1. **Launch generated project in background dev server.**
2. **Capture screenshots of generated pages at matching viewports.**
3. **Compute visual diff image and similarity score percentage.**
4. **UI**: dual-preview side-by-side view + slider overlay + color-coded diff + mismatch score +
   discrepancy inspector (missing fonts / layout shifts / missing image assets).
5. **Tests**: visual diff calculation with known mismatch images.
6. **Acceptance**: display side-by-side visual comparison with overlay diff slider and mismatch score.

## 5. Explicit exclusions

- Documentation generation (`README.md`/`ARCHITECTURE.md`/`COMPONENTS.md`) and ZIP/folder export —
  **Phase 14** (`src/services/exporter/docGenerator.ts`, `zipExporter.ts`).
- Settings/security hardening UI, OS keychain, global error boundary — **Phase 15**.
- E2E release packaging / installers — **Phase 16**.
- No new worker binary, no new IPC command, no DB migration, and `WORKER_PROTOCOL_VERSION` stays `1`
  unless §17 records a justified exception.
- No pixel diffing of the **live** site during Phase 13: Phase 13 diffs the already-captured original
  (Phase 7 screenshot) against the freshly captured generated-project render (Phase 8/13 adapter).

## 6. Existing architecture / components to reuse (do not duplicate)

| Need | Reuse |
| :--- | :--- |
| Launch a managed local server for the generated project | `ProcessManager` + `TauriProcessSpawner`, mirroring `src/services/clone/localServer.ts` |
| Serve generated files safely (root confinement) | `src/services/clone/serverPathPolicy.ts` `resolveServePath` (pure, already tested) |
| Loopback HTTP server implementation | generalize `src/workers/cloneServer/index.ts` — see §17 deviation |
| Screenshot capture at a viewport | `BrowserRuntime.captureViewport` → `captureViewport` worker command (`ViewportProfile`) |
| Viewport profile constants | `RESPONSIVE_VIEWPORT_PROFILES` in `src/services/infra/workerProtocol.ts` |
| Original-capture metadata + screenshot path | `ResponsiveCapture` rows (migration 006) via `storageService` repositories |
| Generated project files | `ProjectGenerationReport.files` (Phase 12) |
| Errors / events / process safety | `src/services/infra/errors.ts`, `eventBus.ts`, `processErrors.ts`, AGENTS.md rules |

## 7. Data / input / output contracts

### 7.1 Inputs

- **Original**: a `ResponsiveCapture` row for the scanned page (URL, viewport `profile`, width/height,
  `deviceScaleFactor`, `isMobile`, `hasTouch`, and the sandboxed `screenshotPath`).
- **Generated**: an absolute `projectRoot` (the Phase 12 target root) and the route paths emitted by
  Phase 12 (`ProjectGenerationReport.routes`), plus the viewport `profiles` to compare.
- **Runtime**: an injectable server adapter (launch/stop/URL) and an injectable screenshot adapter,
  mirroring the Phase 7/8 seams, so unit tests never launch a real browser or server.

### 7.2 Outputs

- `VisualDiffReport`: `{ ok, partial, width, height, mismatchedPixels, totalPixels, similarityPercent,
  diffPngBytes | null, discrepancies[], skipped[], error? }` — never thrown.
- `DiffDiscrepancy`: `{ kind: 'missing_font'|'layout_shift'|'missing_image'|'pixel_mismatch',
  message, region?: {x,y,width,height}, severity }` — only what the evidence supports.
- A color-coded diff image (red/magenta mismatch over a neutral base) as PNG bytes.
- `diff.*` events (bounded ids/counts/percent only — never image bytes or page text).

### 7.3 Pure core contract

`computeVisualDiff(original, comparison, options) → VisualDiffReport` is **pure and synchronous over
two RGBA buffers**; it is the only place pixels are compared, so it is tested directly with known
mismatch images (RGBA fixtures built in the test, not fetched).

## 8. File / module changes (planned)

| Path | Change |
| :--- | :--- |
| `src/services/diff/visualDiff.ts` | **New.** Pure RGBA decode/compare/core: image decode helpers, `computeVisualDiff`, similarity math, diff-image encode, bounded discrepancy detection. |
| `src/services/diff/png.ts` | **New.** Minimal, dependency-free PNG encode/decode (IHDR/IDAT/CRC32, RGBA8, no interlace) so the engine needs **no runtime dependency** (§17 deviation). |
| `src/services/diff/generatedServer.ts` | **New.** Managed dev-server lifecycle for a generated project (ProcessManager-backed, injectable). |
| `src/services/diff/diffService.ts` | **New.** Orchestrator: capture original + generated at matching viewports, call the core, aggregate, emit `diff.*` events, never throws. |
| `src/services/diff/diffPaths.ts` | **New.** Path safety for generated-server rooting + screenshot temp paths (reuse `serverPathPolicy`). |
| `src/services/diff/index.ts` | **New.** Public surface. |
| `src/services/diff/__tests__/*.test.ts` | **New.** Core, PNG codec, service, security, failure tests. |
| `src/types/visualDiff.ts` | **New.** Public Phase 13 shapes + limits. |
| `src/services/infra/eventBus.ts` | **Additive.** Declare a bounded `diff` domain (`diff.started|captured|computed|completed|failed`) + payloads. |
| `src/stores/diffStore.ts` | **New.** Honest `idle | loading | ready | partial | error` UI state. |
| `src/components/diff/DiffViewer.tsx` | **New.** Side-by-side + slider overlay + color-coded diff + mismatch score + discrepancy inspector; uses existing `Panel`/`Badge`/`Button`/`EmptyState` primitives. |
| `src/components/diff/*.test.tsx` | **New.** Render + interaction tests. |
| `docs/impl-plan/phase-13-impl-plan.md` | This file. |
| `docs/product/PLAN.md`, `CHANGELOG.md`, `docs/README.md`, `docs/architecture/ARCHITECTURE.md`, `docs/architecture/EVENT-SYSTEM.md`, `docs/dev/TESTING.md` | Updated to reflect Phase 13 as built. |

## 9. UI / UX behavior (UI-SPEC §2.7, anti-ui-slop operate playbook)

- **Comparison modes**: (1) side-by-side with synchronized scroll, (2) slider overlay
  (original left / generated right, draggable horizontal split), (3) pixel-diff image.
- **Discrepancy inspector**: match percentage, plus an honest list of missing fonts / layout shifts /
  missing image assets.
- **States**: `idle`, `loading`, `empty` (no capture or no generated project), `ready`, `partial`
  (some viewports failed), `error` — never a fabricated score.
- No new design system: reuse `Panel`, `Badge`, `Button`, `EmptyState`, the existing spacing/typography
  scale, and the app's dark/light tokens. Standard controls, visible focus, responsive reflow.

## 10. Security considerations

- Every generated-server request path is resolved by the pure `resolveServePath` policy: traversal
  (`..`), absolute overrides, NUL bytes, backslashes, and malformed percent-encoding are rejected.
- The generated dev server binds **loopback only** on an ephemeral port; the webview never proxies it.
- Screenshots of generated output are written only beneath the sandboxed `assets/` root via
  `asset_write`; original PNGs are read only from the persisted sandboxed `screenshotPath`.
- The diff engine **never executes generated app code** itself; only the managed dev server (node)
  runs, as an already-allowlisted child process, with no shell string.
- Diff events carry ids/counts/percent only — never image bytes, page text, fonts, or URLs with
  credentials.
- Bounded resource limits (pixel count, image bytes, viewport count) prevent memory/CPU abuse from a
  hostile or malformed capture.

## 11. Error / failure behavior

- A malformed / truncated / unsupported image is a reported `skipped` item, not a crash.
- Missing original screenshot, missing generated project, or server launch failure → `ok: false` with
  a structured `error` and an actionable message; nothing is fabricated.
- A single viewport failing does not fail the run; it is reported and `partial` is set.
- Cancellation returns `aborted: true` with the work completed so far.
- The service never throws past its boundary.

## 12. Test strategy

- **Core (pure)**: identical images ⇒ 100%; single-pixel change ⇒ exact mismatch count; dimension
  mismatch ⇒ error; empty/zero-size ⇒ error; alpha handling; threshold sensitivity; diff-image bytes
  decode back to expected colors.
- **PNG codec**: round-trip encode→decode equality; known small fixture bytes; malformed input
  rejected; non-RGBA / interlaced input rejected.
- **Service**: happy path with injected fakes; partial viewport failure; server-launch failure; abort;
  malformed image; path-safety rejection for a generated-server request.
- **Security**: `resolveServePath` rejection cases re-asserted through the diff path; no escape from
  the generated root.
- **Regression**: the full existing suite must stay green (814 pass baseline), especially Phase 12
  generator safety/limits/failure and Phase 8 server path policy.
- **Integration**: render a real generated fixture project's page to a PNG (in-memory) and assert a
  non-trivial diff versus a synthetic "original" — a real artifact check, not a mocked success path,
  where practical.

## 13. Acceptance criteria

1. `computeVisualDiff` returns an exact mismatch count and similarity percentage for known inputs.
2. A color-coded diff image is produced and decodes to the expected mismatch highlighting.
3. The service launches a managed local server for a generated project, captures matching viewports,
   and returns an honest `VisualDiffReport`.
4. `DiffViewer` renders side-by-side, slider overlay, diff image, mismatch score, and discrepancies.
5. All verification gates pass; Phase 12 behavior and events are unchanged.

## 14. Verification commands

```text
npm run typecheck
npm run lint
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```
Plus the Phase 13 ops-verify script (real generated project → diff → score), if the environment allows.

## 15. Documentation updates

`docs/product/PLAN.md` (Phase 13 → COMPLETE + as-built note), `CHANGELOG.md`, `docs/README.md`,
`docs/architecture/ARCHITECTURE.md` (§3.5/§4 as-built), `docs/architecture/EVENT-SYSTEM.md`
(`diff.*` payloads), `docs/dev/TESTING.md` (Phase 13 tier), this plan.

## 16. Git / commit strategy

One focused commit on `main`:
`feat(diff): add visual verification and diff engine (phase 13)`.
Do not amend Phase 12; do not push.

## 17. Justified deviations from the specification

1. **No `pixelmatch`/`pngjs` runtime dependency.** `PLAN.md` names "Pixelmatch/Playwright screenshot
   diff" as an *example* ("Pixelmatch/…"), and `${user_task}` forbids new runtime dependencies without
   explicit requirement. Phase 13 implements an equivalent, dependency-free pixel comparison + PNG
   codec in `src/services/diff/`, preserving determinism and offline operation. This is a documented
   deviation, not a silent one.
2. **Server process: generalize the Phase 8 worker into a shared entrypoint** rather than adding a
   second near-identical worker. Phase 8 already ships the exact loopback+root-confinement design;
   Phase 13 reuses it for the generated project. If a separate worker proves necessary during
   implementation, it is recorded here.
3. **Original images come from the Phase 7 persisted capture**, not a new live capture, because
   Phase 7 already captured the original at these viewports and re-capturing live pages would add
   network nondeterminism to a verification feature.
4. **Viewport matching by the persisted profile name**; captures are downscaled/padded to a common
   canvas only when dimensions differ, and the mismatch is reported rather than hidden.

*(Any further deviation discovered during implementation is appended here before commit.)*
