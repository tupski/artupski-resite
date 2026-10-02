/**
 * Project export orchestrator - Artupski ReSite
 * Source of truth: docs/product/PLAN.md (Phase 14) and
 * docs/impl-plan/phase-14-impl-plan.md sections 7.2-7.3, 7.8, 11-12.
 *
 * Bundles a completed Phase 12 generated project into a standalone, deterministic
 * ZIP archive or a copied local folder, together with the three generated
 * Markdown documents. Filesystem access is fully injected (`ExportFileReader` /
 * `ExportFileWriter`) so the service is unit-testable without a Tauri shell; the
 * seam is also the point at which the shell must assert the canonical sandbox
 * path. With no deps injected the service refuses to run (`EXPORT_UNAVAILABLE`).
 *
 * Guarantees:
 *   - every read/write target is validated with the Phase 12 path helpers BEFORE
 *     any side effect (absolute paths, `..`, backslashes, drive letters, NUL,
 *     empty, over-depth, and duplicate/case-colliding entries are rejected);
 *   - a limit breach fails the whole run (`ok: false`) rather than truncating;
 *   - a single unreadable file is recorded in `skipped` and the run continues
 *     (`partial: true`); nothing is dropped silently;
 *   - abort cleans up any partial artifact via `writer.remove`;
 *   - it never throws past its boundary.
 */
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { createEvent, eventBus, type AppEvent } from '../infra/eventBus';
import type { ProjectGenerationEventSink } from '../generator/projectGenerator';
import { isSafeProjectRelativePath, pathDepth, resolveWithinRoot } from '../generator/projectPaths';
import {
  MAX_EXPORT_ENTRIES,
  MAX_EXPORT_ENTRY_BYTES,
  MAX_EXPORT_PATH_DEPTH,
  MAX_EXPORT_TOTAL_BYTES,
  type ExportFailure,
  type ExportMode,
  type ExportProjectReport,
  type ExportProjectRequest,
  type ExportSummary,
  type GeneratedDoc,
  type ZipCompressionMethod,
  type ZipEntryMeta
} from '../../types/export';
import { generateDocs } from './docGenerator';
import { buildZip, crc32 } from './zip';

/* -------------------------------------------------------------------------- */
/* Dependency-injection seam                                                  */
/* -------------------------------------------------------------------------- */

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
  readonly events?: ProjectGenerationEventSink;
  readonly signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_ARCHIVE_SUFFIX = '.zip';

