/**
 * Migration 004 - Authentication & session scanning - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md sections 2.2 and 4, and
 * docs/architecture/DATABASE.md section 3 (`auth_sessions`).
 *
 * Creates the `auth_sessions` table that the authentication phase needs to
 * persist a captured browser session. `001`-`003` are never edited (their
 * recorded checksums must stay stable).
 *
 * Adaptation from DATABASE.md section 3 (documented, not silent):
 *   - The spec sketch carried `credentials_encrypted` (an opaque AES-GCM blob)
 *     and `storage_state_path` (a Playwright file path). The spec's own
 *     `EncryptedSessionStateModel` (AUTH-SCANNING.md section 2.2) splits the
 *     envelope into separate `encryptedPayload` / `iv` / `authTag` Base64
 *     fields, so those three columns are created explicitly instead of one
 *     opaque blob. This keeps the crypto envelope explicit and testable.
 *   - `storage_state_path` is intentionally NOT created: the encrypted payload
 *     lives in the database, and no plaintext `storageState.json` is ever
 *     written to disk (AUTH-SCANNING.md section 4.1 forbids a plaintext file).
 *   - `salt` is added (not secret) because the per-project PBKDF2 salt must be
 *     available to re-derive the key; without it a stored session could never
 *     be decrypted.
 *   - `target_domain` is added so a session can be scoped/validated against the
 *     origin it was captured for before it is ever injected.
 *
 * Indexes: `idx_auth_sessions_project_id` supports project lookups, and a
 * partial UNIQUE index `idx_auth_sessions_project_active` enforces at most one
 * ACTIVE session per project, which is the database-level guarantee that one
 * scan cannot inherit another session's state.
 */
import type { Migration } from './types';

const UP = `
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL DEFAULT 'interactive'
    CHECK (auth_type IN ('cookie', 'bearer_token', 'basic_auth', 'session_storage', 'interactive')),
  session_name TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  salt TEXT NOT NULL,
  cookie_count INTEGER NOT NULL DEFAULT 0,
  origin_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_project_id ON auth_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- At most one active session per project (partial index; SQLite supports a
-- WHERE clause on an index). This is the DB-level isolation guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_project_active
  ON auth_sessions(project_id) WHERE is_active = 1;
`;

export const MIGRATION_004_AUTH_SESSIONS: Migration = {
  version: 4,
  name: 'auth_sessions',
  sql: UP
};
