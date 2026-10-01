/**
 * Migration registry types - Artupski ReSite
 *
 * Kept separate from the runner to avoid a circular import between the runner
 * registry and the individual migration modules.
 */

export interface Migration {
  /** Monotonic version. Applied in ascending order; never renumbered. */
  version: number;
  /** Stable human-readable name recorded alongside the version. */
  name: string;
  /** SQL applied within a single transaction. */
  sql: string;
}

/** A migration that has been recorded as applied in `schema_migrations`. */
export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: string;
}

export interface MigrationResult {
  applied: AppliedMigration[];
  alreadyApplied: number[];
}
