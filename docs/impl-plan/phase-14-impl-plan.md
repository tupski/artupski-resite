# Phase 14 Implementation Plan — Project Documentation & Export Engine

Source of truth: `docs/product/PLAN.md` (Phase 14 §507-518). Supporting:
`docs/specs/PROJECT-GENERATOR-SPEC.md` §3 (documentation manifest),
`docs/specs/CLONE-SPEC.md` §6.2 (ZIP archiver),
`docs/design/UI-SPEC.md` §2.9 (Project Documentation & Export Screen),
`docs/architecture/ARCHITECTURE.md`, `docs/architecture/EVENT-SYSTEM.md`,
`docs/architecture/ERROR-HANDLING.md`, `docs/architecture/DATABASE.md` §6,
`docs/dev/TESTING.md`, `docs/impl-plan/phase-12-impl-plan.md`,
`docs/impl-plan/phase-13-impl-plan.md`, `AGENTS.md` §6/§9.

> Written after the mandatory audit and before implementation. Where the pre-implementation
> roadmap wording and the architecture/spec docs disagree, the hierarchy
> **PLAN.md (authoritative, newest) > spec > architecture docs > PRD** is applied and any
> deviation is recorded in §18 here and in `CHANGELOG.md`.

---

## 1. Phase identification

**Phase 14 — Project Documentation & Export Engine.**

## 2. Objective

Given a completed Phase 12 generated project (a `ProjectGenerationReport` + the files it wrote
beneath a target root), Phase 14:

1. auto-generates a small, honest **Markdown documentation set** describing the project's
   architecture, route structure, and components (`README.md`, `ARCHITECTURE.md`,
   `COMPONENTS.md`), derived entirely from the Phase 12 report and caller-supplied request metadata
   (nothing is invented); and
2. **bundles the project** into a standalone, deterministic **ZIP archive** — or copies it to a
   selected local **folder** — such that the archive unpacks cleanly and contains the complete
   source code plus the generated docs.

It is a **service-layer + tests** increment. Per the Phase 12 precedent
(`docs/impl-plan/phase-12-impl-plan.md:253`) and the Phase 13 deferral
(`docs/impl-plan/phase-13-impl-plan.md:70-71`), Phase 14 delivers a **service + templates + tests
only — no dashboard, no diff UI, no export UI, no route, no store, no Rust command, and no new
runtime dependency.**

## 3. Audit findings (actual repository state)

- Branch `main`, HEAD `4d1869b` = Phase 13 commit
  `feat(diff): add visual verification and diff engine (phase 13)`; previous `8162cf1` (Phase 12),
  `e19ae02` (Phase 11); working tree clean; 3 commits ahead of `origin`.
- Baseline verification gates are green: `npm run typecheck` PASS, `npm run lint` PASS,
  `npm run test` PASS (**865 passed / 24 skipped (889)**, 91 files passed / 9 files skipped),
  `cargo check` PASS, `cargo clippy --all-targets` PASS. `npm run format:check` is pre-existing RED
  across 106 files and is **not** in the DoD. `npm run build` was **not** re-run during this audit
  and must be run during implementation (see §15).
- **Phase 12** delivered `generateProject(deps, input)` in
  `src/services/generator/projectGenerator.ts`, returning a `ProjectGenerationReport`
  (`src/types/projectGen.ts`) whose `files: string[]` are the POSIX-relative paths actually written
  beneath `targetRoot`, plus `routes`, `components`, `assets`, `skipped`, and `summary`.
- The path-safety utilities live in `src/services/generator/projectPaths.ts` and are re-exported
  from the generator barrel `src/services/generator/index.ts`:
  `isSafeProjectRelativePath(path): boolean` (`projectPaths.ts:34`),
  `pathDepth(path): number` (`projectPaths.ts:53`),
  `resolveWithinRoot(targetRoot, relative): string | null` (`projectPaths.ts:174`).
- The generator's dependency-injection seam is `ProjectGeneratorDeps { events?: ProjectGenerationEventSink }`
  (`projectGenerator.ts:72-75`) with `ProjectGenerationEventSink { emit(event: AppEvent): void }`
  (`projectGenerator.ts:68-70`); failures are represented as `ProjectGenerationFailure`
  (`src/types/projectGen.ts:142-151`) and never thrown past the boundary.
- Errors are centralized in `src/services/infra/errors.ts`: `ErrorCategory`
  (`errors.ts:11-21`), `ErrorCode` union (`errors.ts:24-63`), `StructuredError`
  (`errors.ts:65-78`), `createStructuredError` (`errors.ts:95-116`). New export codes are appended
  to the `ErrorCode` union; no category is added (reuse `io`/`validation`).
- Events are centralized in `src/services/infra/eventBus.ts`: `EventDomain` (`eventBus.ts:11-26`),
  `AppEventType` (`eventBus.ts:29-104`), per-domain payload interfaces, `AppEventPayloadMap`
  (`eventBus.ts:619-694`), `createEvent` (`eventBus.ts:724-738`), and the `eventBus` singleton
  (`eventBus.ts:814`). **No `export` domain is declared yet.**
- `src/services/diff/png.ts` provides a reusable convention for a self-contained CRC-32 with the
  IEEE polynomial `0xEDB88320` (`png.ts:32-50`) and byte-level, dependency-free codecs. Phase 14
  reuses the *convention* (its own CRC table in `zip.ts`), not the code.
- **No** `src/services/exporter/` module, **no** `src/types/export.ts`, and **no** `export.*` event
  type exists yet (verified: no matches for `exporter|ExportProject|docGenerator|zipExporter`).
  Phase 14 is greenfield at the exporter layer.
- `src/services/ipc/commands.ts` / `index.ts` expose no export command and none is needed
  (§5, §9): Phase 14 injects a filesystem seam and defers production wiring.

