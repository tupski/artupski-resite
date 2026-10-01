/**
 * sql.js driver loader - Artupski ReSite
 *
 * sql.js is SQLite 3 compiled to WebAssembly (WASM). It is chosen over a native
 * driver (better-sqlite3) because the same engine must run inside the Tauri
 * webview *and* in Vitest/jsdom, without a native build step. See
 * docs/architecture/DATABASE.md section 2 for the recorded deviation.
 *
 * Two runtimes are supported through one entry point:
 *
 * - Browser / webview: Vite's `?url` import resolves the WASM asset, and
 *   `locateFile` points sql.js at it.
 * - Node / jsdom (Vitest): Vite externalizes Node built-ins, so the WASM path
 *   is computed by a separate factory module reached only through a guarded
 *   dynamic import. The browser bundle never references `node:*` because the
 *   factory sits behind a `import.meta.env.SSR` check.
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

// `sql.js` is an `export =` module; reach its types through the merged
// namespace rather than named imports.
export type SqlJsStatic = initSqlJs.SqlJsStatic;
export type SqlJsDatabase = initSqlJs.Database;
export type SqlJsValue = initSqlJs.SqlValue;

/** Factory signature implemented by `./nodeWasm`. */
export type WasmPathFactory = () => string;

let sqlModulePromise: Promise<SqlJsStatic> | null = null;

/** True when running under Node (Vitest), where Emscripten reads from disk. */
function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

/**
 * Resolve the WASM location for the current runtime. `locateFile` is
 * synchronous, so this runs eagerly on each load.
 */
async function resolveWasmLocation(): Promise<string> {
  if (isNodeRuntime()) {
    const { nodeWasmLocation } = await import('./nodeWasm');
    return nodeWasmLocation();
  }
  return wasmUrl;
}

/**
 * Load (once) and cache the sql.js module. Concurrent callers share a single
 * initialization promise so the WASM binary is compiled exactly once.
 */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlModulePromise) {
    sqlModulePromise = resolveWasmLocation()
      .then((wasmLocation) =>
        initSqlJs({
          locateFile: (file: string) => (file.endsWith('.wasm') ? wasmLocation : file)
        })
      )
      .catch((error: unknown) => {
        // Allow a later retry instead of caching a permanently rejected promise.
        sqlModulePromise = null;
        throw error;
      });
  }
  return sqlModulePromise;
}

/** Open a database, hydrating from `data` bytes when provided. */
export async function openDatabase(data?: Uint8Array): Promise<SqlJsDatabase> {
  const SQL = await loadSqlJs();
  return data ? new SQL.Database(data) : new SQL.Database();
}

/** Test-only hook so suites can reset module-level caching between cases. */
export function resetSqlJsCache(): void {
  sqlModulePromise = null;
}
