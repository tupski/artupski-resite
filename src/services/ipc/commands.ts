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
      suggestedAction: 'Run the desktop shell with `npm run tauri:dev`.',
    });
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Wrap an IPC invocation as a discriminated result instead of a thrown error. */
async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<IpcResult<T>> {
  try {
    const data = await invokeCommand<T>(command, args);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toStructuredError(error, {
        code: 'IPC_ERROR',
        category: 'ipc',
        message: `IPC command "${command}" failed.`,
        severity: 'error',
        recoverable: true,
        retryable: true,
      }),
    };
  }
}

/** Native application name and version. */
export function appInfo(): Promise<IpcResult<AppInfo>> {
  return safeInvoke<AppInfo>('app_info');
}

/** Native platform/architecture descriptor. */
export function runtimeInfo(): Promise<IpcResult<RuntimeInfo>> {
  return safeInvoke<RuntimeInfo>('runtime_info');
}
