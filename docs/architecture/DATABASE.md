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
`scan_pages`, `scan_assets`, `blueprints`, `auth_sessions`. These arrive with their owning phases and are not omissions.

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
