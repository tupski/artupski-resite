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
