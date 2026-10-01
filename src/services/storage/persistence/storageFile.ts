/**
 * Storage file abstraction - Artupski ReSite
 *
 * The storage layer persists the serialized SQLite database through this
 * interface so the persistence *mechanism* is swappable and testable:
 *
 * - `NativeStorageFile` - sandboxed atomic read/write via the Tauri commands in
 *   `src-tauri/src/storage.rs` (exactly one fixed `app.db`; the frontend never
 *   supplies a path).
 * - `MemoryStorageFile` - in-process buffer used by tests and the browser
 *   preview, so no test ever touches the real application database.
 */
import { createStorageError } from '../errors';

export interface StorageFile {
  /** Human-readable location for logging/display (never used to write). */
  describe(): string;
  /** Read the persisted bytes, or `null` when no database exists yet. */
  read(): Promise<Uint8Array | null>;
  /** Atomically replace the persisted bytes. */
  write(data: Uint8Array): Promise<void>;
}

interface StorageIpcClient {
  storage_database_location(): Promise<string>;
  storage_read_database(): Promise<number[] | null>;
  storage_write_database(args: { data: number[] }): Promise<void>;
}

async function createNativeStorageFile(): Promise<StorageFile> {
  const { invoke } = await import('@tauri-apps/api/core');
  const ipc: StorageIpcClient = {
    storage_database_location: () => invoke<string>('storage_database_location'),
    storage_read_database: () => invoke<number[] | null>('storage_read_database'),
    storage_write_database: (args) => invoke<void>('storage_write_database', args)
  };
  return new NativeStorageFile(ipc);
}

/** Database file backed by the sandboxed Tauri commands. */
export class NativeStorageFile implements StorageFile {
  private readonly ipc: StorageIpcClient;
  private location: string | null = null;

  constructor(ipc: StorageIpcClient) {
    this.ipc = ipc;
  }

  describe(): string {
    return this.location ?? 'app-local-data/app.db';
  }

  async read(): Promise<Uint8Array | null> {
    try {
      this.location = await this.ipc.storage_database_location();
      const bytes = await this.ipc.storage_read_database();
      return bytes ? Uint8Array.from(bytes) : null;
    } catch (error) {
      throw createStorageError('STORAGE_READ_FAILED', {
        message: 'Failed to read the local database file.',
        cause: error
      });
    }
  }

  async write(data: Uint8Array): Promise<void> {
    try {
      await this.ipc.storage_write_database({ data: Array.from(data) });
    } catch (error) {
      throw createStorageError('STORAGE_WRITE_FAILED', {
        message: 'Failed to write the local database file.',
        cause: error
      });
    }
  }
}

/** In-memory database file. Used by tests and the browser preview. */
export class MemoryStorageFile implements StorageFile {
  private bytes: Uint8Array | null;

  constructor(initial: Uint8Array | null = null) {
    this.bytes = initial ? Uint8Array.from(initial) : null;
    if (this.bytes) {
      this.writes = 1;
    }
  }

  /** Number of successful write calls; useful for persistence assertions. */
  writes = 0;

  describe(): string {
    return 'memory://app.db';
  }

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(this.bytes ? Uint8Array.from(this.bytes) : null);
  }

  write(data: Uint8Array): Promise<void> {
    this.bytes = Uint8Array.from(data);
    this.writes += 1;
    return Promise.resolve();
  }
}

/**
 * Select the storage file for the current runtime.
 *
 * Inside the Tauri webview the sandboxed native commands are used; anywhere
 * else (Vitest, browser preview) an in-memory file keeps the application
 * functional without touching the real database.
 */
export async function createDefaultStorageFile(): Promise<StorageFile> {
  return createNativeStorageFile();
}

/**
 * Convenience factory used by the browser-preview fallback path in
 * `storageService`, kept separate so tests can request it explicitly.
 */
export function createMemoryStorageFile(initial: Uint8Array | null = null): StorageFile {
  return new MemoryStorageFile(initial);
}
