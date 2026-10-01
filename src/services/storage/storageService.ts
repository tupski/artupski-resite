/**
 * Storage service - Artupski ReSite
 *
 * Owns the single application database instance and exposes repositories to the
 * rest of the app. It is the only place that knows how to (a) load bytes,
 * (b) open sql.js, (c) apply pragmas, (d) run migrations, and (e) persist.
 *
 * Lifecycle: `initializeStorage()` is awaited (non-blocking for the UI) from
 * the application root. It emits `storage.*` events and exposes a small state
 * machine (`uninitialized | initializing | ready | error`) so the UI can render
 * honest loading/error states. When initialization fails the app keeps running
 * but repositories refuse work with `STORAGE_NOT_READY`.
 */
import { createEvent, eventBus } from '../infra/eventBus';
import { logger } from '../infra/logger';
import type { StorageContext } from './context';
import { SqliteDatabase } from './driver/database';
import { createStorageError } from './errors';
import { runMigrations } from './migrations';
import { createDefaultStorageFile, createMemoryStorageFile, type StorageFile } from './persistence/storageFile';
import { ProjectRepository } from './repositories/projectRepository';
import { ScanPageRepository } from './repositories/scanPageRepository';
import { ScanRepository } from './repositories/scanRepository';
import { SettingsRepository } from './repositories/settingsRepository';
import { TechnologyRepository } from './repositories/technologyRepository';

export type StorageState = 'uninitialized' | 'initializing' | 'ready' | 'error';

export interface StorageRepositories {
  projects: ProjectRepository;
  scans: ScanRepository;
  pages: ScanPageRepository;
  technologies: TechnologyRepository;
  settings: SettingsRepository;
}

export interface StorageInstance {
  getDatabase(): SqliteDatabase;
  persist(): Promise<void>;
  close(): Promise<void>;
  repositories: StorageRepositories;
  databaseLocation: string;
}

export interface CreateStorageHooks {
  onMigrationStart?: (migration: { version: number; name: string }) => void;
  onMigrationComplete?: (migration: { version: number; name: string }) => void;
  /** Called once after all pending migrations have been applied successfully. */
  onMigrationsApplied?: () => void | Promise<void>;
}

/** Build repositories bound to an isolated storage context. */
function buildRepositories(context: StorageContext): StorageRepositories {
  return {
    projects: new ProjectRepository(context),
    scans: new ScanRepository(context),
    pages: new ScanPageRepository(context),
    technologies: new TechnologyRepository(context),
    settings: new SettingsRepository(context)
  };
}

/**
 * Create an isolated storage instance from any `StorageFile`.
 *
 * Used by the application singleton (native file) and by tests (memory file).
 * It performs the full open sequence and returns a ready instance.
 */
export async function createStorage(
  file: StorageFile,
  hooks: CreateStorageHooks = {}
): Promise<StorageInstance> {
  const existing = await file.read();
  const database = await SqliteDatabase.open(existing ?? undefined);
  database.applyPragmas();

  const persistDatabase = async (): Promise<void> => {
    await file.write(database.export());
  };

  const migrationResult = await runMigrations(database, {
    onApply: (migration) => hooks.onMigrationStart?.({ version: migration.version, name: migration.name }),
    // Migrations mutate the schema outside a repository, so persist them here.
    onApplied: async () => {
      await persistDatabase();
      await hooks.onMigrationsApplied?.();
    }
  });

  for (const migration of migrationResult.applied) {
    hooks.onMigrationComplete?.({ version: migration.version, name: migration.name });
  }

  // Enable FK enforcement for normal query work. Done here (not only inside the
  // runner) so every open path gets it - including reopening an already-migrated
  // database, and after `export()` resets the pragma.
  database.enableForeignKeys();

  const databaseLocation = file.describe();

  const instance: StorageInstance = {
    databaseLocation,
    getDatabase: () => database,
    repositories: buildRepositories({
      getDatabase: () => database,
      persist: async () => {
        const bytes = database.export();
        await file.write(bytes);
      }
    }),
    persist: persistDatabase,
    close: async () => {
      // Flush before releasing the handle: the in-memory engine has no
      // background writer, so unsaved work is lost on close otherwise.
      if (!database.isClosed()) {
        await instance.persist();
        database.close();
      }
    }
  };

  return instance;
}

type StorageStateListener = (state: StorageState) => void;

/**
 * The application-wide storage singleton. Components never touch this class
 * directly: they go through `projectService`/stores, which call
 * `storageService.getRepositories()`.
 */
