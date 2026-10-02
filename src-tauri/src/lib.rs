//! Artupski ReSite native core.
//!
//! The Rust layer is intentionally small: it exposes only native desktop
//! capabilities (ARCHITECTURE.md section 4). Application business logic -
//! scanning, blueprinting, AI, generation, and UI state - lives in TypeScript
//! and must never be introduced here.

use serde::Serialize;

mod asset;
mod blueprint;
mod clone;
mod process;
mod storage;

/// Static application identity returned to the frontend.
#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
}

/// Native runtime descriptor (platform/architecture).
#[derive(Serialize)]
pub struct RuntimeInfo {
    platform: String,
    arch: String,
    app_version: String,
}

/// Return the application name and version.
///
/// Read-only and side-effect free; the values come from compile-time
/// environment constants rather than user input.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Return the host platform and CPU architecture.
///
/// Used by the header status indicator so users can confirm they are running
/// in the native shell rather than the browser preview.
#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Build and run the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(process::ProcessRegistry::new())
        .invoke_handler(tauri::generate_handler![
            app_info,
            runtime_info,
            storage::storage_database_location,
            storage::storage_read_database,
            storage::storage_write_database,
            asset::asset_write,
            asset::asset_read,
            asset::asset_delete,
            clone::clone_root,
            clone::clone_write,
            clone::clone_read,
            clone::clone_delete,
            blueprint::blueprint_root,
            blueprint::blueprint_write,
            blueprint::blueprint_read,
            blueprint::blueprint_delete,
            process::process_spawn,
            process::process_write,
            process::process_kill,
            process::process_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Artupski ReSite");
}
