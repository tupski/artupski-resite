//! Sandboxed database file I/O - Artupski ReSite
//!
//! ARCHITECTURE.md section 4 keeps Rust to native desktop capabilities only.
//! This module deliberately implements a *narrow* boundary: it moves the bytes
//! of exactly ONE fixed database file (`app.db`) in and out of the
//! application's local-data directory. It never owns the schema, migrations,
//! or CRUD, and it exposes NO generic SQL execution capability whatsoever -
//! the SQLite engine is `sql.js` running inside the webview.
//!
//! Security properties enforced here:
//! - The frontend never supplies a path; the target is always `<app_local_data_dir>/app.db`.
//! - The directory is created if missing and canonicalized before use.
//! - The resolved target is re-verified to stay inside the app-local-data directory
//!   (defence in depth against traversal or a manipulated `app.db` symlink).
//! - Writes are atomic: bytes go to a temp file which is then renamed over the target.
//! - Writes are size-capped (64 MiB) so a runaway payload cannot exhaust the disk.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Filename of the single database this module is allowed to touch.
const DATABASE_FILE_NAME: &str = "app.db";

/// Temporary file used for atomic replace (same directory => same volume).
const TEMP_FILE_NAME: &str = "app.db.tmp";

/// Upper bound for a persisted database payload (64 MiB).
const MAX_DATABASE_BYTES: usize = 64 * 1024 * 1024;

/// Resolve the sandboxed `<app_local_data_dir>/app.db` path.
///
/// The directory is created when missing, then canonicalized so that the
/// containment check below compares fully-resolved paths.
fn resolve_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve the application local data directory: {error}"))?;

    fs::create_dir_all(&base)
        .map_err(|error| format!("Unable to create the application local data directory: {error}"))?;

    let canonical_base = base
        .canonicalize()
        .map_err(|error| format!("Unable to canonicalize the application local data directory: {error}"))?;

    let target = canonical_base.join(DATABASE_FILE_NAME);

    // Defence in depth: the resolved target must stay a direct child of the
    // canonical base directory. A fixed filename plus this containment check
    // means no caller-influenced value can escape the sandbox.
    if !target.starts_with(&canonical_base) || target.parent() != Some(canonical_base.as_path()) {
        return Err(
            "Refusing to operate on a database path outside the application data directory."
                .to_string(),
        );
    }

    Ok(target)
}

/// Absolute location of the database file.
///
/// Used for logging and display only. The UI never supplies a path.
#[tauri::command]
pub fn storage_database_location(app: AppHandle) -> Result<String, String> {
    let path = resolve_database_path(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Read the database bytes, or `None` when no database exists yet.
#[tauri::command]
pub fn storage_read_database(app: AppHandle) -> Result<Option<Vec<u8>>, String> {
    let path = resolve_database_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&path)
        .map_err(|error| format!("Unable to read the local database file: {error}"))?;

    Ok(Some(bytes))
}

/// Atomically replace the database file with `data`.
///
/// Writes to a temp file in the same directory, flushes it to disk, then
/// renames over the target so a crash cannot leave a half-written database.
#[tauri::command]
pub fn storage_write_database(app: AppHandle, data: Vec<u8>) -> Result<(), String> {
    if data.len() > MAX_DATABASE_BYTES {
        return Err(format!(
            "Refusing to write {} bytes: the database payload exceeds the {} byte limit.",
            data.len(),
            MAX_DATABASE_BYTES
        ));
    }

    let target = resolve_database_path(&app)?;
    let directory = target
        .parent()
        .ok_or_else(|| "The database path has no parent directory.".to_string())?;
    let temp_path = directory.join(TEMP_FILE_NAME);

    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|error| format!("Unable to create the temporary database file: {error}"))?;
        file.write_all(&data)
            .map_err(|error| format!("Unable to write the temporary database file: {error}"))?;
        file.flush()
            .map_err(|error| format!("Unable to flush the temporary database file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to sync the temporary database file: {error}"))?;
    }

    // Re-verify the target is still inside the sandbox immediately before the
    // replace, then rename (atomic on the same filesystem).
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("Unable to canonicalize the database directory: {error}"))?;
    if canonical_directory != directory {
        let _ = fs::remove_file(&temp_path);
        return Err("Refusing to replace a database outside the application data directory.".to_string());
    }

    fs::rename(&temp_path, &target).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("Unable to replace the local database file: {error}")
    })?;

    Ok(())
}
