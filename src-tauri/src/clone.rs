//! Sandboxed static-clone file I/O - Artupski ReSite
//!
//! ARCHITECTURE.md section 4 keeps Rust to native desktop capabilities only.
//! This module is the narrow boundary for the generated **static clone tree**
//! (Phase 8): it writes, reads, and deletes files ONLY beneath a fixed
//! `<app_local_data_dir>/clones` root. It never executes SQL, never serves HTTP
//! (the preview server is a managed Node child), and never reads or writes the
//! application database.
//!
//! Security properties enforced here (mirrors `asset.rs`):
//! - The frontend supplies a *relative* path only; the root is always
//!   `<app_local_data_dir>/clones`.
//! - The relative path is rejected when it is absolute or contains a `..`,
//!   empty, or platform-specific separator component, so it cannot escape the
//!   sandbox.
//! - The resolved target is canonicalized and re-verified to stay inside the
//!   canonical clones root (defence in depth against symlinks).
//! - Writes are atomic (temp file + rename) and size-capped (32 MiB).

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Subdirectory (under app-local-data) that all clone I/O is confined to.
const CLONES_DIR_NAME: &str = "clones";

/// Upper bound for a single clone file payload (32 MiB).
const MAX_CLONE_BYTES: usize = 32 * 1024 * 1024;

/// Validate a caller-supplied relative path and reject anything that could
/// escape the clones sandbox.
fn validate_relative(relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("Clone path must not be empty.".to_string());
    }
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return Err("Clone path must be relative.".to_string());
    }
    let mut safe = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            _ => {
                return Err(
                    "Clone path must not contain '..' or root components.".to_string(),
                )
            }
        }
    }
    if safe.as_os_str().is_empty() {
        return Err("Clone path must name a file.".to_string());
    }
    Ok(safe)
}

/// Resolve the canonical clones root, creating it when missing.
fn resolve_clones_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve the application local data directory: {error}"))?;

    let root = base.join(CLONES_DIR_NAME);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create the clones directory: {error}"))?;
    root.canonicalize()
        .map_err(|error| format!("Unable to canonicalize the clones directory: {error}"))
}

/// Return the absolute clones root so the preview server can be pointed at it.
#[tauri::command]
pub fn clone_root(app: AppHandle) -> Result<String, String> {
    let root = resolve_clones_root(&app)?;
    Ok(root.to_string_lossy().into_owned())
}

/// Write `data` to `<clones>/<relative>` atomically, creating parent directories.
#[tauri::command]
pub fn clone_write(app: AppHandle, relative: String, data: Vec<u8>) -> Result<String, String> {
    if data.len() > MAX_CLONE_BYTES {
        return Err(format!(
            "Refusing to write {} bytes: the clone file exceeds the {} byte limit.",
            data.len(),
            MAX_CLONE_BYTES
        ));
    }

    let safe_relative = validate_relative(&relative)?;
    let root = resolve_clones_root(&app)?;
    let target = root.join(&safe_relative);

    // Containment check after joining, before any filesystem write.
    if !target.starts_with(&root) {
        return Err("Refusing to write outside the clones directory.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "The clone path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create the clone directory: {error}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Unable to canonicalize the clone directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("Refusing to write outside the clones directory.".to_string());
    }

    let temp = target.with_extension("tmp");
    {
        let mut file = fs::File::create(&temp)
            .map_err(|error| format!("Unable to create the temporary clone file: {error}"))?;
        file.write_all(&data)
            .map_err(|error| format!("Unable to write the clone file: {error}"))?;
        file.flush()
            .map_err(|error| format!("Unable to flush the clone file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to sync the clone file: {error}"))?;
    }
    fs::rename(&temp, &target)
        .map_err(|error| format!("Unable to finalize the clone file: {error}"))?;

    Ok(safe_relative.to_string_lossy().into_owned())
}

/// Read `<clones>/<relative>` as bytes. A missing file is an error.
#[tauri::command]
pub fn clone_read(app: AppHandle, relative: String) -> Result<Vec<u8>, String> {
    let safe_relative = validate_relative(&relative)?;
    let root = resolve_clones_root(&app)?;
    let target = root.join(&safe_relative);
    if !target.starts_with(&root) {
        return Err("Refusing to read outside the clones directory.".to_string());
    }
    let canonical = target
        .canonicalize()
        .map_err(|error| format!("Unable to resolve the clone file: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err("Refusing to read outside the clones directory.".to_string());
    }
    fs::read(&canonical).map_err(|error| format!("Unable to read the clone file: {error}"))
}

/// Delete `<clones>/<relative>` when it exists. Missing files are not an error.
#[tauri::command]
pub fn clone_delete(app: AppHandle, relative: String) -> Result<(), String> {
    let safe_relative = validate_relative(&relative)?;
    let root = resolve_clones_root(&app)?;
    let target = root.join(&safe_relative);
    if !target.starts_with(&root) {
        return Err("Refusing to delete outside the clones directory.".to_string());
    }
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|error| format!("Unable to delete the clone file: {error}"))?;
    }
    Ok(())
}
