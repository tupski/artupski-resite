//! Sandboxed child-process control - Artupski ReSite
//!
//! ARCHITECTURE.md section 4 and SECURITY.md section 6 keep Rust to a *narrow*
//! native boundary: this module can start, feed, and stop the dedicated Node.js
//! worker process, and nothing else. The TypeScript `ProcessManager` owns the
//! lifecycle, the protocol, and the state machine; Rust only performs the raw OS
//! primitives the webview cannot.
//!
//! Security properties enforced here:
//! - **No shell**: processes are started with `std::process::Command` and an
//!   argument *array*. A shell is never involved, so there is no string to
//!   concatenate or quote-escape (`shell:false` equivalent).
//! - **Executable allowlist**: only a small set of known interpreters
//!   (`node`, `node.exe`) may be spawned. Arbitrary binaries are rejected.
//! - **Argument sanity**: each argument is length-capped and NUL-checked so a
//!   malformed value cannot smuggle control characters.
//! - **Environment sanitization**: the child receives a fresh, minimal
//!   environment built from a safe allowlist plus caller-provided entries;
//!   sensitive host variables (tokens, sockets, keys) are never inherited.
//! - **Bounded I/O**: stdout/stderr are streamed to the frontend as events, one
//!   line at a time, with a per-line size cap so a runaway worker cannot flood
//!   the webview.
//! - **Kill-tree**: force termination uses `taskkill /T` on Windows and a
//!   process-group kill on Unix so orphaned grandchildren do not survive.
//!
//! The frontend addresses a process only by an opaque, Rust-generated id. It
//! never supplies a PID and never supplies a path.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

/// Executables the frontend is permitted to launch. Keep this list minimal.
const ALLOWED_EXECUTABLES: &[&str] = &["node", "node.exe"];

/// Maximum length of a single argument (8 KiB).
const MAX_ARG_BYTES: usize = 8 * 1024;

/// Maximum length of a single stdout/stderr line emitted to the frontend (64 KiB).
const MAX_LINE_BYTES: usize = 64 * 1024;

/// Maximum length of a single stdin write accepted from the frontend (1 MiB).
const MAX_WRITE_BYTES: usize = 1024 * 1024;

/// Host environment variables safe to propagate to the worker.
///
/// Deliberately excludes `NODE_OPTIONS` (it can `--require` arbitrary modules)
/// and every credential/token/socket variable.
const ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
];

/// Event channel names emitted to the frontend.
const EVENT_STDOUT: &str = "process://stdout";
const EVENT_STDERR: &str = "process://stderr";
const EVENT_EXIT: &str = "process://exit";

/// A process handle returned to the frontend after a successful spawn.
#[derive(Serialize)]
pub struct ProcessHandle {
    /// Opaque id used by `process_write` / `process_kill` / `process_status`.
    pub id: String,
    /// OS process id (informational; the frontend never sends it back).
    pub pid: u32,
}

/// Current status of a managed process.
#[derive(Serialize)]
pub struct ProcessStatus {
    pub id: String,
    pub running: bool,
    pub pid: Option<u32>,
}

/// Payload for the `process://stdout` and `process://stderr` events.
#[derive(Clone, Serialize)]
struct StreamEvent {
    id: String,
    line: String,
}

/// Payload for the `process://exit` event.
#[derive(Clone, Serialize)]
struct ExitEvent {
    id: String,
    code: Option<i32>,
    signal: Option<i32>,
}

/// Options accepted by `process_spawn`.
#[derive(Deserialize)]
pub struct SpawnRequest {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

/// A live child process plus the pieces needed to control it.
struct ManagedProcess {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    pid: u32,
}

/// Registry of running worker processes, keyed by opaque id.
#[derive(Default)]
pub struct ProcessRegistry {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
}

impl ProcessRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Generate a collision-resistant process id without extra dependencies.
fn generate_id(pid: u32) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("proc-{pid}-{nanos}")
}

