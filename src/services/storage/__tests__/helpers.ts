/**
 * Storage test helpers - Artupski ReSite
 *
 * `createTestStorage()` returns a fully isolated storage instance backed by a
 * fresh in-memory sql.js database and a `MemoryStorageFile`. Tests never touch
 * the real application database.
 */
import { SqliteDatabase } from '../driver/database';
import { runMigrations } from '../migrations';
import { MemoryStorageFile } from '../persistence/storageFile';
import { createStorage, type StorageInstance } from '../storageService';
import type { StorageContext } from '../context';
import { ProjectRepository } from '../repositories/projectRepository';
import { ScanPageRepository } from '../repositories/scanPageRepository';
import { ScanRepository } from '../repositories/scanRepository';
import { SettingsRepository } from '../repositories/settingsRepository';
import { TechnologyRepository } from '../repositories/technologyRepository';

export interface TestStorage {
  instance: StorageInstance;
  file: MemoryStorageFile;
  db: SqliteDatabase;
  context: StorageContext;
  projects: ProjectRepository;
  scans: ScanRepository;
  pages: ScanPageRepository;
  technologies: TechnologyRepository;
  settings: SettingsRepository;
  /** Export current bytes (as the persisted database would be). */
  exportBytes(): Uint8Array;
  /** Build a second, independent storage instance from exported bytes. */
  reopen(): Promise<TestStorage>;
  /** Close the underlying database. */
  close(): Promise<void>;
}

function wrap(instance: StorageInstance, file: MemoryStorageFile): TestStorage {
  const db = instance.getDatabase();
  const context: StorageContext = {
    getDatabase: () => db,
    persist: () => instance.persist()
  };

  const testStorage: TestStorage = {
    instance,
    file,
    db,
    context,
    projects: new ProjectRepository(context),
    scans: new ScanRepository(context),
    pages: new ScanPageRepository(context),
    technologies: new TechnologyRepository(context),
    settings: new SettingsRepository(context),
    exportBytes: () => db.export(),
    reopen: async () => {
      const bytes = db.export();
      return createTestStorage(bytes);
    },
    close: () => instance.close()
  };

  return testStorage;
}

/** Create an isolated storage instance, optionally hydrated from `bytes`. */
export async function createTestStorage(bytes?: Uint8Array): Promise<TestStorage> {
  const file = new MemoryStorageFile(bytes ?? null);
  const instance = await createStorage(file);
  return wrap(instance, file);
}

/**
 * Build a raw, un-migrated database handle. Used to exercise the migration
 * runner (and its failure paths) directly.
 */
export async function createRawDatabase(bytes?: Uint8Array): Promise<SqliteDatabase> {
  const db = await SqliteDatabase.open(bytes);
  db.applyPragmas();
  // Mirror a real connection: FK enforcement is on for query work.
  db.enableForeignKeys();
  return db;
}

export { runMigrations };