**Risks / open questions (unverifiable assumptions, stated not guessed):**

1. `npm run build` (Vite frontend) was not re-run during the audit; it is assumed PASS based on the
   Phase 13 record but must be confirmed during implementation (§15).
2. The git baseline above is taken from the task brief; it is assumed accurate and is not
   re-derived here (a fresh `git log` should be run at implementation start).
3. Production wiring of the export service (which concrete reader/writer to use in the Tauri shell,
   and where the destination root lives) is **deferred** — see §5 and §18. No IPC command is
   planned, so the default (no injected deps) resolves to a **not-available** structured error,
   mirroring `runVisualDiff`'s `DIFF_SERVER_UNAVAILABLE` pattern.

## 4. Exact Phase 14 scope (from `PLAN.md` §507-518)

Authoritative PLAN text (verbatim):

- **Goal**: "Auto-generate comprehensive documentation for generated projects and export archives."
- **Scope**: "Markdown generator (`README.md`, `ARCHITECTURE.md`, `COMPONENTS.md`), ZIP export bundler."
- **Dependencies**: "Phase 12."
- **Files/Modules Affected**: "`src/services/exporter/docGenerator.ts`, `src/services/exporter/zipExporter.ts`."
- **Tasks**: (1) "Generate project-specific documentation detailing architecture, route structure,
  and components." (2) "Bundle project into standalone ZIP archive or export to selected local folder."
- **Tests**: "ZIP integrity and documentation markdown syntax tests."
- **Acceptance Criteria**: "Exported archive unpacks cleanly and contains complete source code and docs."
- **Potential Risks**: "Large asset directories causing zip memory bloat."
- **Verification**: "Export project to ZIP, unzip, verify presence of README and all source files."

Scope decisions already made (state as decisions; validated against code in §6, not re-litigated):

1. **Service + tests only.** PLAN lists only two service files; Phase 12 set the service-only
   precedent. No UI, no route, no nav, no store, no Rust command, no new runtime dependency.
   UI-SPEC §2.9's export screen is **not** implemented in Phase 14 (recorded as a deviation in §18).
2. **Doc set = exactly `README.md`, `ARCHITECTURE.md`, `COMPONENTS.md`.** PLAN wins over
   PROJECT-GENERATOR-SPEC §3.1's 11-file manifest and DATABASE.md §6's `COMPONENT-TREE.md`
   (both recorded in §18).
