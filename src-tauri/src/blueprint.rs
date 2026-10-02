//! Sandboxed Blueprint document file I/O - Artupski ReSite
//!
//! ARCHITECTURE.md section 4 keeps Rust to native desktop capabilities only.
//! This module is the narrow boundary for generated **Blueprint JSON documents**
//! (Phase 9): it writes, reads, and deletes files ONLY beneath a fixed
//! `<app_local_data_dir>/blueprints` root. It never executes SQL, never serves
//! HTTP, and never reads or writes the application database.
//!
//! Security properties enforced here (mirrors `clone.rs`/`asset.rs`):
//! - The frontend supplies a blueprint *id* only; the root is always
//!   `<app_local_data_dir>/blueprints` and the file is `<blueprints>/v1/<id>.json`.
//! - The id is rejected when it is empty, absolute, contains a path separator,
//!   or is a `.`/`..` component, so it cannot escape the sandbox.
//! - The resolved target is canonicalized and re-verified to stay inside the
//!   canonical blueprints root (defence in depth against symlinks).
//! - Writes are atomic (temp file + rename) and size-capped (64 MiB).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Subdirectory (under app-local-data) that all blueprint I/O is confined to.
const BLUEPRINTS_DIR_NAME: &str = "blueprints";

/// Document revision subdirectory (mirrors the spec's `blueprint.v1.json`).
const BLUEPRINTS_VERSION_DIR: &str = "v1";

/// Upper bound for a single Blueprint document payload (64 MiB).
const MAX_BLUEPRINT_BYTES: usize = 64 * 1024 * 1024;

/// Validate a caller-supplied blueprint id and reject anything that could
/// escape the blueprints sandbox. The id must be a single safe path segment.
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Blueprint id must not be empty.".to_string());
    }
    if id == "." || id == ".." {
        return Err("Blueprint id must not be '.' or '..'.".to_string());
    }
    if Path::new(id).is_absolute() {
        return Err("Blueprint id must not be absolute.".to_string());
    }
    if id.contains('/') || id.contains('\\') || id.contains('\0') {
        return Err("Blueprint id must not contain a path separator.".to_string());
    }
    Ok(())
}

/// Resolve the canonical blueprints root, creating it when missing.
fn resolve_blueprints_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve the application local data directory: {error}"))?;

    let root = base.join(BLUEPRINTS_DIR_NAME);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create the blueprints directory: {error}"))?;
    root.canonicalize()
        .map_err(|error| format!("Unable to canonicalize the blueprints directory: {error}"))
}

/// Resolve `<blueprints>/v1/<id>.json`, verifying containment before any I/O.
fn resolve_target(app: &AppHandle, id: &str) -> Result<(PathBuf, PathBuf), String> {
    validate_id(id)?;
    let root = resolve_blueprints_root(app)?;
    let version_dir = root.join(BLUEPRINTS_VERSION_DIR);
    let target = version_dir.join(format!("{id}.json"));
    // Containment check after joining, before any filesystem access.
    if !target.starts_with(&root) {
        return Err("Refusing to access a path outside the blueprints directory.".to_string());
    }
    Ok((root, target))
}

/// Return the absolute blueprints root so tooling can locate the document tree.
#[tauri::command]
pub fn blueprint_root(app: AppHandle) -> Result<String, String> {
    let root = resolve_blueprints_root(&app)?;
    Ok(root.to_string_lossy().into_owned())
}

/// Write `data` to `<blueprints>/v1/<id>.json` atomically, creating the version
/// directory when missing.
#[tauri::command]
pub fn blueprint_write(app: AppHandle, id: String, data: Vec<u8>) -> Result<String, String> {
    if data.len() > MAX_BLUEPRINT_BYTES {
        return Err(format!(
            "Refusing to write {} bytes: the blueprint exceeds the {} byte limit.",
            data.len(),
            MAX_BLUEPRINT_BYTES
        ));
    }

    let (root, target) = resolve_target(&app, &id)?;
    let parent = target
        .parent()
        .ok_or_else(|| "The blueprint path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create the blueprint directory: {error}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Unable to canonicalize the blueprint directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("Refusing to write outside the blueprints directory.".to_string());
    }

    let temp = target.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temp)
            .map_err(|error| format!("Unable to create the temporary blueprint file: {error}"))?;
        file.write_all(&data)
            .map_err(|error| format!("Unable to write the blueprint file: {error}"))?;
        file.flush()
            .map_err(|error| format!("Unable to flush the blueprint file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to sync the blueprint file: {error}"))?;
    }
    fs::rename(&temp, &target)
        .map_err(|error| format!("Unable to finalize the blueprint file: {error}"))?;

    Ok(format!("{BLUEPRINTS_VERSION_DIR}/{id}.json"))
}

/// Read `<blueprints>/v1/<id>.json` as bytes. A missing file is an error.
#[tauri::command]
pub fn blueprint_read(app: AppHandle, id: String) -> Result<Vec<u8>, String> {
    let (root, target) = resolve_target(&app, &id)?;
    let canonical = target
        .canonicalize()
        .map_err(|error| format!("Unable to resolve the blueprint file: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err("Refusing to read outside the blueprints directory.".to_string());
    }
    fs::read(&canonical).map_err(|error| format!("Unable to read the blueprint file: {error}"))
}

/// Delete `<blueprints>/v1/<id>.json` when it exists. Missing files are not an
/// error.
#[tauri::command]
pub fn blueprint_delete(app: AppHandle, id: String) -> Result<(), String> {
    let (root, target) = resolve_target(&app, &id)?;
    if target.exists() {
        let canonical = target
            .canonicalize()
            .map_err(|error| format!("Unable to resolve the blueprint file: {error}"))?;
        if !canonical.starts_with(&root) {
            return Err("Refusing to delete outside the blueprints directory.".to_string());
        }
        fs::remove_file(&canonical)
            .map_err(|error| format!("Unable to delete the blueprint file: {error}"))?;
    }
    Ok(())
}
