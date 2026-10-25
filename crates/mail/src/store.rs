use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::error::Error;

const SERVICE: &str = "com.notiz.app.mail";
// Before the account list moved to a file, every account (password included)
// lived in this single Keychain item.
const LEGACY_ENTRY: &str = "accounts";
const META_FILE: &str = "mail-accounts.json";

// One lock keeps read-modify-write cycles from racing.
pub(crate) static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredAccount {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

// Never print the password, even if an account is logged by mistake.
impl std::fmt::Debug for StoredAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredAccount")
            .field("id", &self.id)
            .field("host", &self.host)
            .field("username", &self.username)
            .field("password", &"<redacted>")
            .finish_non_exhaustive()
    }
}

/// Everything about an account except its password. Kept in a plain file so
/// listing accounts never needs the Keychain, and macOS only asks for access
/// when a password is actually needed to fetch mail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AccountMeta {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

impl From<&StoredAccount> for AccountMeta {
    fn from(a: &StoredAccount) -> Self {
        Self {
            id: a.id.clone(),
            label: a.label.clone(),
            host: a.host.clone(),
            port: a.port,
            username: a.username.clone(),
        }
    }
}

#[derive(Default)]
struct State {
    meta: Option<Vec<AccountMeta>>,
    passwords: HashMap<String, String>,
}

// Each Keychain read can show a macOS permission prompt, so passwords are read
// once per launch and kept in memory.
static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::default()));

fn state() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn keychain_error(e: impl std::fmt::Display) -> Error {
    Error::Keychain(e.to_string())
}

fn entry(name: &str) -> Result<keyring::Entry, Error> {
    keyring::Entry::new(SERVICE, name).map_err(keychain_error)
}

fn password_entry(id: &str) -> Result<keyring::Entry, Error> {
    entry(&format!("account:{id}"))
}

fn meta_path() -> Result<PathBuf, Error> {
    let dir = dirs::data_dir()
        .ok_or_else(|| keychain_error("no application data folder"))?
        .join("com.notiz.app");
    Ok(dir.join(META_FILE))
}

fn read_meta_file() -> Result<Option<Vec<AccountMeta>>, Error> {
    match std::fs::read_to_string(meta_path()?) {
        Ok(raw) => serde_json::from_str(&raw).map(Some).map_err(keychain_error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(keychain_error(e)),
    }
}

fn write_meta_file(meta: &[AccountMeta]) -> Result<(), Error> {
    let path = meta_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(keychain_error)?;
    }
    let raw = serde_json::to_string_pretty(meta).map_err(keychain_error)?;

    // Write beside the target and rename, so a crash never leaves half a file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(keychain_error)?;
    std::fs::rename(&tmp, &path).map_err(keychain_error)
}

pub(crate) fn split_legacy(
    accounts: Vec<StoredAccount>,
) -> (Vec<AccountMeta>, Vec<(String, String)>) {
    let meta = accounts.iter().map(AccountMeta::from).collect();
    let passwords = accounts.into_iter().map(|a| (a.id, a.password)).collect();
    (meta, passwords)
}

// Runs once, the first time accounts are listed after an upgrade. This is the
// only read of the old combined Keychain item, so it is the only time macOS can
// ask just because accounts were listed.
fn migrate_legacy(state: &mut State) -> Result<Vec<AccountMeta>, Error> {
    let legacy: Vec<StoredAccount> = match entry(LEGACY_ENTRY)?.get_password() {
        Ok(raw) => serde_json::from_str(&raw).map_err(keychain_error)?,
        Err(keyring::Error::NoEntry) => Vec::new(),
        Err(e) => return Err(keychain_error(e)),
    };

    let (meta, passwords) = split_legacy(legacy);
    for (id, password) in &passwords {
        password_entry(id)?
            .set_password(password)
            .map_err(keychain_error)?;
        state.passwords.insert(id.clone(), password.clone());
    }
    write_meta_file(&meta)?;

    if !passwords.is_empty() {
        let _ = entry(LEGACY_ENTRY).and_then(|e| e.delete_credential().map_err(keychain_error));
    }
    Ok(meta)
}

fn load_meta(state: &mut State) -> Result<Vec<AccountMeta>, Error> {
    if let Some(meta) = &state.meta {
        return Ok(meta.clone());
    }

    let meta = match read_meta_file()? {
        Some(meta) => meta,
        None => migrate_legacy(state)?,
    };
    state.meta = Some(meta.clone());
    Ok(meta)
}

/// Accounts without passwords. Never touches the Keychain after the one-time
/// migration.
pub(crate) fn list() -> Result<Vec<AccountMeta>, Error> {
    load_meta(&mut state())
}

/// One account with its password, read from the Keychain on first use.
pub(crate) fn get(id: &str) -> Result<StoredAccount, Error> {
    let mut state = state();
    let meta = load_meta(&mut state)?
        .into_iter()
        .find(|m| m.id == id)
        .ok_or(Error::AccountNotFound)?;

    let password = match state.passwords.get(id) {
        Some(password) => password.clone(),
        None => {
            let password = match password_entry(id)?.get_password() {
                Ok(password) => password,
                Err(keyring::Error::NoEntry) => {
                    return Err(keychain_error("the saved password was not found"));
                }
                Err(e) => return Err(keychain_error(e)),
            };
            state.passwords.insert(id.to_string(), password.clone());
            password
        }
    };

    Ok(StoredAccount {
        id: meta.id,
        label: meta.label,
        host: meta.host,
        port: meta.port,
        username: meta.username,
        password,
    })
}

pub(crate) fn add(account: StoredAccount) -> Result<(), Error> {
    let mut state = state();
    let mut meta = load_meta(&mut state)?;

    password_entry(&account.id)?
        .set_password(&account.password)
        .map_err(keychain_error)?;

    meta.push(AccountMeta::from(&account));
    write_meta_file(&meta)?;
    state.passwords.insert(account.id, account.password);
    state.meta = Some(meta);
    Ok(())
}

pub(crate) fn remove(id: &str) -> Result<(), Error> {
    let mut state = state();
    let mut meta = load_meta(&mut state)?;
    meta.retain(|m| m.id != id);
    write_meta_file(&meta)?;
    state.meta = Some(meta);
    state.passwords.remove(id);

    match password_entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_error(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_accounts_split_into_a_file_part_and_secrets() {
        let (meta, passwords) = split_legacy(vec![StoredAccount {
            id: "a1".into(),
            label: "Work".into(),
            host: "imap.example.com".into(),
            port: 993,
            username: "me@example.com".into(),
            password: "secret".into(),
        }]);

        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].host, "imap.example.com");
        assert_eq!(passwords, vec![("a1".to_string(), "secret".to_string())]);

        let json = serde_json::to_string(&meta).unwrap();
        assert!(
            !json.contains("secret"),
            "the file part must hold no password"
        );
    }
}
