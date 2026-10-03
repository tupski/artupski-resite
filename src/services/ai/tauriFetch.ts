/**
 * AI transport fetch resolver - Artupski ReSite
 *
 * The AI provider talks to a user-configured OpenAI-compatible endpoint. Inside
 * the Tauri webview a plain `window.fetch` is subject to CORS: many self-hosted
 * gateways (and the project's own 9Router endpoint) do not send
 * `Access-Control-Allow-Origin`, so the request is blocked and surfaces as
 * `TypeError: Failed to fetch` - even though the endpoint is reachable and the
 * key is valid.
 *
 * To make remote calls robust we route them through the official Tauri HTTP
 * plugin, whose request is executed by the Rust process (no browser CORS
 * preflight). Outside the desktop shell (Vite browser preview / tests) we fall
 * back to the ambient, receiver-bound `fetch`.
 */
import { isTauriRuntime } from '../ipc/tauri';
import type { FetchLike } from './provider';

let cached: FetchLike | null = null;

/** Bind the ambient `fetch` to its global receiver (a detached host fn throws). */
function resolveBrowserFetch(): FetchLike {
  const ambient: unknown = globalThis.fetch;
  if (typeof ambient !== 'function') {
    return ambient as FetchLike;
  }
  return (ambient as FetchLike).bind(globalThis);
}

/**
 * Resolve the fetch implementation for AI requests. Cached after first use so
 * the dynamic plugin import happens at most once.
 */
export async function resolveAiFetch(): Promise<FetchLike> {
  if (cached) {
    return cached;
  }
  if (!isTauriRuntime()) {
    cached = resolveBrowserFetch();
    return cached;
  }
  try {
    const mod = await import('@tauri-apps/plugin-http');
    const pluginFetch = mod.fetch as unknown as FetchLike;
    // Wrap so the plugin fetch is always called as a bare function.
    cached = (input, init) => pluginFetch(input, init);
  } catch {
    // Plugin unavailable (e.g. capability missing): fall back to webview fetch
    // so the failure is a normal reachability/CORS error rather than a crash.
    cached = resolveBrowserFetch();
  }
  return cached;
}

/** Test-only: clear the memoized resolver between cases. */
export function resetAiFetchForTests(): void {
  cached = null;
}
