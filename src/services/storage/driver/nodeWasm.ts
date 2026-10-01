/**
 * Node-only WASM path resolution - Artupski ReSite
 *
 * Imported dynamically and only when `process.versions.node` is present (see
 * `sqljs.ts`). Vitest runs under Node, where sql.js's Emscripten loader reads
 * the `.wasm` binary from the filesystem.
 *
 * This module deliberately uses no `node:*` imports: a dynamic import is still
 * bundled into the web graph by Vite, and Node built-ins are unavailable in the
 * desktop webview. The package path is resolved through `process.cwd()`, which
 * is the project root under both Vitest and `vite dev` (and this branch is
 * never taken in a webview build).
 */
export function nodeWasmLocation(): string {
  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
  const separator = cwd.includes('\\') ? '\\' : '/';
  return [cwd, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'].join(separator);
}
