/**
 * Storage public surface - Artupski ReSite
 *
 * Everything above the storage layer imports from here. SQL, the sql.js driver,
 * and row shapes stay private to this module tree.
 */
export {
  storageService,
  initializeStorage,
  getStorageState,
  createStorage,
  type StorageState,
  type StorageInstance,
  type StorageRepositories,
  type CreateStorageHooks
} from './storageService';

export type { StorageContext } from './context';

export { SqliteDatabase, type RunResult } from './driver/database';
export { SqliteDatabase as SqliteDatabaseClass } from './driver/database';

export {
  MemoryStorageFile,
  NativeStorageFile,
  createDefaultStorageFile,
  createMemoryStorageFile,
  type StorageFile
} from './persistence/storageFile';

export {
  MIGRATIONS,
  computeChecksum,
  readAppliedMigrations,
  runMigrations,
  type AppliedMigration,
  type Migration,
  type MigrationResult,
  type RunMigrationsOptions
} from './migrations';

export { AuthSessionRepository } from './repositories/authSessionRepository';
export { ProjectRepository } from './repositories/projectRepository';
export {
  ScanRepository,
  type UpdateScanStatusInput,
  type UpdateScanProgressInput
} from './repositories/scanRepository';
export { ScanPageRepository, pathForUrl } from './repositories/scanPageRepository';
export { TechnologyRepository } from './repositories/technologyRepository';
export { SettingsRepository } from './repositories/settingsRepository';

export {
  createStorageError,
  toStorageError,
  type StorageErrorCode,
  type StorageErrorContext
} from './errors';

export type {
  CreateAuthSessionInput,
  CreateProjectInput,
  CreateScanInput,
  CreateScanTechnologyInput,
  UpdateProjectInput,
  UpsertScanPageInput,
  UpsertScanTechnologyInput
} from './types';
