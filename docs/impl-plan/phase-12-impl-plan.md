# Phase 12 Implementation Plan — Full-Stack Project Generator (Vite + React + TS + Tailwind)

Source of truth: `docs/product/PLAN.md` (Phase 12). Supporting: `docs/specs/PROJECT-GENERATOR-SPEC.md`
(§1 architecture, §4 code synthesis & file assembly pipeline), `docs/specs/BLUEPRINT-SPEC.md`
(§2.2 pages, §2.3 routes, §2.4 components, §2.8 assets, §2.9 design system),
`docs/architecture/ARCHITECTURE.md` (§2 Layer 3, §3.4 project generator, §4 Rust/TS boundary),
`docs/architecture/EVENT-SYSTEM.md` (`project.*` domain), `docs/architecture/ERROR-HANDLING.md`,
`docs/dev/TESTING.md`, `docs/impl-plan/phase-11-impl-plan.md`, `AGENTS.md`.

> Written after the mandatory audit (task §3) and before implementation (task §5). Where the
> pre-implementation wording of the roadmap and the architecture docs disagree, the hierarchy
> **spec > architecture docs > PRD > roadmap** is applied and any deviation is recorded here and in
> `CHANGELOG.md`.

---

## 1. Audit findings (actual repository state, HEAD `e19ae02`)

- Branch `main`, HEAD `e19ae023c37943c54f8d600e06cb96324f03134c` = Phase 11 commit
  `feat(generator): add AI component extraction and synthesis (phase 11)`; working tree clean.
- **No** `src/templates/project/` directory and **no** `src/services/generator/projectGenerator.ts`
  exist yet. Phase 12 is greenfield at the generator layer.
- Phase 11 delivered, in `src/services/generator/`: `componentSynthesizer.ts`, `componentPayload.ts`,
  `componentSchema.ts`, `jsxCleanliness.ts`, `index.ts`, and tests. It consumes a **validated
  `Blueprint`** (`src/types/blueprint.ts`, `validateBlueprint`) and returns a `ComponentSynthesisResult`
  (`src/types/componentSynth.ts`) with `SynthesizedComponent[]` (`name`, `fileName`, `code`,
  `category`, `variantKeys`, …) + honest `SynthesizedComponentFailure[]`.
- The Blueprint (`src/types/blueprint.ts`) is the sole structured evidence source: `site`, `pages`,
  `routes` (path + `page_id` + auth), `components` (registry), `assets` (images/icons/fonts),
  `design_system` (colors/typography/spacing/radii/shadows), plus optional `provenance`/`confidence`.
- Sandboxed file I/O precedent: Rust commands `asset_write`/`asset_delete` (`src-tauri/src/asset.rs`,
  root `<app_local_data_dir>/assets`) and `clone_write`/`clone_read`/`clone_delete`/`clone_root`
  (`src-tauri/src/clone.rs`, root `<app_local_data_dir>/clones`). Both reject absolute paths and `..`
  components, canonicalize, and are atomic + size-capped. TS wrappers live in `src/services/ipc`.
- The pure path-safety helpers in `src/services/clone/clonePaths.ts` (`isSafeRelativePath`,
  `slugifySegment`, `extensionFromUrl`) and `serverPathPolicy.ts` are the closest existing
  conventions for traversal-safe derivation and must be reused, not reinvented.
- **No** `project.*` event payloads are declared yet in `src/services/infra/eventBus.ts`; the
  taxonomy reserves `project.started | project.file_generated | project.completed` (EVENT-SYSTEM.md
  §"project.*": "Codebase generation, file writing, package installation").
- **No** database table exists for generated projects; Phase 12's acceptance criteria (a buildable
  directory) are satisfied on disk. Persistence is **not** required (see §4.10).
- The app targets React 18 + Vite 5 + Tailwind 3 + TS 5 (`package.json`); the generated project must
  be **independent** of `@tauri-apps/*`, `zustand`, `sql.js`, and ReSite's source tree.

---

## 2. Objective

