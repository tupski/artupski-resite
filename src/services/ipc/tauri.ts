/**
 * Tauri IPC boundary - Artupski ReSite
 *
 * Thin, typed wrapper around `@tauri-apps/api`. React/components must not call
 * `invoke` directly; they go through typed service functions (see `commands.ts`).
 *
 * ARCHITECTURE.md section 4: Rust owns native desktop capabilities only. The
 * application also runs in a plain browser during `npm run dev` (Vite), so this
 * module degrades to a browser-safe mode instead of throwing.
 */

export interface IpcEnvironment {
  /** True when running inside the Tauri webview (native APIs available). */
  isTauri: boolean;
  /** Host platform identifier reported by Tauri, or 'browser'. */
  platform: string;
}

/** Detect whether the current runtime is a Tauri webview. */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

let cachedEnvironment: IpcEnvironment | null = null;

/** Resolve (and cache) the current IPC environment descriptor. */
export function getIpcEnvironment(): IpcEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }
  const isTauri = isTauriRuntime();
  cachedEnvironment = {
    isTauri,
    platform: isTauri ? 'native' : 'browser',
  };
  return cachedEnvironment;
}

/** Test-only hook to reset the memoized environment descriptor. */
export function resetIpcEnvironmentCache(): void {
  cachedEnvironment = null;
}
