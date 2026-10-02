/**
 * Typed IPC command client - Artupski ReSite
 *
 * Single entry point for invoking native Tauri commands. Each command is
 * explicitly typed; components consume `appInfo()` / `appRuntimeInfo()` rather
 * than importing `invoke` themselves.
 *
 * Phase 1 exposes only trivial, safe native capabilities. Scanner, Blueprint,
 * AI, and generator commands are deliberately absent.
 */
import { createStructuredError, toStructuredError, type StructuredError } from '../infra/errors';
import type { BlueprintRoot } from '../../types/blueprint';
import type { Blueprint as BlueprintRecord } from '../../types/models';
import { isTauriRuntime } from './tauri';

/** Rust `app_info` command response. */
export interface AppInfo {
  name: string;
  version: string;
}

/** Rust `runtime_info` command response. */
export interface RuntimeInfo {
  platform: string;
  arch: string;
  appVersion: string;
}

/** Rust `process_spawn` command response (Phase 3). */
export interface ProcessHandleInfo {
  id: string;
  pid: number;
}

/** Rust `process_status` command response (Phase 3). */
export interface ProcessStatusInfo {
  id: string;
  running: boolean;
  pid: number | null;
}

/** Arguments for `process_spawn`; `args` is always an array (never a shell string). */
export interface SpawnProcessArgs {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: StructuredError };

/**
 * Invoke a Tauri command by name.
 *
 * Dynamically imports `@tauri-apps/api/core` so that the browser-only Vite dev
 * server does not require the native runtime to boot.
 */
async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw createStructuredError({
      code: 'IPC_ERROR',
      category: 'ipc',
      message: `Command "${command}" is unavailable outside the Tauri desktop runtime.`,
      severity: 'warning',
      recoverable: true,
      suggestedAction: 'Run the desktop shell with `npm run tauri:dev`.'
    });
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/**
 * Wrap an IPC invocation as a discriminated result instead of a thrown error.
 *
 * `fallback` lets a caller map transport failures onto a domain-specific
 * structured error (e.g. process commands report `PROCESS_SPAWN_FAILED`)
 * without this module importing the process error factory.
 */
async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  fallback?: {
    code: StructuredError['code'];
    category: StructuredError['category'];
    message: string;
  }
): Promise<IpcResult<T>> {
  try {
    const data = await invokeCommand<T>(command, args);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: fallback?.code ?? 'IPC_ERROR',
        category: fallback?.category ?? 'ipc',
        message: fallback?.message ?? `IPC command "${command}" failed.`,
        severity: 'error',
        recoverable: true,
        retryable: true
      })
    };
  }
}

const PROCESS_FALLBACK = {
  code: 'PROCESS_SPAWN_FAILED',
  category: 'process'
} as const;

/** Native application name and version. */
export function appInfo(): Promise<IpcResult<AppInfo>> {
  return safeInvoke<AppInfo>('app_info');
}

/** Native platform/architecture descriptor. */
export function runtimeInfo(): Promise<IpcResult<RuntimeInfo>> {
  return safeInvoke<RuntimeInfo>('runtime_info');
}

/** Spawn an allowlisted worker process. Args are an array; never a shell string. */
export function processSpawn(args: SpawnProcessArgs): Promise<IpcResult<ProcessHandleInfo>> {
  return safeInvoke<ProcessHandleInfo>(
    'process_spawn',
    { request: args },
    {
      ...PROCESS_FALLBACK,
      message: 'Failed to spawn the worker process.'
    }
  );
}

/** Write a bounded string to a managed worker's stdin. */
export function processWrite(id: string, data: string): Promise<IpcResult<void>> {
  return safeInvoke<void>(
    'process_write',
    { id, data },
    {
      ...PROCESS_FALLBACK,
      message: 'Failed to write to the worker process.'
    }
  );
}

/** Terminate a managed worker. `force` also kills the child tree. */
export function processKill(id: string, force = false): Promise<IpcResult<boolean>> {
  return safeInvoke<boolean>(
    'process_kill',
    { id, force },
    {
      ...PROCESS_FALLBACK,
      message: 'Failed to terminate the worker process.'
    }
  );
}

/** Query whether a managed worker is still running. */
export function processStatus(id: string): Promise<IpcResult<ProcessStatusInfo>> {
  return safeInvoke<ProcessStatusInfo>(
    'process_status',
    { id },
    {
      ...PROCESS_FALLBACK,
      message: 'Failed to query the worker process status.'
    }
  );
}

const ASSET_FALLBACK = {
  code: 'STORAGE_WRITE_FAILED',
  category: 'io'
} as const;

