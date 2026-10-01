# Database & Storage Specification - Artupski ReSite

Local persistence, SQLite relational schema, index layout, migration mechanics, and filesystem directory conventions.

---

## 1. Persistence Overview

- Database Engine: SQLite 3 embedded in native desktop runtime via native driver or WASM fallback.
- Design Pattern: Local-first per-user data store with transactional consistency and WAL mode enabled.
- File System Store: Project asset hierarchies, raw crawl captures, intermediate blueprints, and generated codebases stored directly on OS filesystem.

---

## 2. SQLite Configuration & Pragmas

Executed on every database connection lifecycle initialize:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456; -- 256MB memory map
PRAGMA cache_size = -64000;   -- 64MB cache
PRAGMA busy_timeout = 5000;
```

### 2.1 Phase 2 Implementation Note (as built)

The Phase 2 local storage foundation is implemented in `src/services/storage/`. It supersedes the pre-implementation wording above where they conflict:

- **Engine**: **`sql.js`** (SQLite 3 compiled to WebAssembly), not `better-sqlite3`/Kysely. Rationale: the same engine must run inside the Tauri webview **and** in Vitest/jsdom without a native build step. It is still SQLite 3.
- **Engine limitations (documented deviation)**: the following pragmas from the block above do **not** apply to the WASM engine and are deliberately not issued: `journal_mode = WAL` (single in-memory connection; no concurrent writers), `synchronous`, `mmap_size`, and `cache_size`. `foreign_keys = ON`, `busy_timeout = 5000`, and `temp_store = MEMORY` are applied.
- **`foreign_keys` lifecycle**: `PRAGMA foreign_keys` is enabled **after** migrations create every table, because SQLite only backfills a foreign key's parent index from data present at `CREATE TABLE` time. Note that sql.js 1.12.0's `Database.export()` resets connection pragmas, so the storage layer restores `foreign_keys = ON` after every export and on every open.
- **Location**: the database file is `app.db` inside the app-local-data directory (`AppData/Local/<identifier>` on Windows), resolved by Rust via `app.path().app_local_data_dir()`. No path is ever supplied by the frontend.
- **File I/O**: Rust exposes exactly three sandboxed commands in `src-tauri/src/storage.rs` - `storage_database_location`, `storage_read_database`, and `storage_write_database`. Writes are atomic (temp file + rename), size-capped at 64 MiB, and re-verified to stay inside the app-local-data directory. Rust owns **no** schema, migrations, or CRUD, and exposes **no** generic SQL execution command.
- **Migration tracking**: a `schema_migrations(version, name, checksum, applied_at)` ledger owned by the runner; each migration applies inside a transaction and is rolled back on failure; checksums use a deterministic FNV-1a hash and a mismatch raises `MIGRATION_CHECKSUM_MISMATCH`.
- **Persistence model**: the entire database is serialized (`export()`) and atomically written after every mutation. This is the sql.js persistence model, not a live file handle.

#### Phase 2 tables (created)
`projects`, `scans`, `scan_technologies` (per section 3) and `app_settings` (`key TEXT PRIMARY KEY`, `value TEXT`, `updated_at`) - the latter is an addition driven by PLAN.md Phase 2 ("settings") and is documented as such. Indexes: `idx_projects_status`, `idx_projects_updated_at`, `idx_scans_project_id`, `idx_scan_tech_scan_id`.

#### Deferred tables (intentionally NOT created in Phase 2)
`scan_assets`, `blueprints`, `auth_sessions`. These arrive with their owning phases and are not omissions. (`scan_pages` is added by migration `002` in Phase 4 - see section 2.2.)

### 2.2 Phase 4 Implementation Note (workstream 2, as built)

Phase 4 adds the per-page persistence the crawler needs. It is delivered as a **new, versioned migration** (`src/services/storage/migrations/002_scan_pages.ts`, version `2`); `001_init` is never edited (its recorded checksum must stay stable).

- **New table `scan_pages`** (child of `scans`, `ON DELETE CASCADE`). Columns: `id`, `scan_id`, `url`, `final_url`, `path`, `depth`, `http_status`, `title`, `meta_description`, `canonical_url`, `robots_meta`, `status` (`CHECK IN ('completed','failed','timeout','skipped')`), `error_code`, `error_message`, `load_time_ms`, `dom_content_loaded_time_ms`, `dom_node_count`, `headings` (JSON), `internal_links` (JSON), `external_links` (JSON), `images` (JSON), `warnings` (JSON), `captured_at`, `created_at`.
- **Adaptation from section 3 (documented, not silent)**: the `scan_pages` sketch in section 3 carried `content_type`, `screenshot_path`, `dom_snapshot_path`, and `har_path`. Phase 4 extracts page metadata/structure only, so those columns are intentionally **not** created (no speculative columns); they arrive with the responsive/assets/HAR phases. `path` is derived from the URL and kept for indexable path lookups.
- **Indexes**: `idx_scan_pages_scan_id`, `idx_scan_pages_url`, `idx_scan_pages_path`, `idx_scan_pages_status`, plus a **unique** `idx_scan_pages_scan_url (scan_id, url)` so re-visiting a URL updates its record instead of duplicating it (bounded retries / partial re-runs stay consistent).
- **Repositories**: `ScanPageRepository` (`src/services/storage/repositories/scanPageRepository.ts`) owns `scan_pages`; `ScanRepository` gains `updateProgress()` (counter updates) and `findActive()` / `findActiveByProject()` (live-scan detection for duplicate-start prevention). `ScanPageRepository.upsertMany()` writes a batch inside a single transaction and persists once (bounded writes), rather than one full-database export per page.
- **Partial/failed scans**: a page that could not be fetched is persisted with `status` `failed`/`timeout`/`skipped` and never `completed`; a cancelled or failed scan keeps the pages it already captured. A scan is only marked `completed` after the final page batch is written.

### 2.3 Phase 5 Implementation Note (as built)

Phase 5 (technology detection) reuses the `scan_technologies` table created in `001_init` and extends it with a **new, additive migration** (`src/services/storage/migrations/003_technology_detection.ts`, version `3`). `001` and `002` are never edited.

- **Columns added to `scan_technologies`**: `technology_id` (stable rule id, e.g. `nextjs`), `confidence_status` (`detected | probable | unknown`), `version_status` (`exact | major_only | unavailable`), `evidence` (JSON array of matched signals), `pages` (JSON array of contributing page URLs), and `limitation` (nullable honest note). The pre-existing `metadata` column is left in place (forward-only; not dropped).
- **Indexes**: a **UNIQUE** `idx_scan_technologies_scan_tech (scan_id, technology_id)` makes re-running detection idempotent (upsert, not duplicate), and `idx_scan_technologies_scan_name (scan_id, name)` supports the results ordering. Legacy rows have a NULL `technology_id`; SQLite treats NULLs as distinct in a UNIQUE index, so they are unaffected.
- **Repository**: `TechnologyRepository.upsertMany()` writes a whole detection report inside one transaction and persists once; `listByScan()` / `countByScan()` / `deleteByScan()` provide typed reads/cleanup. The `(scan_id, technology_id)` conflict target drives the upsert.
- **Cascade**: `scan_technologies.scan_id` remains `REFERENCES scans(id) ON DELETE CASCADE`, so deleting a scan removes its detections (verified in tests).
- **Lifecycle ordering**: detection is persisted after page batches are durable and **before** the scan is marked `completed`, so a completed scan always has its detections. A cancelled crawl retains the detections collected so far; a fatal crawl failure does not run detection.

### 2.4 Authentication & Session Scanning Implementation Note (as built)

The authentication phase adds two **new, forward-only** migrations; `001`–`003` are never edited.

- **Migration `004_auth_sessions.ts` (version `4`)** creates `auth_sessions`:
  - Columns: `id`, `project_id` (`REFERENCES projects(id) ON DELETE CASCADE`), `auth_type` (`CHECK IN ('cookie','bearer_token','basic_auth','session_storage','interactive')`), `session_name`, `target_domain`, `ciphertext`, `iv`, `auth_tag` (the AES-256-GCM envelope, Base64), `salt` (per-project PBKDF2 salt), `cookie_count`, `origin_count`, `is_active`, `expires_at`, `created_at`.
  - **Adaptation (documented, not silent)**: the section-3 sketch carried one opaque `credentials_encrypted` blob and a `storage_state_path`. The spec's own `EncryptedSessionStateModel` splits the envelope into `encryptedPayload`/`iv`/`authTag`, so those three columns are created explicitly; `storage_state_path` is **not** created because section 4.1 forbids a plaintext session file on disk. `salt` and `target_domain` are additions that make the key re-derivable and let a session be domain-scoped before injection.
  - **Indexes**: `idx_auth_sessions_project_id`, `idx_auth_sessions_expires_at`, and a **partial UNIQUE** `idx_auth_sessions_project_active (project_id) WHERE is_active = 1` enforcing one active session per project (DB-level isolation).
- **Migration `005_scan_page_auth.ts` (version `5`)** adds a nullable `auth_status` column to `scan_pages` plus `idx_scan_pages_auth_status`. Values are the five-value taxonomy in `AUTH-SCANNING.md` section 3.2, validated in TypeScript (no CHECK, so legacy NULL rows remain valid). No cookie value/token is ever written to `scan_pages`.
- **Repository**: `AuthSessionRepository` (`src/services/storage/repositories/authSessionRepository.ts`) owns all SQL for `auth_sessions` - `saveSession` (deactivates the prior active row in one transaction, then inserts), `findActive`, `listByProject`, `deleteByProject`, `deleteById`, `purgeExpired`, and `isExpired`. `ScanPageRepository` gains `authStatus` on upsert/read.
- **Retention/deletion**: a session is deleted by "Clear Session" (`deleteByProject`, a cryptographic deletion) or by the pre-crawl `purgeExpired`; `ON DELETE CASCADE` removes sessions with their project. Expiry comparison uses the same ISO-8601 UTC format the service writes.

### 2.5 Responsive Viewport Captures Implementation Note (as built, Phase 7)

The responsive phase adds one **forward-only** migration; `001`–`005` are never edited.

- **Migration `006_responsive_captures.ts` (version `6`)** creates `responsive_captures`:
  - Columns: `id`, `scan_id` (`REFERENCES scans(id) ON DELETE CASCADE`), `page_id` (`REFERENCES scan_pages(id) ON DELETE CASCADE`), `url`, `profile`, `width`, `height`, `device_scale_factor`, `is_mobile`, `has_touch`, `screenshot_path` (nullable - the PNG lives on disk, NOT in the DB), `detected_breakpoints` (JSON text), `element_map` (JSON text), `truncated`, `captured_at`.
  - **Indexes**: a UNIQUE `idx_responsive_captures_page_profile (page_id, profile)` so re-running a scan replaces a page's capture per profile rather than duplicating, plus `idx_responsive_captures_scan_id`.
- **Screenshot storage**: PNGs are written through the sandboxed Rust `asset_write` command under `<app_local_data_dir>/assets/responsive/<scanId>/`; only the relative path is persisted. This keeps the database small (the DB file is exported as a single WASM buffer).
- **Repository**: `ResponsiveCaptureRepository` (`src/services/storage/repositories/responsiveCaptureRepository.ts`) owns all SQL for the table - `upsert` (one row per page+profile), `listByScan`, `listByPage`, `countByScan`, `deleteByScan`. JSON columns are parsed defensively (a malformed value yields an empty list, never a throw).

---

## 3. Relational Schema & Table Definitions

```sql
-- Projects root table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'scanning', 'blueprint_ready', 'generating', 'completed', 'error')),
  storage_path TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Scans execution instances
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  depth_limit INTEGER NOT NULL DEFAULT 3,
  page_limit INTEGER NOT NULL DEFAULT 50,
  pages_discovered INTEGER NOT NULL DEFAULT 0,
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  assets_downloaded INTEGER NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  error_details TEXT
);