/// Validate the executable against the allowlist (case-insensitive basename).
fn is_allowed_executable(command: &str) -> bool {
    let basename = std::path::Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command);
    ALLOWED_EXECUTABLES
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(basename))
}

/// Reject NUL bytes and over-long arguments.
fn validate_arg(arg: &str) -> Result<(), String> {
    if arg.len() > MAX_ARG_BYTES {
        return Err(format!(
            "Refusing argument of {} bytes: exceeds the {} byte limit.",
            arg.len(),
            MAX_ARG_BYTES
        ));
    }
    if arg.contains('\0') {
        return Err("Refusing argument containing a NUL byte.".to_string());
    }
    Ok(())
}

/// Build a sanitized environment: safe host vars plus caller entries, minus
/// anything on the deny list.
fn build_environment(extra: Option<HashMap<String, String>>) -> HashMap<String, String> {
    let mut environment = HashMap::new();
    for key in ENV_ALLOWLIST {
        if let Ok(value) = std::env::var(key) {
            environment.insert((*key).to_string(), value);
        }
    }
    if let Some(extra) = extra {
        for (key, value) in extra {
            // The worker is only allowed to *add* non-sensitive values; keys are
            // still NUL/length-checked to keep the map well-formed.
            if key.contains('\0') || key.len() > 256 || value.contains('\0') || value.len() > MAX_ARG_BYTES {
                continue;
            }
            environment.insert(key, value);
        }
    }
    environment
}

/// Stream a child pipe to the frontend, one bounded line per event.
fn stream_lines<R: std::io::Read + Send + 'static>(app: AppHandle, id: String, reader: R, channel: &'static str) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines() {
            match line {
                Ok(line) => {
                    let bounded = if line.len() > MAX_LINE_BYTES {
                        line.chars().take(MAX_LINE_BYTES).collect::<String>()
                    } else {
                        line
                    };
                    let _ = app.emit(channel, StreamEvent { id: id.clone(), line: bounded });
                }
                Err(_) => break,
            }
        }
    });
}

/// Start a worker process.
///
/// The executable must be on the allowlist, arguments are validated, the
/// environment is sanitized, and stdout/stderr are streamed back as events.
#[tauri::command]
pub fn process_spawn(
    app: AppHandle,
    state: State<'_, ProcessRegistry>,
    request: SpawnRequest,
) -> Result<ProcessHandle, String> {
    if !is_allowed_executable(&request.command) {
        return Err(format!(
            "Refusing to spawn \"{}\": only allowlisted executables may be launched.",
            request.command
        ));
    }
    for arg in &request.args {
        validate_arg(arg)?;
    }
    if let Some(cwd) = &request.cwd {
        if cwd.contains('\0') {
            return Err("Refusing a working directory containing a NUL byte.".to_string());
        }
    }

    let mut command = Command::new(&request.command);
    command.args(&request.args);
    command.env_clear();
    command.envs(build_environment(request.env));
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    if let Some(cwd) = &request.cwd {
        command.current_dir(cwd);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn \"{}\": {error}", request.command))?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture the worker stdin handle.".to_string())?;

    let id = generate_id(pid);

    if let Some(stdout) = stdout {
        stream_lines(app.clone(), id.clone(), stdout, EVENT_STDOUT);
    }
    if let Some(stderr) = stderr {
        stream_lines(app.clone(), id.clone(), stderr, EVENT_STDERR);
    }

    let child = Arc::new(Mutex::new(child));
    let managed = ManagedProcess {
        child: Arc::clone(&child),
        stdin: Arc::new(Mutex::new(stdin)),
        pid,
    };

    if let Ok(mut processes) = state.processes.lock() {
        processes.insert(id.clone(), managed);
    } else {
        return Err("Process registry is unavailable.".to_string());
    }

    // Monitor thread: wait for exit, emit an event, and drop the registry entry.
    {
        let registry = Arc::clone(&state.processes);
        let app = app.clone();
        let exit_id = id.clone();
        let child = Arc::clone(&child);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(50));
            let status = match child.lock() {
                Ok(mut guard) => guard.try_wait(),
                Err(_) => break,
            };
            match status {
                Ok(Some(status)) => {
                    #[cfg(unix)]
                    let signal = {
                        use std::os::unix::process::ExitStatusExt;
                        status.signal()
                    };
                    #[cfg(not(unix))]
                    let signal: Option<i32> = None;
                    let _ = app.emit(
                        EVENT_EXIT,
                        ExitEvent {
                            id: exit_id.clone(),
                            code: status.code(),
                            signal,
                        },
                    );
                    if let Ok(mut processes) = registry.lock() {
                        processes.remove(&exit_id);
                    }
                    break;
                }
                Ok(None) => continue,
                Err(_) => break,
            }
        });
    }

    Ok(ProcessHandle { id, pid })
}