/**
 * Write binary asset bytes (e.g. a responsive screenshot) beneath the app's
 * sandboxed `assets/` root. `relative` is a caller-supplied RELATIVE path; the
 * Rust `asset_write` command rejects absolute paths and any `..` component.
 */
export function assetWrite(relative: string, data: Uint8Array): Promise<IpcResult<string>> {
  return safeInvoke<string>(
    'asset_write',
    { relative, data: Array.from(data) },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to write the asset file.'
    }
  );
}

/** Delete a previously written asset. A missing file is treated as success. */
export function assetDelete(relative: string): Promise<IpcResult<void>> {
  return safeInvoke<void>(
    'asset_delete',
    { relative },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to delete the asset file.'
    }
  );
}

/**
 * Return the absolute sandboxed clone root (`<app_local_data_dir>/clones`). The
 * preview server is pointed at this path; the frontend never supplies one.
 */
export function cloneRoot(): Promise<IpcResult<string>> {
  return safeInvoke<string>(
    'clone_root',
    {},
    {
      ...ASSET_FALLBACK,
      message: 'Failed to resolve the clone directory.'
    }
  );
}

/**
 * Write bytes to a RELATIVE path inside the sandboxed clone tree. The Rust
 * `clone_write` command rejects absolute paths and any `..` component.
 */
export function cloneWrite(relative: string, data: Uint8Array): Promise<IpcResult<string>> {
  return safeInvoke<string>(
    'clone_write',
    { relative, data: Array.from(data) },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to write the clone file.'
    }
  );
}

/** Read a previously written clone file. A missing file returns an error. */
export function cloneRead(relative: string): Promise<IpcResult<number[]>> {
  return safeInvoke<number[]>(
    'clone_read',
    { relative },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to read the clone file.'
    }
  );
}

/** Delete a previously written clone file. A missing file is treated as success. */
export function cloneDelete(relative: string): Promise<IpcResult<void>> {
  return safeInvoke<void>(
    'clone_delete',
    { relative },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to delete the clone file.'
    }
  );
}

/**
 * Return the absolute sandboxed blueprint root (`<app_local_data_dir>/blueprints`).
 * The frontend never supplies a path.
 */
export function blueprintRoot(): Promise<IpcResult<string>> {
  return safeInvoke<string>(
    'blueprint_root',
    {},
    {
      ...ASSET_FALLBACK,
      message: 'Failed to resolve the blueprint directory.'
    }
  );
}

/**
 * Write a Blueprint JSON document. `id` is a single safe path segment (never a
 * path); the Rust `blueprint_write` command writes `<blueprints>/v1/<id>.json`
 * and rejects absolute paths, separators, and `.`/`..`.
 */
export function blueprintWrite(id: string, data: Uint8Array): Promise<IpcResult<string>> {
  return safeInvoke<string>(
    'blueprint_write',
    { id, data: Array.from(data) },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to write the blueprint file.'
    }
  );
}

/** Read a previously written Blueprint document. A missing file returns an error. */
export function blueprintRead(id: string): Promise<IpcResult<number[]>> {
  return safeInvoke<number[]>(
    'blueprint_read',
    { id },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to read the blueprint file.'
    }
  );
}