class StorageService {
  private state: StorageState = 'uninitialized';
  private instance: StorageInstance | null = null;
  private lastError: ReturnType<typeof createStorageError> | null = null;
  private readonly listeners = new Set<StorageStateListener>();
  private initPromise: Promise<void> | null = null;
  private readonly log = logger.child('storage');

  getState(): StorageState {
    return this.state;
  }

  getLastError(): ReturnType<typeof createStorageError> | null {
    return this.lastError;
  }

  getDatabaseLocation(): string | null {
    return this.instance?.databaseLocation ?? null;
  }

  onStateChange(listener: StorageStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: StorageState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }

  /**
   * Initialize storage. Idempotent: concurrent/duplicate calls share one
   * promise. Never throws - failures are recorded as the `error` state and
   * surfaced through `storage.migration_failed`.
   */
  initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.runInitialize();
    return this.initPromise;
  }

  private async runInitialize(): Promise<void> {
    this.setState('initializing');
    // A previous instance (e.g. a manual re-initialize) must be flushed and
    // closed before a new handle opens the same file.
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
    }
    eventBus.emit(createEvent('storage.initializing', {}));
    this.log.info('Storage initialization started');

    try {
      const file = await this.resolveStorageFile();
      this.instance = await createStorage(file, {
        onMigrationStart: (migration) => {
          eventBus.emit(
            createEvent('storage.migration_started', {
              version: migration.version,
              name: migration.name
            })
          );
          this.log.info('Applying migration', migration);
        },
        onMigrationComplete: (migration) => {
          eventBus.emit(
            createEvent('storage.migration_completed', {
              version: migration.version,
              name: migration.name,
              appliedCount: 1
            })
          );
          this.log.info('Migration applied', migration);
        }
      });

      this.lastError = null;
      this.setState('ready');
      eventBus.emit(
        createEvent('storage.ready', {
          databaseLocation: this.instance.databaseLocation,
          appliedMigrations: []
        })
      );
      this.log.info('Storage ready', { location: this.instance.databaseLocation });
    } catch (error) {
      const structured = createStorageError('STORAGE_INIT_FAILED', {
        message: 'Local storage failed to initialize.',
        cause: error
      });
      this.lastError = structured;
      this.instance = null;
      this.setState('error');
      eventBus.emit(
        createEvent('storage.migration_failed', {
          version: null,
          code: structured.code,
          message: structured.message
        })
      );
      this.log.error('Storage initialization failed', structured);
    }
  }

  /**
   * Pick the persistence backend for the runtime. Native commands are used
   * inside the Tauri webview; anywhere else falls back to memory so the browser
   * preview and tests never touch the real database.
   */
  private async resolveStorageFile(): Promise<StorageFile> {
    const { isTauriRuntime } = await import('../ipc/tauri');
    if (!isTauriRuntime()) {
      this.log.warn('Tauri runtime not detected; using an in-memory storage file.');
      return createMemoryStorageFile();
    }
    return createDefaultStorageFile();
  }

  /** The live repository set. Throws `STORAGE_NOT_READY` before init. */
  getRepositories(): StorageRepositories {
    if (this.state !== 'ready' || !this.instance) {
      throw createStorageError('STORAGE_NOT_READY', {
        message: 'Local storage is not ready yet.'
      });
    }
    return this.instance.repositories;
  }

  /** Force a durable write of the current database. */
  async persist(): Promise<void> {
    if (!this.instance) {
      throw createStorageError('STORAGE_NOT_READY', {
        message: 'Local storage is not ready yet.'
      });
    }
    await this.instance.persist();
  }

  getDatabase(): SqliteDatabase {
    if (!this.instance) {
      throw createStorageError('STORAGE_NOT_READY', {
        message: 'Local storage is not ready yet.'
      });
    }
    return this.instance.getDatabase();
  }

  /** Close the database. Idempotent. */
  async close(): Promise<void> {
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
      this.setState('uninitialized');
    }
  }

  /** Test-only hook to fully reset the singleton between cases. */
  async resetForTests(): Promise<void> {
    await this.close();
    this.initPromise = null;
    this.lastError = null;
    this.setState('uninitialized');
  }
}

export const storageService = new StorageService();

/** Initialize storage once. Safe to call multiple times. */
export function initializeStorage(): Promise<void> {
  return storageService.initialize();
}

/** Current storage state for UI gating. */
export function getStorageState(): StorageState {
  return storageService.getState();
}