function defaultSink(): ProjectGenerationEventSink {
  return { emit: (event: AppEvent) => eventBus.emit(event) };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A filesystem-safe slug for one path segment; never empty. */
function slugifySegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'project';
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** True when `name` is a single, safe path segment (no separators). */
function isSingleSafeSegment(name: string): boolean {
  return isSafeProjectRelativePath(name) && !name.includes('/') && pathDepth(name) === 1;
}

function failure(
  kind: ExportFailure['kind'],
  id: string,
  code: string,
  message: string
): ExportFailure {
  return { kind, id, code, message };
}

function emptySummary(): ExportSummary {
  return { entryCount: 0, uncompressedBytes: 0, compressedBytes: 0, docCount: 0, partial: false };
}

function baseReport(request: ExportProjectRequest): ExportProjectReport {
  return {
    ok: false,
    mode: request.mode,
    destinationRoot: request.destinationRoot,
    artifactPath: '',
    entries: [],
    docs: [],
    skipped: [],
    summary: emptySummary(),
    aborted: false
  };
}

/* -------------------------------------------------------------------------- */
/* Default Node `fs` implementation (used by tests / runtime when injected)   */
/* -------------------------------------------------------------------------- */

/** A Node-`fs`-backed reader/writer pair; injected explicitly by callers. */
export function createNodeExportIo(): { reader: ExportFileReader; writer: ExportFileWriter } {
  const reader: ExportFileReader = {
    async list(root: string): Promise<string[]> {
      const out: string[] = [];
      const walk = async (dir: string, prefix: string): Promise<void> => {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        for (const dirent of dirents) {
          const rel = prefix.length > 0 ? `${prefix}/${dirent.name}` : dirent.name;
          if (dirent.isDirectory()) {
            await walk(join(dir, dirent.name), rel);
          } else if (dirent.isFile()) {
            out.push(rel);
          }
        }
      };
      await walk(root, '');
      return out.sort();
    },
    async read(root: string, relativePath: string): Promise<Uint8Array | null> {
      const absolute = resolveWithinRoot(root, relativePath);
      if (absolute === null) {
        return null;
      }
      try {
        const buffer = await fs.readFile(absolute);
        return new Uint8Array(buffer);
      } catch {
        return null;
      }
    }
  };

  const writer: ExportFileWriter = {
    async write(root: string, relativePath: string, data: Uint8Array): Promise<void> {
      const absolute = resolveWithinRoot(root, relativePath);
      if (absolute === null) {
        throw new Error(`Unsafe export write path ${JSON.stringify(relativePath)}.`);
      }
      await fs.mkdir(dirname(absolute), { recursive: true });
      const temp = `${absolute}.tmp-${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(temp, data);
      await fs.rename(temp, absolute);
    },
    async mkdir(root: string, relativePath: string): Promise<void> {
      const absolute = resolveWithinRoot(root, relativePath);
      if (absolute === null) {
        throw new Error(`Unsafe export mkdir path ${JSON.stringify(relativePath)}.`);
      }
      await fs.mkdir(absolute, { recursive: true });
    },
    async remove(root: string, relativePath: string): Promise<void> {
      const absolute = resolveWithinRoot(root, relativePath);
      if (absolute === null) {
        return;
      }
      await fs.rm(absolute, { recursive: true, force: true });
    }
  };

  return { reader, writer };
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Export a generated project. Always resolves to a report; never throws. An
 * unrecoverable validation/limit/io failure yields `ok: false` with a structured
 * error; a per-file read failure is recorded and the run continues.
 */
export async function exportProject(
  deps: ExportProjectDeps,
  request: ExportProjectRequest
): Promise<ExportProjectReport> {
  const events = deps.events ?? defaultSink();
  const options = request.options ?? {};
  const maxEntries = options.maxEntries ?? MAX_EXPORT_ENTRIES;
  const maxEntryBytes = options.maxEntryBytes ?? MAX_EXPORT_ENTRY_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_EXPORT_TOTAL_BYTES;
  const compression: ZipCompressionMethod = options.compression ?? 'store';
  const signal = deps.signal;

  const base = baseReport(request);
  const fail = (error: ExportFailure): ExportProjectReport => {
    events.emit(createEvent('export.failed', { code: error.code, message: error.message }));
    return { ...base, error };
  };

  // --- 1. Validate the request shape BEFORE any side effect. ------------------
  if (request.mode !== 'zip' && request.mode !== 'folder') {
    return fail(
      failure(
        'path',
        '(mode)',
        'EXPORT_VALIDATION_FAILED',
        `Unknown export mode ${JSON.stringify(request.mode)}.`
      )
    );
  }
  if (!isNonEmptyString(request.projectName)) {
    return fail(
      failure(
        'path',
        '(projectName)',
        'EXPORT_VALIDATION_FAILED',
        'A non-empty project name is required.'
      )
    );
  }
  if (!isNonEmptyString(request.projectRoot)) {
    return fail(
      failure(
        'path',
        '(projectRoot)',
        'EXPORT_VALIDATION_FAILED',
        'A non-empty project root is required.'
      )
    );
  }
  if (!isNonEmptyString(request.destinationRoot)) {
    return fail(
      failure(
        'path',
        '(destinationRoot)',
        'EXPORT_VALIDATION_FAILED',
        'A non-empty destination root is required.'
      )
    );
  }

  // --- 2. The deferred-wiring contract: no injected deps -> unavailable. -----
  if (!deps.reader || !deps.writer) {
    return fail(
      failure(
        'archive',
        '(deps)',
        'EXPORT_UNAVAILABLE',
        'No export file reader/writer was injected; production wiring is deferred. Supply ExportProjectDeps.reader and .writer.'
      )
    );
  }
  const reader = deps.reader;
  const writer = deps.writer;

  // --- 3. Resolve and validate the artifact name (single safe segment). -------
  const archiveName = resolveArtifactName(
    options.archiveName,
    request.projectName,
    DEFAULT_ARCHIVE_SUFFIX
  );
  const folderName = resolveArtifactName(options.folderName, request.projectName, '');
  const artifactName = request.mode === 'zip' ? archiveName : folderName;
  if (!isSingleSafeSegment(artifactName)) {
    return fail(
      failure(
        'path',
        artifactName,
        'EXPORT_PATH_UNSAFE',
        `Artifact name ${JSON.stringify(artifactName)} must be a single safe path segment.`
      )
    );
  }
  if (resolveWithinRoot(request.destinationRoot, artifactName) === null) {
    return fail(
      failure(
        'path',
        artifactName,
        'EXPORT_PATH_UNSAFE',
        `Artifact ${JSON.stringify(artifactName)} escapes the destination root.`
      )
    );
  }

  // --- 4. Enumerate the source files and validate every path. -----------------
  let listed: string[];
  try {
    listed = await reader.list(request.projectRoot);
  } catch (error) {
    return fail(
      failure(
        'file',
        '(list)',
        'EXPORT_READ_FAILED',
        `Failed to list the project root: ${errorMessage(error)}`
      )
    );
  }

  const sourcePaths = uniquePaths([...listed, ...request.report.files]);
  for (const path of sourcePaths) {
    const rejection = validateEntryPath(path);
    if (rejection) {
      return fail(rejection);
    }
    if (resolveWithinRoot(request.projectRoot, path) === null) {
      return fail(
        failure(
          'path',
          path,
          'EXPORT_PATH_UNSAFE',
          `Entry ${JSON.stringify(path)} escapes the project root.`
        )
      );
    }
  }
  if (sourcePaths.length === 0) {
    return fail(
      failure('file', '(files)', 'EXPORT_NO_FILES', 'The project report lists no files to export.')
    );
  }

  // --- 5. Generate docs (pure) and detect duplicate / case-colliding entries. --
  const docResult = generateDocs({
    projectName: request.projectName,
    targetFramework: request.targetFramework,
    report: request.report,
    ...(request.targetUrl !== undefined ? { targetUrl: request.targetUrl } : {}),
    ...(request.description !== undefined ? { description: request.description } : {})
  });

  const allNames = [...sourcePaths, ...docResult.docs.map((doc) => doc.name)];
  const collision = findCaseCollision(allNames);
  if (collision) {
    return fail(
      failure(
        'path',
        collision,
        'EXPORT_DUPLICATE_ENTRY',
        `Entry ${JSON.stringify(collision)} collides (case-insensitively) with another entry.`
      )
    );
  }

  // --- 6. Entry-count limit BEFORE any write. ---------------------------------
  if (allNames.length > maxEntries) {
    return fail(
      failure(
        'limit',
        '(entries)',
        'EXPORT_ENTRY_LIMIT_EXCEEDED',
        `${allNames.length} entries exceed the ${maxEntries}-entry export cap.`
      )
    );
  }

  if (signal?.aborted) {
    return abortedReport(base, events, request);
  }

  events.emit(createEvent('export.started', { mode: request.mode, files: allNames.length }));

  // --- 7. Read each source file; an unreadable one is skipped honestly. -------
  const skipped: ExportFailure[] = [];
  const files = new Map<string, Uint8Array>();
  for (const path of sourcePaths) {
    if (signal?.aborted) {
      await cleanup(writer, request, artifactName);
      return abortedReport(base, events, request);
    }
    let data: Uint8Array | null;
    try {
      data = await reader.read(request.projectRoot, path);
    } catch {
      data = null;
    }
    if (data === null) {
      skipped.push(
        failure(
          'file',
          path,
          'EXPORT_READ_FAILED',
          `Could not read ${JSON.stringify(path)}; it was skipped.`
        )
      );
      continue;
    }
    files.set(path, data);
  }

  // --- 8. Merge the generated docs and emit their events. ---------------------
  const docs: GeneratedDoc[] = [];
  for (const doc of docResult.docs) {
    files.set(doc.name, utf8Bytes(doc.contents));
    docs.push(doc);
    events.emit(createEvent('export.doc_generated', { name: doc.name, bytes: doc.bytes }));
  }
  for (const docFailure of docResult.skipped) {
    skipped.push(docFailure);
  }

  // --- 9. Per-entry and total byte limits BEFORE any write. -------------------
  let totalBytes = 0;
  for (const [path, data] of files) {
    if (data.byteLength > maxEntryBytes) {
      return fail(
        failure(
          'limit',
          path,
          'EXPORT_ENTRY_SIZE_LIMIT_EXCEEDED',
          `Entry ${JSON.stringify(path)} is ${data.byteLength} bytes and exceeds the ${maxEntryBytes}-byte cap.`
        )
      );
    }
    totalBytes += data.byteLength;
  }
  if (totalBytes > maxTotalBytes) {
    return fail(
      failure(
        'limit',
        '(total)',
        'EXPORT_TOTAL_SIZE_LIMIT_EXCEEDED',
        `The export is ${totalBytes} bytes and exceeds the ${maxTotalBytes}-byte cap.`
      )
    );
  }

  // --- 10. Write the artifact. ------------------------------------------------
  const orderedPaths = [...files.keys()].sort();
  let entries: ZipEntryMeta[];
  let compressedBytes: number;
  try {
    if (request.mode === 'zip') {
      const archive = buildZip(files, { compression });
      await writer.write(request.destinationRoot, artifactName, archive.bytes);
      entries = archive.entries;
      compressedBytes = archive.entries.reduce((sum, entry) => sum + entry.compressedSize, 0);
    } else {
      await writer.mkdir(request.destinationRoot, folderName);
      entries = [];
      for (const path of orderedPaths) {
        if (signal?.aborted) {
          await cleanup(writer, request, artifactName);
          return abortedReport(base, events, request);
        }
        const data = files.get(path)!;
        await writer.write(request.destinationRoot, `${folderName}/${path}`, data);
        entries.push({
          path,
          crc32: crc32(data),
          compressedSize: data.byteLength,
          uncompressedSize: data.byteLength,
          method: 'store'
        });
      }
      compressedBytes = totalBytes;
    }
  } catch (error) {
    await cleanup(writer, request, artifactName);
    return fail(
      failure(
        'archive',
        artifactName,
        request.mode === 'zip' ? 'EXPORT_ARCHIVE_WRITE_FAILED' : 'EXPORT_FOLDER_WRITE_FAILED',
        `Failed to write the export artifact: ${errorMessage(error)}`
      )
    );
  }

  // --- 11. Emit one entry event per written entry, then completion. -----------
  for (const entry of entries) {
    events.emit(
      createEvent('export.entry_written', { path: entry.path, bytes: entry.uncompressedSize })
    );
  }

  const partial = skipped.length > 0;
  events.emit(
    createEvent('export.completed', {
      mode: request.mode,
      entries: entries.length,
      bytes: totalBytes,
      partial
    })
  );

  return {
    ok: true,
    mode: request.mode,
    destinationRoot: request.destinationRoot,
    artifactPath: artifactName,
    entries,
    docs,
    skipped,
    summary: {
      entryCount: entries.length,
      uncompressedBytes: totalBytes,
      compressedBytes,
      docCount: docs.length,
      partial
    },
    aborted: false
  };
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

function resolveArtifactName(
  supplied: string | undefined,
  projectName: string,
  suffix: string
): string {
  if (supplied !== undefined && supplied.trim().length > 0) {
    const trimmed = supplied.trim();
    if (suffix.length > 0 && !trimmed.endsWith(suffix)) {
      return `${trimmed}${suffix}`;
    }
    return trimmed;
  }
  return `${slugifySegment(projectName)}${suffix}`;
}

/** Validate one entry path; returns the rejection failure or `null` when safe. */
function validateEntryPath(path: string): ExportFailure | null {
  if (!isSafeProjectRelativePath(path)) {
    return failure(
      'path',
      path,
      'EXPORT_PATH_UNSAFE',
      `Entry ${JSON.stringify(path)} is not a safe POSIX-relative path.`
    );
  }
  if (pathDepth(path) > MAX_EXPORT_PATH_DEPTH) {
    return failure(
      'path',
      path,
      'EXPORT_PATH_UNSAFE',
      `Entry ${JSON.stringify(path)} exceeds the ${MAX_EXPORT_PATH_DEPTH}-segment depth cap.`
    );
  }
  return null;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

/** Return the first path that case-insensitively collides, or `null`. */
function findCaseCollision(paths: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (seen.has(key)) {
      return path;
    }
    seen.add(key);
  }
  return null;
}

async function cleanup(
  writer: ExportFileWriter,
  request: ExportProjectRequest,
  artifactName: string
): Promise<void> {
  try {
    await writer.remove(request.destinationRoot, artifactName);
  } catch {
    // Best-effort cleanup; a cleanup failure must not mask the original outcome.
  }
}

function abortedReport(
  base: ExportProjectReport,
  events: ProjectGenerationEventSink,
  request: ExportProjectRequest
): ExportProjectReport {
  const error = failure('archive', '(aborted)', 'USER_CANCELLED', 'The export run was cancelled.');
  events.emit(createEvent('export.failed', { code: error.code, message: error.message }));
  return {
    ...base,
    mode: request.mode,
    destinationRoot: request.destinationRoot,
    aborted: true,
    error
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'unknown error';
}

/** Re-exported for callers that only need the export mode type. */
export type { ExportMode };