/** Delete a previously written Blueprint document. A missing file is treated as success. */
export function blueprintDelete(id: string): Promise<IpcResult<void>> {
  return safeInvoke<void>(
    'blueprint_delete',
    { id },
    {
      ...ASSET_FALLBACK,
      message: 'Failed to delete the blueprint file.'
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Blueprint lifecycle commands (Phase 9)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Input for `blueprintGenerate`. Only ids are accepted - the lifecycle wrapper
 * resolves the document + sandboxed path itself; the UI never supplies a path.
 */
export interface BlueprintGenerateArgs {
  scanId: string;
  projectId: string;
  /** Optional seed URL override; otherwise derived from the scan's pages. */
  sourceUrl?: string;
}

/** Honest outcome of a Blueprint generate request. */
export interface BlueprintGenerateResult {
  blueprintId: string | null;
  version: number;
  isValid: boolean;
  validationErrors: Array<{ code: string; path: string; message: string }>;
  pageCount: number;
  componentCount: number;
  skippedPages: number;
  partial: boolean;
  failed: boolean;
}

/**
 * Synthesize + persist a Blueprint for a completed scan, then return the honest
 * lifecycle summary. This is a thin wrapper over `runBlueprintLifecycle` (the
 * same seam `scanService` uses); it never throws and never changes a scan's
 * terminal status. The Rust sandbox (`blueprint_write`) is reused, never
 * duplicated.
 */
export async function blueprintGenerate(
  args: BlueprintGenerateArgs
): Promise<IpcResult<BlueprintGenerateResult>> {
  try {
    const { runBlueprintLifecycle } = await import('../blueprint/blueprintLifecycle');
    const outcome = await runBlueprintLifecycle({
      scanId: args.scanId,
      projectId: args.projectId,
      ...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {})
    });
    return {
      ok: true,
      data: {
        blueprintId: outcome.blueprintId,
        version: outcome.version,
        isValid: outcome.isValid,
        validationErrors: outcome.validationErrors.map((error) => ({ ...error })),
        pageCount: outcome.pageCount,
        componentCount: outcome.componentCount,
        skippedPages: outcome.skippedPages,
        partial: outcome.partial,
        failed: outcome.failed
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: 'BLUEPRINT_VALIDATION_FAILED',
        category: 'blueprint',
        message: 'Failed to generate the Blueprint.',
        recoverable: true,
        retryable: true
      })
    };
  }
}

/**
 * Load the latest persisted Blueprint row for a scan (metadata only; no document
 * bytes). The store uses this to render honest metadata without reading the
 * (large) JSON until it is actually displayed.
 */
export async function blueprintGetLatest(
  scanId: string
): Promise<IpcResult<BlueprintRecord | null>> {
  try {
    const { storageService } = await import('../storage');
    if (storageService.getState() !== 'ready') {
      return {
        ok: false,
        error: createStructuredError({
          code: 'STORAGE_NOT_READY',
          category: 'database',
          message: 'Cannot read the Blueprint: local storage is not ready.',
          severity: 'warning',
          recoverable: true,
          suggestedAction: 'Wait for local storage to finish initializing, then retry.'
        })
      };
    }
    const record = await storageService.getRepositories().blueprints.getLatestByScan(scanId);
    return { ok: true, data: record };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: 'STORAGE_READ_FAILED',
        category: 'database',
        message: 'Failed to read the Blueprint metadata.'
      })
    };
  }
}

/** A loaded Blueprint document plus its honest read state. */
export interface BlueprintExportResult {
  blueprintId: string;
  version: number;
  isValid: boolean;
  validationErrors: Array<{ code: string; path: string; message: string }>;
  /** Pretty-printed document JSON, or null when it could not be read. */
  json: string | null;
  /** Parsed document, or null when it could not be read/parsed. */
  document: BlueprintRoot | null;
  /** Honest read failure reason, or null. */
  readError: string | null;
}

/**
 * Read the latest Blueprint document for a scan through the sandboxed
 * `blueprint_read` seam, ready for export/viewing. An unreadable document is
 * reported honestly (`json: null`, `readError` set) rather than fabricated.
 */
export async function blueprintExport(
  scanId: string
): Promise<IpcResult<BlueprintExportResult | null>> {
  try {
    const { storageService } = await import('../storage');
    if (storageService.getState() !== 'ready') {
      return {
        ok: false,
        error: createStructuredError({
          code: 'STORAGE_NOT_READY',
          category: 'database',
          message: 'Cannot export the Blueprint: local storage is not ready.',
          severity: 'warning',
          recoverable: true,
          suggestedAction: 'Wait for local storage to finish initializing, then retry.'
        })
      };
    }
    const record = await storageService.getRepositories().blueprints.getLatestByScan(scanId);
    if (!record) {
      return { ok: true, data: null };
    }
    const { loadBlueprintDocument } = await import('../blueprint/blueprintLifecycle');
    const view = await loadBlueprintDocument(record);
    return {
      ok: true,
      data: {
        blueprintId: record.id,
        version: record.version,
        isValid: record.isValid,
        validationErrors: record.validationErrors.map((error) => ({ ...error })),
        json: view.json,
        document: view.document,
        readError: view.readError
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: 'STORAGE_READ_FAILED',
        category: 'blueprint',
        message: 'Failed to export the Blueprint document.'
      })
    };
  }
}

/** Payload of the Rust `process://stdout` / `process://stderr` events. */
export interface ProcessStreamEvent {
  id: string;
  line: string;
}

/** Payload of the Rust `process://exit` event (signal is a Unix signal number). */
export interface ProcessExitEvent {
  id: string;
  code: number | null;
  signal: number | null;
}

/**
 * Subscribe to a native process stream/exit event. Returns a no-op unsubscribe
 * outside the Tauri runtime so the browser preview never throws.
 */
export async function onProcessEvent<T>(
  event: 'process://stdout' | 'process://stderr' | 'process://exit',
  handler: (payload: T) => void
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<T>(event, (message) => handler(message.payload));
  return unlisten;
}
