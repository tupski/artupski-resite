/**
 * Repository context - Artupski ReSite
 *
 * Repositories receive a `StorageContext` rather than reaching for the
 * `storageService` singleton directly. This keeps them unit-testable with an
 * isolated database and makes the persistence side effect explicit: every
 * mutation calls `persist()` (export bytes + atomic write).
 */
import type { SqliteDatabase } from './driver/database';

export interface StorageContext {
  /** The live database handle. Throws `STORAGE_NOT_READY` when not initialized. */
  getDatabase(): SqliteDatabase;
  /** Serialize and durably write the database. */
  persist(): Promise<void>;
}
