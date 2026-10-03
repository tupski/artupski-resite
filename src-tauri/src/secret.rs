//! OS keychain boundary for AI provider API keys - Artupski ReSite
//!
//! ARCHITECTURE.md section 4 and SECURITY.md section 2.1 keep Rust to a *narrow*
//! native boundary. This module exposes exactly four commands over the operating
//! system's credential store (`keyring` crate): availability probe, read, write,
//! and delete. It never owns provider logic, never talks to the network, and
//! never touches the application database.
//!
//! Security properties enforced here:
//! - **Fixed service id.** The service name is hard-coded
//!   (`com.artupski.resite.apikeys`); the frontend never supplies a service,
//!   path, executable, or target. There is no generic secret-store passthrough.
//! - **Bounded account slug.** The caller-supplied account must match
//!   `^[a-z0-9_-]{1,64}$`; anything else is rejected before the store is touched.
//! - **Fail closed.** A keyring error is returned as a typed failure. The key is
//!   NEVER written to a plaintext fallback, and the secret value is NEVER logged.
//! - **Bounded value.** Writes are size-capped so an oversized payload fails
//!   cleanly instead of hitting an opaque platform error.
//!
//! A missing entry is not an error: `secret_get` returns `None` and
//! `secret_delete` succeeds (deleting an absent key is idempotent).

/// Hard-coded service identifier. The frontend cannot influence this value.
const SERVICE_ID: &str = "com.artupski.resite.apikeys";

/// Maximum length of an account slug (the provider id).
const MAX_ACCOUNT_LEN: usize = 64;

/// Upper bound for a single secret value (bytes). Windows Credential Manager
/// caps a credential blob at 2560 bytes; staying under that keeps behavior
/// consistent across platforms and rejects a runaway payload before it reaches
/// the OS store.
const MAX_SECRET_BYTES: usize = 2560;

/// Account used for the non-destructive availability probe. It is never
/// written; `get_password` merely confirms the store is reachable.
const AVAILABILITY_PROBE_ACCOUNT: &str = "availability-probe";

/// Validate an account slug against `^[a-z0-9_-]{1,64}$`.
///
/// The allowed characters are all ASCII, so a byte-wise check also rejects any
/// non-ASCII input. An empty or over-long account is rejected too.
fn validate_account(account: &str) -> Result<(), String> {
    if account.is_empty() {
        return Err("Secret account must not be empty.".to_string());
    }
    if account.len() > MAX_ACCOUNT_LEN {
        return Err(format!(
            "Secret account must be at most {MAX_ACCOUNT_LEN} characters."
        ));
    }
    let valid = account
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-');
    if !valid {
        return Err(
            "Secret account may only contain lowercase letters, digits, '-' and '_'.".to_string(),
        );
    }
    Ok(())
}

/// Open a keyring entry for the fixed service + validated account.
fn open_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_ID, account)
        .map_err(|_| "Unable to open the OS credential store.".to_string())
}

/// Report whether an OS secret store is usable in this environment.
///
/// This is a non-destructive probe: opening an entry and reading it returns
/// `NoEntry` when the store is reachable but empty (still available), while a
/// storage-access or platform failure means no usable store exists.
#[tauri::command]
pub fn secret_available() -> bool {
    match keyring::Entry::new(SERVICE_ID, AVAILABILITY_PROBE_ACCOUNT) {
        Ok(entry) => match entry.get_password() {
            Ok(_) => true,
            Err(keyring::Error::NoEntry) => true,
            Err(_) => false,
        },
        Err(_) => false,
    }
}

/// Read a secret; `None` when no entry exists. The value is never logged.
#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    validate_account(&account)?;
    let entry = open_entry(&account)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Unable to read the secret from the OS credential store.".to_string()),
    }
}

/// Write (or replace) a secret. An empty value deletes the entry instead.
///
/// The value is never logged and is never persisted anywhere but the OS store.
#[tauri::command]
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    validate_account(&account)?;
    if value.is_empty() {
        return secret_delete(account);
    }
    if value.len() > MAX_SECRET_BYTES {
        return Err(format!(
            "Refusing to store a secret larger than {MAX_SECRET_BYTES} bytes."
        ));
    }
    let entry = open_entry(&account)?;
    entry
        .set_password(&value)
        .map_err(|_| "Unable to write the secret to the OS credential store.".to_string())
}

/// Delete a secret. A missing entry is treated as success (idempotent).
#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    validate_account(&account)?;
    let entry = open_entry(&account)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Unable to delete the secret from the OS credential store.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_account_slugs() {
        for account in ["openai", "a", "provider-1", "my_provider_2", &"a".repeat(64)] {
            assert!(validate_account(account).is_ok(), "{account} should be valid");
        }
    }

    #[test]
    fn rejects_invalid_account_slugs() {
        for account in ["", "OpenAI", "a b", "a.b", "a/b", "héllo", &"a".repeat(65)] {
            assert!(
                validate_account(account).is_err(),
                "{account} should be rejected"
            );
        }
    }
}
