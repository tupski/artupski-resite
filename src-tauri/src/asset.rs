//! Sandboxed asset file I/O - Artupski ReSite
//!
//! ARCHITECTURE.md section 4 keeps Rust to native desktop capabilities only.
//! This module implements a *narrow* boundary for generated binary assets (e.g.
//! responsive screenshots): it writes and deletes files ONLY beneath a fixed
//! `<app_local_data_dir>/assets` root. It never executes SQL, never serves HTTP,
//! and never reads or writes the application database.
//!
//! Security properties enforced here:
//! - The frontend supplies a *relative* path only; the root is always
//!   `<app_local_data_dir>/assets`.
//! - The relative path is rejected when it is absolute or contains a `..`,
//!   empty, or platform-specific separator component, so it cannot escape the
//!   sandbox.
//! - The resolved target is canonicalized and re-verified to stay inside the
//!   canonical assets root (defence in depth against symlinks).
//! - Writes are atomic (temp file + rename) and size-capped (16 MiB).

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Subdirectory (under app-local-data) that all asset I/O is confined to.
const ASSETS_DIR_NAME: &str = "assets";

/// Upper bound for a single asset payload (16 MiB).
const MAX_ASSET_BYTES: usize = 16 * 1024 * 1024;

/// Validate a caller-supplied relative path and reject anything that could
/// escape the assets sandbox.
fn validate_relative(relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("Asset path must not be empty.".to_string());
    }
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return Err("Asset path must be relative.".to_string());
    }
    let mut safe = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            _ => {
                return Err(
                    "Asset path must not contain '..' or root components.".to_string(),
                )
            }
        }
    }
    if safe.as_os_str().is_empty() {
        return Err("Asset path must name a file.".to_string());
    }
    Ok(safe)
}

/// Resolve the canonical assets root, creating it when missing.
fn resolve_assets_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve the application local data directory: {error}"))?;

    let root = base.join(ASSETS_DIR_NAME);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create the assets directory: {error}"))?;
    root.canonicalize()
        .map_err(|error| format!("Unable to canonicalize the assets directory: {error}"))
}

/// Write `data` to `<assets>/<relative>` atomically, creating parent directories.
#[tauri::command]
pub fn asset_write(app: AppHandle, relative: String, data: Vec<u8>) -> Result<String, String> {
    if data.len() > MAX_ASSET_BYTES {
        return Err(format!(
            "Refusing to write {} bytes: the asset exceeds the {} byte limit.",
            data.len(),
            MAX_ASSET_BYTES
        ));
    }

    let safe_relative = validate_relative(&relative)?;
    let root = resolve_assets_root(&app)?;
    let target = root.join(&safe_relative);

    // Containment check after joining, before any filesystem write.
    if !target.starts_with(&root) {
        return Err("Refusing to write outside the assets directory.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "The asset path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create the asset directory: {error}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Unable to canonicalize the asset directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("Refusing to write outside the assets directory.".to_string());
    }

    let temp = target.with_extension("tmp");
    {
        let mut file = fs::File::create(&temp)
            .map_err(|error| format!("Unable to create the temporary asset file: {error}"))?;
        file.write_all(&data)
            .map_err(|error| format!("Unable to write the asset file: {error}"))?;
        file.flush()
            .map_err(|error| format!("Unable to flush the asset file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to sync the asset file: {error}"))?;
    }
    fs::rename(&temp, &target)
        .map_err(|error| format!("Unable to finalize the asset file: {error}"))?;

    Ok(safe_relative.to_string_lossy().into_owned())
}

/// Read `<assets>/<relative>` and return its raw bytes.
///
/// Phase 13 (visual verification) must decode the original responsive capture
/// PNG that Phase 7 wrote under the assets sandbox. This is a READ-only command
/// and enforces exactly the same validation and containment rules as
/// `asset_write`: the relative path is rejected when absolute or containing
/// `..`, and the resolved target is re-verified inside the canonical assets root.
#[tauri::command]
pub fn asset_read(app: AppHandle, relative: String) -> Result<Vec<u8>, String> {
    let safe_relative = validate_relative(&relative)?;
    let root = resolve_assets_root(&app)?;
    let target = root.join(&safe_relative);
    if !target.starts_with(&root) {
        return Err("Refusing to read outside the assets directory.".to_string());
    }
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("Unable to resolve the asset file: {error}"))?;
    if !canonical_target.starts_with(&root) {
        return Err("Refusing to read outside the assets directory.".to_string());
    }
    fs::read(&canonical_target)
        .map_err(|error| format!("Unable to read the asset file: {error}"))
}

/// Delete `<assets>/<relative>` when it exists. Missing files are not an error.
#[tauri::command]
pub fn asset_delete(app: AppHandle, relative: String) -> Result<(), String> {
    let safe_relative = validate_relative(&relative)?;
    let root = resolve_assets_root(&app)?;
    let target = root.join(&safe_relative);
    if !target.starts_with(&root) {
        return Err("Refusing to delete outside the assets directory.".to_string());
    }
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|error| format!("Unable to delete the asset file: {error}"))?;
    }
    Ok(())
}