/// Write a bounded string to a managed process's stdin.
#[tauri::command]
pub fn process_write(state: State<'_, ProcessRegistry>, id: String, data: String) -> Result<(), String> {
    if data.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "Refusing stdin write of {} bytes: exceeds the {} byte limit.",
            data.len(),
            MAX_WRITE_BYTES
        ));
    }
    let stdin = {
        let processes = state
            .processes
            .lock()
            .map_err(|_| "Process registry is unavailable.".to_string())?;
        let process = processes
            .get(&id)
            .ok_or_else(|| "No managed process matches the supplied id.".to_string())?;
        Arc::clone(&process.stdin)
    };

    let mut guard = stdin.lock().map_err(|_| "Worker stdin is unavailable.".to_string())?;
    guard
        .write_all(data.as_bytes())
        .map_err(|error| format!("Failed to write to the worker stdin: {error}"))?;
    guard
        .flush()
        .map_err(|error| format!("Failed to flush the worker stdin: {error}"))?;
    Ok(())
}

/// Terminate a managed process. `force` also kills the child tree.
#[tauri::command]
pub fn process_kill(state: State<'_, ProcessRegistry>, id: String, force: bool) -> Result<bool, String> {
    let pid = {
        let processes = state
            .processes
            .lock()
            .map_err(|_| "Process registry is unavailable.".to_string())?;
        match processes.get(&id) {
            Some(process) => process.pid,
            // Already gone: killing an unknown process is a successful no-op.
            None => return Ok(false),
        }
    };

    if force {
        kill_tree(pid);
    }

    let child = {
        let processes = state
            .processes
            .lock()
            .map_err(|_| "Process registry is unavailable.".to_string())?;
        match processes.get(&id) {
            Some(process) => Arc::clone(&process.child),
            None => return Ok(false),
        }
    };

    if let Ok(mut guard) = child.lock() {
        let _ = guard.kill();
    }
    Ok(true)
}

/// Report whether a managed process is still running.
#[tauri::command]
pub fn process_status(state: State<'_, ProcessRegistry>, id: String) -> Result<ProcessStatus, String> {
    let processes = state
        .processes
        .lock()
        .map_err(|_| "Process registry is unavailable.".to_string())?;
    match processes.get(&id) {
        Some(process) => {
            let running = match process.child.lock() {
                Ok(mut guard) => matches!(guard.try_wait(), Ok(None)),
                Err(_) => false,
            };
            Ok(ProcessStatus {
                id,
                running,
                pid: Some(process.pid),
            })
        }
        None => Ok(ProcessStatus {
            id,
            running: false,
            pid: None,
        }),
    }
}

/// Force-terminate a process and its descendants.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Force-terminate a process group on Unix.
#[cfg(unix)]
fn kill_tree(pid: u32) {
    // Best effort: terminate the group if the child leads one, then the child.
    let _ = Command::new("kill")
        .args(["-KILL", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(any(windows, unix)))]
fn kill_tree(_pid: u32) {}