3. **ZIP implemented in pure TypeScript, zero dependencies.** No JS zip package, no Rust `zip`
   crate, no Tauri command. Reuse the Phase 12 dependency-injection style so filesystem access is
   injected (Node `fs` in tests, sandboxed IPC later). Production wiring is deferred and the
   injected reader/writer is the seam that satisfies `AGENTS.md:80` ("Assert canonical sandbox path
   on all asset and code generation file write operations").
4. **Deterministic ZIP**: entries sorted by path; fixed DOS timestamp (1980-01-01 00:00:00 →
   DOS date `0x0021`, time `0x0000`); UTF-8 name flag bit 11 (`0x0800`); stable compression policy.
5. **Explicit resource limits** addressing the PLAN risk note: cap entry count, per-entry bytes, and
   total uncompressed bytes; reject with an actionable error rather than truncating (no silent data
   loss). Constants in `src/types/export.ts`.
6. **Path confinement**: every archive entry path and every read/write target validated with the
   Phase 12 utilities (`isSafeProjectRelativePath`, `resolveWithinRoot`, `pathDepth`) — reject
   absolute paths, `..`, backslashes, drive letters, NUL, over-depth, and duplicate/case-colliding
   entries.
7. **`mode: 'zip' | 'folder'`** on the export request satisfies "standalone ZIP archive **or**
   export to selected local folder" (both, deterministically).

## 5. Explicit exclusions

- **No UI.** No export screen, no documentation previewer, no component, no store, no route, no nav
  entry. UI-SPEC §2.9 is deferred (deviation C5, §18).
- **No Rust.** No `src-tauri/src/export.rs`, no `zip` crate, no new Tauri command, no capability
  change, no `Cargo.toml` change. `WORKER_PROTOCOL_VERSION` stays `1`; no new worker.
- **No new runtime dependency.** No `jszip`/`adm-zip`/`archiver`/`yazl`/`fflate`/`pako`. ZIP is
  authored in-repo (§7.5).
- **No new IPC command / production wiring.** The export service takes injected reader/writer deps;
  with none supplied it returns an actionable "not available" structured error. Wiring the
  sandboxed reader/writer is deferred to a later phase.
- **No database table, no migration.** Export is stateless (§8).
- **No Phase 8 clone ZIP.** CLONE-SPEC §6.2's Rust `zip`-crate archiver for the *static clone*
  remains deferred; Phase 14's ZIP is a TypeScript service for the *generated project*. Recorded as
  deviation in §18.
- No change to Phase 12 `generateProject` behavior, its types, or its events.

## 6. Existing architecture / modules to reuse (do not duplicate)

| Need | Reuse (exact symbol + `path:line`) |
| :--- | :--- |
| Generated file list + metadata | `ProjectGenerationReport` (`src/types/projectGen.ts:167`); `report.files`, `report.routes`, `report.components`, `report.assets`, `report.summary` |
| Per-item failure shape | `ProjectGenerationFailure` (`src/types/projectGen.ts:142`) — mirror its `{ kind, id, code, message }` honesty |
| Route metadata for docs | `GeneratedRoute` (`src/types/projectGen.ts:121`); `DroppedRoute` (`src/types/projectGen.ts:135`) |
| Path safety | `isSafeProjectRelativePath` (`src/services/generator/projectPaths.ts:34`), `resolveWithinRoot` (`projectPaths.ts:174`), `pathDepth` (`projectPaths.ts:53`) — re-exported from `src/services/generator/index.ts` |
| Depth cap constant | `MAX_PROJECT_PATH_DEPTH` (`src/types/projectGen.ts:33`) |
| DI seam + event sink pattern | `ProjectGeneratorDeps` (`projectGenerator.ts:72`), `ProjectGenerationEventSink` (`projectGenerator.ts:68`) |
| Atomic write pattern | `writeAtomic` convention (`projectGenerator.ts:727-731`) — mirror (temp + rename) in the injected writer |
| Event construction | `createEvent` (`eventBus.ts:724`), `eventBus` (`eventBus.ts:814`), `BaseEventPayload` (`eventBus.ts:107`) |
| Structured errors | `ErrorCode`/`ErrorCategory`/`StructuredError`/`createStructuredError` (`src/services/infra/errors.ts:24,11,65,95`) |
| CRC-32 + byte-codec conventions | `src/services/diff/png.ts:32-50` (IEEE `0xEDB88320`), module doc-header + typed-error style (`png.ts:1-26`) |
| Test conventions | temp-dir helpers + `afterEach` cleanup (`projectGenerator.test.ts:17-27`); opt-in gate `RUN_PROJECT_BUILD` (`projectGenerator.build.e2e.test.ts:32`) |
| Fixtures | `phase12Blueprint`, `synthesizedComponent`, `heroComponent`, `counterHook`, `logoAsset` (`src/services/generator/__tests__/projectFixtures.ts`) |

## 7. Data / input / output contracts

All shapes are implementation-ready TypeScript and live in `src/types/export.ts` unless noted.

### 7.0 Resource-limit constants (`src/types/export.ts`)

```ts
/** Hard cap on archive/folder entries (source files + generated docs). */
export const MAX_EXPORT_ENTRIES = 2100;
/** Hard cap on a single entry's uncompressed bytes (1 MiB). */
export const MAX_EXPORT_ENTRY_BYTES = 1024 * 1024;
/** Hard cap on total uncompressed bytes across the export (64 MiB). */
export const MAX_EXPORT_TOTAL_BYTES = 64 * 1024 * 1024;
/** Hard cap on any entry path's segment depth (mirrors MAX_PROJECT_PATH_DEPTH). */
export const MAX_EXPORT_PATH_DEPTH = 16;
/** Hard cap on a single generated Markdown document (1 MiB). */
export const MAX_EXPORT_DOC_BYTES = 1024 * 1024;
```

Rationale: Phase 12 caps a generated project at `MAX_PROJECT_FILES = 2000` and
`MAX_PROJECT_TOTAL_BYTES = 64 MiB` (`src/types/projectGen.ts:23,27`). `MAX_EXPORT_ENTRIES = 2100`
allows the Phase 12 file ceiling plus the three generated docs (with headroom) so a valid Phase 12
project is never rejected, while still bounding entry count. The per-entry and total byte caps
mirror the Phase 12 file/total caps so the export cannot inflate past what generation allowed. The
depth cap mirrors `MAX_PROJECT_PATH_DEPTH = 16` (`src/types/projectGen.ts:33`). These limits are the
concrete mitigation for the PLAN risk note ("large asset directories causing zip memory bloat"):
they reject with an actionable error rather than truncating (no silent data loss).

### 7.1 Documentation generation

```ts
/** Exactly the three PLAN-mandated documents. */
export type GeneratedDocName = 'README.md' | 'ARCHITECTURE.md' | 'COMPONENTS.md';

/** Caller-supplied metadata used to title and describe the generated docs. */
export interface DocGenerationInput {
  /** Sanitized project name (from Phase 12 options / package.json). */
  readonly projectName: string;
  /** Target framework label, e.g. `Vite + React + TypeScript + Tailwind`. */
  readonly targetFramework: string;
  /** Original source site URL, when known (documented, never fetched). */
  readonly targetUrl?: string;
  /** Optional one-line project description. */
  readonly description?: string;
  /** The Phase 12 result the docs are derived from. */
  readonly report: ProjectGenerationReport;
}

/** One generated Markdown document. */
export interface GeneratedDoc {
  readonly name: GeneratedDocName;
  readonly contents: string;
  /** UTF-8 byte length of `contents`. */
  readonly bytes: number;
}

/** Result of doc generation. Always returned; never thrown. */
export interface DocGenerationResult {
  readonly ok: boolean;
  readonly docs: GeneratedDoc[];
  /** Per-document failures (e.g. a doc exceeding `MAX_EXPORT_DOC_BYTES`). */
  readonly skipped: ExportFailure[];
  /** Present only when `ok === false`. */
  readonly error?: ExportFailure;
}
```

### 7.2 Export request / options

```ts
export type ExportMode = 'zip' | 'folder';

/** Deterministic ZIP compression policy. Default `'store'`. */
export type ZipCompressionMethod = 'store' | 'deflate';

export interface ExportOptions {
  /** Override `MAX_EXPORT_ENTRIES` (default constant). */
  readonly maxEntries?: number;
  /** Override `MAX_EXPORT_ENTRY_BYTES` (default constant). */
  readonly maxEntryBytes?: number;
  /** Override `MAX_EXPORT_TOTAL_BYTES` (default constant). */
  readonly maxTotalBytes?: number;
  /** ZIP compression policy; default `'store'` (byte-deterministic). */
  readonly compression?: ZipCompressionMethod;
  /**
   * Folder mode only: the subdirectory name beneath `destinationRoot`.
   * Defaults to a slugified `projectName`. Ignored for `mode: 'zip'`.
   */
  readonly folderName?: string;
  /** ZIP mode only: archive file name; defaults to `<slug(projectName)>.zip`. */
  readonly archiveName?: string;
}

export interface ExportProjectRequest {
  /** The absolute Phase 12 target root the generated files were written beneath. */
  readonly projectRoot: string;
  /** The Phase 12 report whose `files` list is exported. */
  readonly report: ProjectGenerationReport;
  /** Sanitized project name (doc titles + default artifact name). */
  readonly projectName: string;
  /** Target framework label for the docs. */
  readonly targetFramework: string;
  readonly targetUrl?: string;
  readonly description?: string;
  /** `'zip'` → single archive; `'folder'` → copied tree. */
  readonly mode: ExportMode;
  /** The absolute destination root (sandbox boundary for the written artifact). */
  readonly destinationRoot: string;
  readonly options?: ExportOptions;
}
```

### 7.3 Export result

```ts
/** An honest, non-fatal export item failure. */
export interface ExportFailure {
  readonly kind: 'file' | 'doc' | 'archive' | 'limit' | 'path';
  /** The offending path / document name / code the failure traces to. */
  readonly id: string;
  /** Fine-grained, actionable code (e.g. `EXPORT_PATH_UNSAFE`). */
  readonly code: string;
  /** Bounded, actionable message; never file contents. */
  readonly message: string;
}

export interface ExportSummary {
  readonly entryCount: number;
  readonly uncompressedBytes: number;
  readonly compressedBytes: number;
  readonly docCount: number;
  /** True when any file was skipped or any doc failed. */
  readonly partial: boolean;
}

/** The aggregate result of an export run. Always returned; never thrown. */
export interface ExportProjectReport {
  readonly ok: boolean;
  readonly mode: ExportMode;
  /** The destination root the artifact was (or would be) written beneath. */
  readonly destinationRoot: string;
  /** Destination-relative path of the produced artifact (archive file or folder). */
  readonly artifactPath: string;
  /** Metadata for every archive entry (also populated for folder mode). */
  readonly entries: ZipEntryMeta[];
  readonly docs: GeneratedDoc[];
  readonly skipped: ExportFailure[];
  readonly summary: ExportSummary;
  /** True when the caller's abort signal ended the run. */
  readonly aborted: boolean;
  /** Present only when `ok === false` (validation, limit, io, unavailable deps). */
  readonly error?: ExportFailure;
}
```

### 7.4 ZIP entry metadata

```ts
/** Metadata for one ZIP entry (also the integrity-verification record). */
export interface ZipEntryMeta {
  /** POSIX-relative entry path, `/`-separated, confined to the archive root. */
  readonly path: string;
  /** CRC-32 (IEEE `0xEDB88320`) of the uncompressed bytes. */
  readonly crc32: number;
  /** Size of the stored (possibly compressed) bytes in the archive. */
  readonly compressedSize: number;
  /** Size of the original bytes. */
  readonly uncompressedSize: number;
  /** Stored method used for this entry. */
  readonly method: ZipCompressionMethod;
}
```

### 7.5 ZIP format (concrete)

**CRC-32.** IEEE polynomial `0xEDB88320`, initial value `0xFFFFFFFF`, final XOR `0xFFFFFFFF`,
table built once (`Uint32Array(256)`), identical to the convention in `src/services/diff/png.ts:32-50`.

**Constants (`src/services/exporter/zip.ts`):**

```ts
export const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
export const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
export const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
export const ZIP_VERSION_NEEDED = 20;        // 2.0: supports deflate + directory entries
export const ZIP_VERSION_MADE_BY = 20;
export const ZIP_FLAG_UTF8 = 0x0800;         // general-purpose bit 11 (UTF-8 file names)
export const ZIP_DOS_TIME_MIDNIGHT = 0x0000; // fixed 00:00:00
export const ZIP_DOS_DATE_1980_01_01 = 0x0021; // (year-1980)<<9 | month<<5 | day = 33
export const ZIP_METHOD_STORE = 0;
export const ZIP_METHOD_DEFLATE = 8;
```

**Local file header (30-byte fixed + name):** offset 0 `0x04034b50`; 4 `versionNeeded` (2); 6
`flags` (2, `0x0800`); 8 `method` (2); 10 `time` (2, `0x0000`); 12 `date` (2, `0x0021`); 14 `crc32`
(4); 18 `compressedSize` (4); 22 `uncompressedSize` (4); 26 `nameLength` (2); 28 `extraLength` (2,
`0`); 30 file name (UTF-8).

**Central directory record (46-byte fixed + name):** offset 0 `0x02014b50`; 4 `versionMadeBy` (2);
6 `versionNeeded` (2); 8 `flags` (2); 10 `method` (2); 12 `time` (2); 14 `date` (2); 16 `crc32` (4);
20 `compressedSize` (4); 24 `uncompressedSize` (4); 28 `nameLength` (2); 30 `extraLength` (2, `0`);
32 `commentLength` (2, `0`); 34 `diskNumberStart` (2, `0`); 36 `internalAttributes` (2, `0`); 38
`externalAttributes` (4, `0`); 42 `localHeaderOffset` (4); 46 file name (UTF-8).

**End of central directory (EOCD, 22 bytes):** offset 0 `0x06054b50`; 4 `diskNumber` (2, `0`); 6
`diskWithCentralDirectory` (2, `0`); 8 `entriesOnDisk` (2); 10 `totalEntries` (2); 12
`centralDirectorySize` (4); 16 `centralDirectoryOffset` (4); 20 `commentLength` (2, `0`).

**Determinism guarantees:** entries are sorted by their UTF-8 path (byte-wise ascending); every
entry uses the fixed timestamp above; the UTF-8 flag is always set; the compression policy is
`'store'` by default, so byte output is identical across runs and environments. When
`options.compression === 'deflate'`, `CompressionStream('deflate-raw')` is used when available and
the result is accepted **only** if it is strictly smaller than the stored bytes; otherwise the entry
falls back to store. Deflate is explicitly opt-in precisely because its availability/ratio can vary
by environment; the default store policy is what tests assert byte-for-byte.

**Minimal reader (integrity verification).** `zip.ts` also exposes a reader used by tests (and
callable by future consumers):

```ts
export interface ZipArchive {
  readonly entries: ZipEntryMeta[];
  /** Uncompressed bytes per entry path. */
  readonly data: Map<string, Uint8Array>;
}

/** Parse and verify a ZIP produced by `buildZip`; throws `ZipError` on corruption. */
export function readZip(bytes: Uint8Array): ZipArchive;

/** Low-level writer: sorted, deterministic archive from path→bytes. */
export function buildZip(
  files: ReadonlyMap<string, Uint8Array>,
  options?: { compression?: ZipCompressionMethod }
): { bytes: Uint8Array; entries: ZipEntryMeta[] };

export class ZipError extends Error {}
```

### 7.6 Error codes (`src/services/infra/errors.ts`, appended to `ErrorCode`)

```ts
| 'EXPORT_VALIDATION_FAILED'
| 'EXPORT_LIMIT_EXCEEDED'
| 'EXPORT_READ_FAILED'
| 'EXPORT_WRITE_FAILED'
| 'EXPORT_DOC_GENERATION_FAILED'
```

No new `ErrorCategory` is added: validation failures use `'validation'`, io failures use `'io'`.
Fine-grained `ExportFailure.code` strings (not part of `ErrorCode`) include:
`EXPORT_NO_FILES`, `EXPORT_PATH_UNSAFE`, `EXPORT_DUPLICATE_ENTRY`, `EXPORT_ENTRY_LIMIT_EXCEEDED`,
`EXPORT_ENTRY_SIZE_LIMIT_EXCEEDED`, `EXPORT_TOTAL_SIZE_LIMIT_EXCEEDED`,
`EXPORT_DOC_TOO_LARGE`, `EXPORT_READ_FAILED`, `EXPORT_ARCHIVE_WRITE_FAILED`,
`EXPORT_FOLDER_WRITE_FAILED`, `EXPORT_UNAVAILABLE`, `USER_CANCELLED`.

### 7.7 Event additions (`src/services/infra/eventBus.ts`)

`EventDomain` gains `'export'`. `AppEventType` gains five keys; payloads:

```ts
export interface ExportStartedPayload extends BaseEventPayload {
  domain: 'export';
  mode: 'zip' | 'folder';
  /** Number of files the run intends to export (after doc merge). */
  files: number;
}

export interface ExportDocGeneratedPayload extends BaseEventPayload {
  domain: 'export';
  /** Document name, e.g. `README.md`. */
  name: string;
  /** UTF-8 byte length of the document (never its contents). */
  bytes: number;
}

export interface ExportEntryWrittenPayload extends BaseEventPayload {
  domain: 'export';
  /** POSIX-relative archive entry path (never absolute). */
  path: string;
  /** Bounded byte size of the entry. */
  bytes: number;
}

export interface ExportCompletedPayload extends BaseEventPayload {
  domain: 'export';
  mode: 'zip' | 'folder';
  entries: number;
  bytes: number;
  partial: boolean;
}

export interface ExportFailedPayload extends BaseEventPayload {
  domain: 'export';
  code: string;
  message: string;
}
```

`AppEventPayloadMap` gains:

```ts
'export.started': ExportStartedPayload;
'export.doc_generated': ExportDocGeneratedPayload;
'export.entry_written': ExportEntryWrittenPayload;
'export.completed': ExportCompletedPayload;
'export.failed': ExportFailedPayload;
```

### 7.8 Service + DI seam (`src/services/exporter/zipExporter.ts`)

```ts
/** Reads generated-project files; Node `fs` in tests, sandboxed IPC later. */
export interface ExportFileReader {
  /** List POSIX-relative paths under the project root. */
  list(root: string): Promise<string[]>;
  /** Read one file's bytes, or `null` when absent/unreadable. */
  read(root: string, relativePath: string): Promise<Uint8Array | null>;
}

/** Writes the artifact; Node `fs` in tests, sandboxed IPC later. */
export interface ExportFileWriter {
  /** Write bytes atomically (temp + rename), creating parent dirs. */
  write(root: string, relativePath: string, data: Uint8Array): Promise<void>;
  /** Ensure a directory exists beneath `root`. */
  mkdir(root: string, relativePath: string): Promise<void>;
  /** Remove a path (used for cleanup on abort/failure). */
  remove(root: string, relativePath: string): Promise<void>;
}

export interface ExportProjectDeps {
  readonly reader?: ExportFileReader;
  readonly writer?: ExportFileWriter;
  readonly events?: ProjectGenerationEventSink; // reuse the Phase 12 sink shape
  readonly signal?: AbortSignal;
}

export async function exportProject(
  deps: ExportProjectDeps,
  request: ExportProjectRequest
): Promise<ExportProjectReport>;
```

`docGenerator.ts` exports:

```ts
export function generateDocs(input: DocGenerationInput): DocGenerationResult;
```

### 7.9 Markdown document structure (emitted by `docGenerator.ts`)

**`README.md`** — derived from request metadata + `report`:

```
# <projectName>
> <description>                      (omitted when absent)
## Overview                          (projectName, targetFramework, targetUrl when known)
## Getting Started
### Prerequisites                    (Node/npm; framework label)
### Install                          (`npm install`)
### Scripts                          (from report.files presence: dev/build/preview)
## Project Structure                  (grouped from report.files top-level dirs)
## Routes                             (table: Path | Component | File | Auth | Index)
## Components                         (table: Name | Path)   (omitted when none)
## Design Tokens                      (note: from Blueprint, no fabrication)
## Generated by Artupski ReSite
```

**`ARCHITECTURE.md`**:

```
# Architecture — <projectName>
## Overview                          (targetFramework, targetUrl when known)
## Technology Stack                  (Vite + React + TS + Tailwind; from targetFramework)
## Directory Layout                  (tree from report.files)
## Routing                           (report.routes; dropped routes noted honestly, if any)
## Components                        (counts + paths from report.components)
## Assets                            (report.assets; ids + paths)
## Build Pipeline                    (`npm run build` → `dist/`; note it is the project's own step)
```

**`COMPONENTS.md`**:

```
# Components — <projectName>
## Summary                           (component/page/asset counts from report.summary)
## Components                        (table: Name | Path)
## Pages                             (report.routes → component + file)
## Hooks                             (report.files under `src/hooks/`, when present)
## Assets                            (report.assets)
## Conventions                       (PascalCase components, one component per file)
```

Rules: only report/request data is used; absent sections are omitted (never fabricated); every
generated doc must be valid, balanced Markdown (headings, fenced blocks, tables with a header
separator row) and is refused if it exceeds `MAX_EXPORT_DOC_BYTES`.

## 8. Data structures and persistence implications

**None.** Phase 14 adds no database table, no column, no migration, and no persisted row. The
exporter is a pure function over its inputs plus the injected reader/writer; the generated artifact
lives in the destination root chosen by the caller. `DATABASE.md` §6 is updated only to record the
as-built deviation (docs are `README.md`/`ARCHITECTURE.md`/`COMPONENTS.md`, not
`COMPONENT-TREE.md`) and to note export is stateless.

## 9. File and module changes

| Path | Change | Purpose |
| :--- | :--- | :--- |
| `src/services/exporter/docGenerator.ts` | **New** | Generate the three Markdown documents from `DocGenerationInput` (pure, deterministic, no I/O). |
| `src/services/exporter/zip.ts` | **New** | Low-level CRC-32 + deterministic ZIP writer (`buildZip`) + minimal reader (`readZip`) for integrity verification; `ZipError`. |
| `src/services/exporter/zipExporter.ts` | **New** | High-level orchestrator: collect files via injected deps, generate docs, build archive / copy folder, enforce limits, emit `export.*` events, never throw. |
| `src/services/exporter/index.ts` | **New** | Barrel: re-export the public surface (mirrors `src/services/diff/index.ts`). |
| `src/types/export.ts` | **New** | Public Phase 14 types + `MAX_EXPORT_*` limits + ZIP method type. |
| `src/services/infra/errors.ts` | **Changed** | Append five `EXPORT_*` members to the `ErrorCode` union. |
| `src/services/infra/eventBus.ts` | **Changed** | Add the `'export'` `EventDomain`, five `AppEventType` keys, five payload interfaces, and five `AppEventPayloadMap` entries. |
| `src/services/exporter/__tests__/exportFixtures.ts` | **New** | Deterministic fixtures (reuse Phase 12 `projectFixtures`, add a `ProjectGenerationReport` builder). |
| `src/services/exporter/__tests__/docGenerator.test.ts` | **New** | Doc structure + Markdown syntax validation + no-fabrication + size cap. |
| `src/services/exporter/__tests__/zip.test.ts` | **New** | CRC-32 vectors, header layout, round-trip via `readZip`, determinism, corruption rejection. |
| `src/services/exporter/__tests__/zipExporter.test.ts` | **New** | Orchestration: zip + folder modes, limits, path traversal, duplicate entries, failure isolation, abort, events, unavailable-deps. |
| `src/services/exporter/__tests__/zipExporter.e2e.test.ts` | **New (opt-in)** | Real `generateProject` → real archive → real unzip/verify (gate `RUN_EXPORT_E2E=1`). |
| `docs/product/PLAN.md` | **Changed** | Mark Phase 14 COMPLETE with an as-built note. |
| `CHANGELOG.md` | **Changed** | Add a Phase 14 `[Unreleased]` entry. |
| `docs/README.md` | **Changed** | Index the exporter module. |
| `docs/architecture/ARCHITECTURE.md` | **Changed** | Record the exporter service layer. |
| `docs/architecture/EVENT-SYSTEM.md` | **Changed** | Document `export.*` payloads. |
| `docs/architecture/ERROR-HANDLING.md` | **Changed** | Add the `EXPORT_*` taxonomy rows. |
| `docs/architecture/DATABASE.md` | **Changed (if needed)** | Note export is stateless + doc-set deviation. |
| `docs/dev/TESTING.md` | **Changed** | Add the Phase 14 test tier. |
| `docs/impl-plan/phase-14-impl-plan.md` | This file. | — |

## 10. UI / UX behavior

**None.** Phase 14 ships no UI. UI-SPEC §2.9's "Project Documentation & Export Screen"
(documentation previewer, "Bundle Project as ZIP Archive", "Open Output Directory in File Manager")
is **not** implemented; it is recorded as deviation C5 in §18, resolved by PLAN authority (PLAN
§507-518 lists only the two service files). No store, component, route, or nav entry is added, so
the anti-ui-slop playbook does not apply to this phase.

## 11. Security boundaries

- **Path confinement (entries).** Every entry path is validated with
  `isSafeProjectRelativePath` (`projectPaths.ts:34`) and depth-bounded with `pathDepth`
  (`projectPaths.ts:53`) ≤ `MAX_EXPORT_PATH_DEPTH`. Absolute paths, `..`, `.`, empty segments,
  backslashes, Windows drive prefixes, UNC paths, and control/NUL characters are rejected.
- **Path confinement (reads).** Each source path from `report.files` is resolved with
  `resolveWithinRoot(projectRoot, path)` (`projectPaths.ts:174`); a `null` resolution fails that
  file honestly (never reads outside the root).
- **Path confinement (writes).** ZIP mode writes only `<destinationRoot>/<archiveName>.zip`; folder
  mode writes only `<destinationRoot>/<folderName>/<entryPath>`, each resolved with
  `resolveWithinRoot` and rejected when unsafe. `archiveName`/`folderName` must be a single safe
  segment (slugified when absent).
- **No arbitrary destination writes.** A caller-supplied `destinationRoot` is the sandbox boundary;
  the service never writes outside it, and it never trusts a caller-supplied absolute entry path.
- **No extension-based trust.** File type is irrelevant to safety; every path is validated by the
  rules above regardless of extension, and content is treated as opaque bytes.
- **Limits as a DoS guard.** Entry count, per-entry bytes, and total uncompressed bytes are enforced
  before/while building the archive, so a hostile or bloated input is rejected with an actionable
  error rather than exhausting memory (the PLAN risk note).
- **No secret emission.** Events carry paths, counts, and byte sizes only — never file contents.
- **Sandbox seam.** The injected `ExportFileReader`/`ExportFileWriter` is the point at which the
  Tauri shell must assert the canonical sandbox path (`AGENTS.md:80`); with no deps supplied the
  service refuses to run (`EXPORT_UNAVAILABLE`), so no unconfined write is ever possible by default.

## 12. Error and failure handling

- **Partial failure isolation.** A file that cannot be read is recorded in `skipped` with an
  actionable `ExportFailure` and the run continues; `summary.partial` is set. A failed doc is
  likewise recorded and does not abort the run.
- **No silent truncation.** A limit breach fails the whole run with `ok: false` and a structured
  error naming the offending path/limit — never a truncated archive.
- **Cleanup.** On abort or a write failure, any partially written archive/folder is removed via the
  injected `writer.remove`; the service does not leave a half-written artifact that a caller could
  mistake for a complete export.
- **Actionable errors.** Every `ExportFailure.message` names the offending item and the corrective
  action; messages never contain file contents or secrets.
- **Never throws.** `exportProject` always resolves to an `ExportProjectReport`; an unexpected
  throw is caught at the boundary and mapped to `EXPORT_WRITE_FAILED`/`UNKNOWN_ERROR`.
- **Abort.** A cooperative `AbortSignal` (mirroring Phase 12/13) stops between entries, cleans up,
  and returns `aborted: true` with the work completed so far.
- **Unavailable deps.** With no reader/writer injected, the service returns `ok: false` with
  `EXPORT_UNAVAILABLE` and an actionable message (the deferred-wiring contract).

## 13. Test strategy

Default suite (`npm run test`) — deterministic, no network, writing only into per-case `node:fs`
temp directories (mirroring `projectGenerator.test.ts:17-27`):

- **Doc generation** (`docGenerator.test.ts`): each document is produced for the canonical Phase 12
  fixture; **Markdown syntax** validation (single H1, balanced fenced code blocks, tables have a
  header + separator row, no unescaped table pipes); sections reflect `report.routes` /
  `report.components` / `report.assets` / `report.summary`; absent data is omitted, never fabricated;
  a doc over `MAX_EXPORT_DOC_BYTES` is refused.
- **ZIP codec** (`zip.test.ts`): CRC-32 known-answer vectors (e.g. `"123456789"` → `0xCBF43926`);
  local-header/central-directory/EOCD signatures and offsets; `buildZip` → `readZip` round-trip
  restores every path and byte; entries are sorted; timestamp bytes are the fixed `0x0021`/`0x0000`;
  the UTF-8 flag is set; byte-for-byte determinism across two builds; corrupt/truncated input is
  rejected with `ZipError`; an empty archive is handled.
- **Orchestration** (`zipExporter.test.ts`): happy path for **zip** and **folder** modes over an
  injected in-memory reader/writer; boundary limits (entry count, per-entry bytes, total bytes);
  path traversal (`..`, absolute, backslash, drive, NUL) rejected; duplicate/case-colliding entries
  rejected; a missing source file is skipped (`partial`); abort cleans up; `export.*` events carry
  bounded payloads; unavailable deps → `EXPORT_UNAVAILABLE`; the service never throws.
- **Integrity** (in `zipExporter.test.ts` and/or `zip.test.ts`): build an archive and unzip it with
  the module's `readZip`, and independently with Node `zlib.inflateRawSync` for a deflate entry,
  asserting every path + CRC + byte length.
- **Regression**: the full existing suite stays green (865-pass baseline), especially Phase 12
  generator/limits/failure/path suites and the Phase 8 `serverPathPolicy` suite.

**Opt-in E2E** (`zipExporter.e2e.test.ts`, gate `RUN_EXPORT_E2E=1`): call the real `generateProject`
into an isolated temp dir, export it to a real ZIP via a Node-`fs` reader/writer, then **unzip and
verify** that `README.md`, `ARCHITECTURE.md`, `COMPONENTS.md`, and every `report.files` source file
are present and byte-identical — a real-artifact check, never a mocked success path. It reports
BLOCKED (skipped) rather than a false PASS when it cannot run. Mirrors
`projectGenerator.build.e2e.test.ts`'s gating style.

## 14. Acceptance criteria (1:1 with PLAN §507-518 + the verification sentence)

1. A Markdown generator emits project-specific docs detailing architecture, route structure, and
   components (`README.md`, `ARCHITECTURE.md`, `COMPONENTS.md`). *(PLAN task 1, scope)*
2. The project can be bundled into a standalone ZIP archive **or** exported to a selected local
   folder, deterministically. *(PLAN task 2)*
3. ZIP integrity and documentation Markdown syntax tests pass. *(PLAN Tests)*
4. Exported archive unpacks cleanly and contains the complete source code and docs. *(PLAN
   Acceptance Criteria)*
5. Exporting to ZIP, unzipping, and verifying the presence of `README.md` and all source files
   succeeds. *(PLAN Verification)*
6. The PLAN risk ("large asset directories causing zip memory bloat") is mitigated by explicit
   entry/byte/total limits that reject rather than truncate.
7. All verification gates (§15) pass; Phase 12/13 behavior and events are unchanged.

## 15. Verification commands

```text
npm run typecheck
npm run lint
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Plus the opt-in export E2E gate (real generated project → real ZIP → real unzip/verify):

```text
RUN_EXPORT_E2E=1 npx vitest run src/services/exporter/__tests__/zipExporter.e2e.test.ts
```

`npm run build` was **not** verified during the audit and MUST be run during implementation (§3).

## 16. Documentation changes

- `docs/product/PLAN.md`: Phase 14 → COMPLETE with an as-built note.
- `CHANGELOG.md`: new `[Unreleased]` Phase 14 entry (matching the Phase 13 entry format).
- `docs/README.md`: index the exporter module.
- `docs/architecture/ARCHITECTURE.md`: record the exporter service layer.
- `docs/architecture/EVENT-SYSTEM.md`: document the `export.*` domain + payloads.
- `docs/architecture/ERROR-HANDLING.md`: add the `EXPORT_*` taxonomy rows.
- `docs/architecture/DATABASE.md`: note export is stateless and the doc-set deviation (if needed).
- `docs/dev/TESTING.md`: add the Phase 14 test tier (§5.12-style entry).
- `docs/impl-plan/phase-14-impl-plan.md`: this plan.

## 17. Git / commit strategy

One focused commit on `main`:

```text
feat(exporter): add project documentation and export engine (phase 14)
```

Do not amend Phase 13; do not push. One commit keeps the diff reviewable and the phase boundary
explicit.

## 18. Justified deviations from the specification

1. **C1 — Doc set is exactly three files (`README.md`, `ARCHITECTURE.md`, `COMPONENTS.md`).**
   `PLAN.md` §509 is authoritative and lists exactly these; PROJECT-GENERATOR-SPEC §3.1's 11-file
   manifest and DATABASE.md §6's `COMPONENT-TREE.md` are superseded by the hierarchy
   **PLAN.md > spec > architecture docs > PRD**. Recorded, not silent.
2. **C2 — `COMPONENTS.md` (not `COMPONENT-TREE.md`).** DATABASE.md §6 sketches
   `COMPONENT-TREE.md`; PLAN §509 names `COMPONENTS.md`, which wins. Recorded.
3. **C5 — No UI.** UI-SPEC §2.9's Project Documentation & Export Screen is deferred. PLAN §511
   lists only two service files, and Phase 12 set the service-only precedent; implementing a screen
   would also weaken the Phase 12/13 boundaries. Recorded.
4. **No new runtime dependency.** ZIP is authored in-repo (`zip.ts`) with a stored-block-default
   policy; no `jszip`/`adm-zip`/`archiver`/`fflate`/`pako`. Mirrors Phase 13's dependency-free codec
   deviation and keeps the app offline/deterministic.
5. **No Rust `zip` crate / no Tauri command.** CLONE-SPEC §6.2's Rust `zip`-crate archiver stays
   deferred; Phase 14 uses a TypeScript service with an injected filesystem seam instead. Production
   wiring (which concrete sandboxed reader/writer the shell supplies) is deferred; the seam is the
   contract that preserves `AGENTS.md:80`.
6. **CLONE-SPEC §6.2 deferral confirmed.** The static-clone ZIP archiver and the native
   folder-explorer trigger remain out of scope; Phase 14's archive targets the *generated project*,
   not the clone.
7. **Folder mode as a first-class `mode`.** PLAN says "or export to selected local folder"; Phase 14
   implements both `'zip'` and `'folder'` modes deterministically rather than treating folder export
   as an afterthought.

**Known limitations (informational, as built):**

These two behaviours were surfaced by the final audit. **Neither violates an explicit Phase 14
acceptance criterion nor the `SECURITY.md` §5.2 path-containment contract**, and neither was changed
(no exporter behaviour was altered in the finalization pass):

1. **Exact duplicate paths are silently de-duplicated.** `uniquePaths` (`zipExporter.ts:573`, called at
   `zipExporter.ts:327`) collapses byte-identical duplicates (e.g. a path present in both `reader.list`
   and `report.files`) without recording them in `skipped`. This is lossless (the entry is written
   once) and does not bypass any path check. **Case-insensitive** collisions *are* reported and reject
   the run with `EXPORT_DUPLICATE_ENTRY` (`zipExporter.ts:360-370`), so an ambiguity that could map two
   distinct files to one archive name is never silently resolved.
2. **Roots are validated as non-empty, not as absolute, at the request boundary.**
   `projectRoot`/`destinationRoot` are only required to be non-empty strings (`zipExporter.ts:248`,
   `zipExporter.ts:258`); the request type documents them as absolute but the boundary does not enforce
   it. Containment is still enforced downstream: every entry path is validated with
   `validateEntryPath` and every read/write target with `resolveWithinRoot` (`zipExporter.ts:329-343`),
   and the artifact name is confined to the destination root (`zipExporter.ts:301-310`), so a relative
   root cannot escape confinement. Requiring absolute roots would be a future hardening improvement,
   not a current correctness/security gap.

**Unresolved questions (deferred, not guessed):**

- Which concrete sandboxed reader/writer the Tauri shell will inject, and where the user-selected
  `destinationRoot` originates (a native folder picker is a future phase).
- Whether a future phase adds a documentation previewer / export screen (UI-SPEC §2.9).

*(Any further deviation discovered during implementation is appended here before commit.)*