Assemble a **complete, runnable, standalone** Vite + React + TypeScript + Tailwind project repository
from existing Phase 9/11 artifacts — a validated Blueprint, its extracted design tokens, its routes,
its static assets, and Phase 11 synthesized components — write it, path-safely and deterministically,
beneath a single target root, and prove it builds with a **real** `npm install && npm run build`
producing `dist/`.

Deliverables:

1. A project file-structure generator (`src/services/generator/projectGenerator.ts`).
2. Deterministic boilerplate templates (`src/templates/project/`).
3. Router configuration generated from Blueprint routes.
4. Design-token integration into the generated Tailwind project.
5. Component/hook/asset assembly with path-confinement and resource limits.
6. An end-to-end **real build** test that runs the generated project's own npm build.

---

## 3. Scope

### 3.1 Included (PLAN.md Phase 12)

- Project file structure generator (Vite + React + TS + Tailwind boilerplate).
- Package manifest generation.
- React Router configuration injected from Blueprint routes.
- Design tokens integration (CSS variables + Tailwind theme extension).
- Writing synthesized components, hooks, and static assets into the target project folder.
- Path-safe, bounded, deterministic emission confined to one target root.
- `project.*` event emission (`started`, `file_generated`, `completed`).
- Focused Phase 12 tests **including a real generated-project build test**.

### 3.2 Excluded (must NOT be implemented)

- Visual diff / Pixelmatch / screenshots / similarity / overlay slider (**Phase 13**).
- README/ARCHITECTURE/COMPONENTS doc generation and ZIP export (**Phase 14**).
- OS-keychain/settings hardening (**Phase 15**).
- Re-doing Phase 10 AI engine or Phase 11 synthesis; the generator never calls an AI provider.
- Persisting generated-project metadata in SQLite (not required — see §10).
- A speculative large Phase 12 UI (see §4.11).

### 3.3 Later-phase functionality explicitly deferred

- `npm install` execution by the app runtime (the app generates files; the **test** runs the build).
- Multi-framework adapters (Next.js/Laravel in `PROJECT-GENERATOR-SPEC.md` §2) — Phase 12 targets
  **Vite only**, per `PLAN.md`; the spec's Next.js example is illustrative and explicitly superseded
  for this phase by the roadmap heading.

---

## 4. Design

### 4.1 Input contracts (exact, no invented fields)

`generateProject(deps, input)` consumes:

| Input | Source | Fields actually used |
| --- | --- | --- |
| `blueprint` | Phase 9 `Blueprint` or untrusted JSON | validated with `validateBlueprint` first |
| `components` | Phase 11 `SynthesizedComponent[]` | `name`, `fileName`, `code`, `category`, `variantKeys` |
| `hooks` | optional caller-provided hooks | `name`, `fileName`, `code` (new Phase 12 input shape) |
| `assets` | Blueprint `assets.images[]` + optional bytes | `id`, `local_path`, `mime_type`, `sha256`; bytes supplied via `assets` input |
| `routes` | Blueprint `routes[]` + `pages[]` | `path`, `page_id`, `auth_required`, `redirect_to` |
| `tokens` | Blueprint `design_system` | `colors`, `typography`, `spacing`, `radii`, `shadows` |
| `targetRoot` | caller | absolute directory the project is written beneath |

Fields not present in the Blueprint are simply absent; the generator **never fabricates** tokens,
routes, or components. Component input is the genuine Phase 11 artifact shape; hooks/assets inputs
are new Phase 12 shapes declared in `src/types/projectGen.ts`.

### 4.2 Generated project structure

```
<targetRoot>/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── .gitignore
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── router.tsx            # generated React Router config
│   ├── styles/
│   │   └── index.css         # Tailwind directives + token CSS variables
│   ├── tokens.ts             # design tokens as typed data (Tailwind theme source)
│   ├── lib/
│   │   └── cn.ts             # clsx + tailwind-merge helper (only if a component needs it)
│   ├── components/           # synthesized TSX (Phase 11), sanitized filenames
│   │   └── <Name>.tsx
│   ├── hooks/                # Phase 12 hook inputs
│   │   └── <name>.ts
│   └── pages/                # one page component per Blueprint page
│       └── <Name>Page.tsx
└── public/
    └── assets/               # copied static assets
```

