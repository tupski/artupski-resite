/**
 * Project documentation & export type contracts - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 14) and
 * docs/impl-plan/phase-14-impl-plan.md sections 7.0-7.8.
 *
 * These are the ONLY public Phase 14 shapes a caller sees. They describe a
 * deterministic documentation generator (three Markdown documents derived
 * strictly from the Phase 12 report and caller metadata) and an export run that
 * bundles a generated project into a standalone ZIP archive or a local folder.
 *
 * Nothing is fabricated: absent report data is omitted, never invented, and a
 * limit breach is reported honestly rather than silently truncating the output.
 */
import type { ProjectGenerationReport } from './projectGen';

/* -------------------------------------------------------------------------- */
/* Resource-limit constants                                                   */
/* -------------------------------------------------------------------------- */

/** Hard cap on archive/folder entries (source files + generated docs). */
export const MAX_EXPORT_ENTRIES = 2100;
/** Hard cap on a single entry's uncompressed bytes (1 MiB). */
export const MAX_EXPORT_ENTRY_BYTES = 1024 * 1024;
/** Hard cap on total uncompressed bytes across the export (64 MiB). */
export const MAX_EXPORT_TOTAL_BYTES = 64 * 1024 * 1024;
/** Hard cap on any entry path's segment depth (mirrors `MAX_PROJECT_PATH_DEPTH`). */
export const MAX_EXPORT_PATH_DEPTH = 16;
/** Hard cap on a single generated Markdown document (1 MiB). */
export const MAX_EXPORT_DOC_BYTES = 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Documentation generation                                                   */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Export request / options                                                   */
/* -------------------------------------------------------------------------- */

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
  /** `'zip'` -> single archive; `'folder'` -> copied tree. */
  readonly mode: ExportMode;
  /** The absolute destination root (sandbox boundary for the written artifact). */
  readonly destinationRoot: string;
  readonly options?: ExportOptions;
}

/* -------------------------------------------------------------------------- */
/* Export result                                                              */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* ZIP entry metadata                                                         */
/* -------------------------------------------------------------------------- */

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