-- Individual scanned pages
CREATE TABLE IF NOT EXISTS scan_pages (
  id TEXT PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  title TEXT,
  content_type TEXT NOT NULL,
  screenshot_path TEXT,
  dom_snapshot_path TEXT,
  har_path TEXT,
  load_time_ms INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Downloaded assets
CREATE TABLE IF NOT EXISTS scan_assets (
  id TEXT PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES scan_pages(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  local_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image', 'stylesheet', 'script', 'font', 'video', 'audio', 'document', 'other')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Detected tech stack per scan
CREATE TABLE IF NOT EXISTS scan_technologies (
  id TEXT PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  detection_source TEXT NOT NULL,
  metadata TEXT, -- JSON blob
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Blueprints intermediate definitions
CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scan_id TEXT REFERENCES scans(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL DEFAULT 1,
  file_path TEXT NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT 0,
  validation_errors TEXT, -- JSON array
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Authentication session state storage
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('cookie', 'bearer_token', 'basic_auth', 'session_storage', 'interactive')),
  session_name TEXT NOT NULL,
  credentials_encrypted TEXT, -- AES-GCM encrypted payload
  storage_state_path TEXT,    -- Playwright storageState JSON
  is_active BOOLEAN NOT NULL DEFAULT 1,
  expires_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Process logs & execution telemetry
CREATE TABLE IF NOT EXISTS process_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scan_id TEXT REFERENCES scans(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'success', 'warning', 'error')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT, -- JSON blob or stack trace
  phase TEXT NOT NULL,
  progress REAL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Index Optimization Strategy

```sql
-- Project lookup
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

-- Scan relational lookups
CREATE INDEX IF NOT EXISTS idx_scans_project_id ON scans(project_id);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);

-- Scanned pages lookups
CREATE INDEX IF NOT EXISTS idx_scan_pages_scan_id ON scan_pages(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_pages_url ON scan_pages(url);
CREATE INDEX IF NOT EXISTS idx_scan_pages_path ON scan_pages(path);

-- Scanned assets indexing
CREATE INDEX IF NOT EXISTS idx_scan_assets_scan_id ON scan_assets(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_assets_page_id ON scan_assets(page_id);
CREATE INDEX IF NOT EXISTS idx_scan_assets_sha256 ON scan_assets(sha256);
CREATE INDEX IF NOT EXISTS idx_scan_assets_asset_type ON scan_assets(asset_type);

-- Technology detections
CREATE INDEX IF NOT EXISTS idx_scan_technologies_scan_id ON scan_technologies(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_technologies_category ON scan_technologies(category);

-- Blueprints
CREATE INDEX IF NOT EXISTS idx_blueprints_project_id ON blueprints(project_id);
CREATE INDEX IF NOT EXISTS idx_blueprints_scan_id ON blueprints(scan_id);

-- Auth sessions
CREATE INDEX IF NOT EXISTS idx_auth_sessions_project_id ON auth_sessions(project_id);

-- Process logging high-speed querying
CREATE INDEX IF NOT EXISTS idx_process_logs_project_id ON process_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_process_logs_scan_id ON process_logs(scan_id);
CREATE INDEX IF NOT EXISTS idx_process_logs_level ON process_logs(level);
CREATE INDEX IF NOT EXISTS idx_process_logs_created_at ON process_logs(created_at DESC);
```

---

## 5. Migration Strategy

Database migrations managed via forward-only versioned migration runners.

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Migration Execution Lifecycle
1. Acquire exclusive lock on SQLite connection.
2. Query highest applied version in `_migrations`.
3. Read embedded SQL migration files (`0001_initial.sql`, `0002_add_auth_sessions.sql`).
4. Execute unapplied files inside single atomic transaction (`BEGIN IMMEDIATE; ... COMMIT;`).
5. Record completion entry in `_migrations`.

---

## 6. Local Disk File Storage Conventions

Data partitioned into standardized workspace root directory:

```
~/.artupski-resite/
  ├── app.db                       # Primary SQLite database
  ├── app.db-wal                   # SQLite Write-Ahead Log
  ├── app.db-shm                   # SQLite Shared Memory
  └── projects/
      └── {project_id}/            # Unique UUID v4 directory
          ├── meta.json            # Project manifest copy
          ├── source/              # Layer 1: Raw captured crawl files
          │   ├── html/            # Raw downloaded HTML files
          │   ├── assets/          # Static assets (images, css, js, fonts)
          │   ├── screenshots/     # Viewport page captures (PNG/WebP)
          │   ├── dom/             # Sanitized DOM snapshots (JSON)
          │   └── har/             # Network capture archives (.har)
          ├── blueprint/           # Layer 2: Extracted intermediate representation
          │   ├── blueprint.v1.json# Validated full blueprint schema
          │   ├── design-tokens.json
          │   └── routes.json
          ├── clone/               # Local static preview site (rewritten paths)
          │   ├── index.html
          │   └── static/
          ├── docs/                # Generated documentation
          │   ├── ARCHITECTURE.md
          │   ├── API-SPEC.md
          │   └── COMPONENT-TREE.md
          └── generated/           # Layer 3: Modern React/Next.js codebase
              ├── package.json
              ├── tsconfig.json
              ├── src/
              └── public/
```

### Storage Cleaning & Retention Rules
- Temporary Playwright artifacts (.har, raw traces) pruned upon user request or auto-purged if project marked archived.
- Asset de-duplication: Identical sha256 payloads reference single physical file on disk when scanning multi-page sites.