### 4.3 Dependency strategy

Framework versions are pinned to the ReSite stack, **without** ReSite-only dependencies:

- `react` / `react-dom` `^18.3.1` (React 18 — matches the app and the spec's React 18 example; avoids
  React 19 churn not evidenced anywhere in the repo).
- `react-router-dom` `^6.28.0` (matches the app).
- `clsx` `^2.1.1` + `tailwind-merge` `^2.5.5` (needed by the generated `cn` helper).
- devDependencies: `typescript` `^5.7.2`, `vite` `^5.4.11`, `@vitejs/plugin-react` `^4.3.4`,
  `tailwindcss` `^3.4.17`, `postcss` `^8.4.49`, `autoprefixer` `^10.4.20`,
  `@types/react` `^18.3.18`, `@types/react-dom` `^18.3.5`, `@types/node` `^22.10.2`.
- **No** `@tauri-apps/*`, `zustand`, `sql.js`, `playwright`, `zod`, or `lucide-react` — the generated
  app does not need them.
- Tailwind is configured through `tailwind.config.ts` (`content: ['./index.html','./src/**/*.{ts,tsx}']`)
  + `postcss.config.js` + `@tailwind base/components/utilities`.

### 4.4 File generation

- Each logical file is a `GeneratedFile { path (POSIX-relative), contents: string | Uint8Array }`.
- Paths are POSIX-relative; the writer resolves `join(targetRoot, relPath)` and **re-verifies** the
  resolved path stays inside the canonicalized `targetRoot` (prefix check on the canonical root plus a
  component-level reject of `..`, absolute, drive-letter, UNC, and control characters — §4.6).
- Filenames derive from Phase 11 `sanitizeFileName` for components, `slugifySegment` for pages/hooks,
  and `sanitizeAssetPath` for assets.
- Emission is deterministic (stable ordering, sorted JSON keys where the spec has none, `\n` endings).
- Atomic per-file write (temp file + rename in the same directory), matching `asset.rs`/`clone.rs`.
- **No Prettier pass on generated code**: the spec suggests it (`PROJECT-GENERATOR-SPEC.md` §4.2) but
  Phase 11 already emits normalized TSX via `jsxCleanliness`, and adding a Prettier runtime dep is
  unnecessary for Phase 12. This is a documented deviation (§11).

### 4.5 Import resolution

- Generated files use **relative imports only** (`./`, `../`); **no path aliases**, so no
  `vite.resolve.alias`/`tsconfig.paths` resolution can break.
- Component imports are derived from the sanitized filenames actually written (a filename → import
  map), so config imports always point to files that exist.
- Duplicate component names are resolved deterministically: first occurrence keeps the name,
  subsequent collisions get a stable `Name2`, `Name3`, … suffix (recorded in the report).
- Route → page → component references: a route whose `page_id` is missing from `pages` is **dropped
  with a recorded reason** (`route_missing_page`), never silently and never fabricated.
- Asset references in generated CSS/pages point at `public/assets/**`, which Vite serves at
  `/assets/**` — paths that always exist because they were written in the same run.

### 4.6 Build verification

- The critical test (`src/services/generator/__tests__/projectGenerator.build.e2e.test.ts`) generates a
  project into an **isolated temp directory**, then runs the generated project's own
  `npm install` and `npm run build` via `child_process` with `cwd` set to that directory, and asserts
  `dist/` exists and the build exited 0.
- It is **opt-in** through `RUN_PROJECT_BUILD=1` (consistent with the repo's browser-test gating) so
  the default `npm test` never needs the network; it is executed explicitly in this phase and the
  result is reported honestly. If `npm install`/`build` cannot run in the environment, it is reported
  as **BLOCKED**, never as PASS.
- Cleanup removes the temp project unless `KEEP_PROJECT_BUILD=1`.

### 4.7 Security

The generator's threat surface is bounded by:

- **Single target root**: every path resolved and confined to the canonical `targetRoot`.
- Reject in every generated path: absolute paths, Windows drive letters (`C:`/`C:\`), UNC (`\\server`),
  leading `/` or `\`, any `..` component, NUL/control characters, empty segments.
- Reject untrusted asset filenames that fail `isSafeRelativePath`; assets are re-homed under
  `public/assets/` with a sanitized, collision-free basename.
- **Resource limits** (§8): file count, per-file bytes, total bytes, component/asset counts, path depth.
- Generated source is treated as **opaque text/data**: never imported, `eval`'d, required, or executed
  during generation. The build test is the only place generated code runs, in a throwaway sandbox.
- No arbitrary external fetch during assembly; assets are caller-supplied bytes only.

### 4.8 Resource limits (rationale documented)

| Limit | Value | Rationale |
| --- | --- | --- |
| `MAX_PROJECT_FILES` | 2000 | covers Blueprint caps (500 pages/routes/components) + boilerplate with headroom |
| `MAX_PROJECT_FILE_BYTES` | 1 MiB | generated source/tokens are tiny; assets share this cap per file |
| `MAX_PROJECT_TOTAL_BYTES` | 64 MiB | 2× the clone sandbox's 32 MiB single-file cap; a whole generated repo |
| `MAX_PROJECT_COMPONENTS` | 500 | mirrors Blueprint `MAX_COMPONENTS` |
| `MAX_PROJECT_ASSETS` | 500 | mirrors Blueprint `MAX_PAGES` scale |
| `MAX_PROJECT_PATH_DEPTH` | 16 | deeper than any generated path; blocks deep-traversal abuse |

### 4.9 Failure isolation

- Invalid Blueprint → structured `BLUEPRINT_VALIDATION_FAILED`, **no files written**.
- Malformed component (unsafe filename / empty code / over-size) → that component is **skipped** with a
  recorded failure; the project is still written but the report is marked `partial`, and the run never
  claims a clean build when inputs were dropped.
- Unsafe/missing asset bytes → asset skipped and recorded; references to it are not generated.
- `npm install`/build failure → reported as a structured error by the **test** (Phase 12 does not run
  installs in the app).
- Cancellation via `AbortSignal` → stops before/within emission, returns `aborted: true`, and does not
  claim success. On abort the partial directory is left in place only if the caller opted into
  `keepPartial`; otherwise the partially written root is removed.
- Emission is staged: all files are computed and validated **before** any write, so a validation
  failure never leaves a half-written project.

### 4.10 Persistence (database scope)

Not required. `PLAN.md` Phase 12's criterion is a buildable directory on disk; `EVENT-SYSTEM.md`
assigns `project.*` to events, not tables. **No migration, table, or repository is added.** The
generator is a pure service returning a report.

### 4.11 UI scope

`PLAN.md` Phase 12 lists only `src/services/generator/projectGenerator.ts` and `src/templates/project/`;
no UI/route/store is named. Therefore Phase 12 delivers a **service + templates + tests only** — no
dashboard, no diff UI, no export UI.

### 4.12 Generated project independence

The generated project imports **only** React, React Router, and (optionally) `clsx`/`tailwind-merge`.
It contains no ReSite import, no Tauri API, no store, no local database access. This is asserted by a
test that scans every generated source file for forbidden specifiers.

---

## 5. Public API

```ts
export interface ProjectGeneratorDeps {
  events?: ProjectGenerationEventSink;   // defaults to eventBus
}

export interface ProjectGenerationInput {
  blueprint: Blueprint | unknown;        // validated with validateBlueprint
  components: readonly SynthesizedComponent[];
  hooks?: readonly GeneratedHook[];
  assets?: readonly ProjectAssetInput[]; // { id, path, mimeType, bytes? }
  targetRoot: string;                    // absolute sandbox boundary
  projectName?: string;
  maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number;
  signal?: AbortSignal;
  keepPartial?: boolean;
}

export interface ProjectGenerationReport {
  ok: boolean;
  targetRoot: string;
  files: string[];                       // POSIX-relative, written
  routes: GeneratedRoute[];
  droppedRoutes: DroppedRoute[];
  components: { name: string; path: string }[];
  assets: { id: string; path: string }[];
  skipped: ProjectGenerationFailure[];   // honest, non-fatal
  summary: { filesWritten: number; bytesWritten: number; partial: boolean; aborted: boolean };
  error?: StructuredError;               // present only when ok === false
}

export async function generateProject(
  deps: ProjectGeneratorDeps,
  input: ProjectGenerationInput
): Promise<ProjectGenerationReport>;
```

Always resolves (never throws past its boundary); mirrors the Phase 11 service convention.

---

## 6. Events

`project.started` (counts of components/routes/assets), `project.file_generated` (relative path +
bytes, counts only — never file contents), `project.completed` (summary counts). No code or evidence
in payloads, matching the `component.*`/`ai.*` privacy rule.

---

## 7. Tests (focused Phase 12 tier)

- `projectGenerator.structure.test.ts` — expected files/dirs, valid `package.json`, deterministic output.
- `projectGenerator.routes.test.ts` — routes generated from Blueprint; missing page → dropped+reason;
  imports point at real generated files.
- `projectGenerator.tokens.test.ts` — tokens emitted from Blueprint; absent categories not invented;
  observed/inferred preserved where present.
- `projectGenerator.components.test.ts` — synthesized TSX written; valid names; duplicate handling;
  imports resolve to written filenames.
- `projectGenerator.assets.test.ts` — assets copied; references resolve; missing bytes handled honestly.
- `projectGenerator.pathSafety.test.ts` — traversal, absolute, drive-letter, UNC, control-char,
  NUL, and depth-escape attempts rejected; resolved paths cannot escape `targetRoot`.
- `projectGenerator.limits.test.ts` — excessive files / oversized file / excessive total rejected.
- `projectGenerator.failure.test.ts` — malformed component → partial+recorded; invalid Blueprint →
  structured error, nothing written; abort → `aborted:true`, no false success.
- `projectGenerator.build.e2e.test.ts` — real `npm install && npm run build`, assert `dist/` exists.

---

## 8. Acceptance criteria (translated from PLAN.md)

1. A generated project contains a valid `package.json`, Vite/TS/Tailwind config, entry points. ✔ structure test
2. Blueprint routes appear in the generated router; missing references are recorded, never fabricated. ✔ routes test
3. Design tokens from the Blueprint are integrated as Tailwind theme + CSS variables. ✔ tokens test
4. Phase 11 synthesized components are written with safe names and resolving imports. ✔ components test
5. Static assets are written under `public/assets` and referenced. ✔ assets test
6. No generated path escapes the target root. ✔ path-safety test
7. Resource limits are enforced. ✔ limits test
8. Failures are isolated and reported honestly (partial/aborted/structured error). ✔ failure test
9. **The generated project builds cleanly** (`npm install && npm run build`) and produces `dist/`. ✔ build e2e

---

## 9. Verification commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
# Focused Phase 12 suites
npx vitest run src/services/generator/__tests__/projectGenerator
# Real generated-project build (opt-in)
RUN_PROJECT_BUILD=1 npx vitest run src/services/generator/__tests__/projectGenerator.build.e2e.test.ts
```

---

## 10. Documentation updates

- `docs/product/PLAN.md` — mark Phase 12 status + as-built note.
- `CHANGELOG.md` — `[Unreleased]` Phase 12 entry.
- `docs/architecture/ARCHITECTURE.md` — §3.4 as-built note.
- `docs/architecture/EVENT-SYSTEM.md` — `project.*` payloads.
- `docs/dev/TESTING.md` — Phase 12 test tier + build-test gating.
- `docs/README.md` — link this plan.

---

## 11. Documented deviations

1. **Vite only**, not the multi-framework adapter table in `PROJECT-GENERATOR-SPEC.md` §2 — the
   authoritative `PLAN.md` Phase 12 heading scopes Vite + React + TS + Tailwind.
2. **No Prettier formatting pass** (spec §4.2); Phase 11's deterministic `jsxCleanliness` already
   normalizes emitted TSX, and no runtime Prettier dependency is added.
3. **No `build_tmp` atomic-directory rename** (spec §4.3); Phase 12 validates all files up front and
   writes atomically per file within the target root, which is simpler and avoids a second sandbox.
4. **No Next.js `lib/utils.ts` `cn()` unless needed** — emitted only when a component actually imports it.
