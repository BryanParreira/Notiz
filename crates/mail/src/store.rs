use serde::{Deserialize, Serialize};

use crate::error::Error;

const SERVICE: &str = "com.notiz.app.mail";
const ENTRY: &str = "accounts";

// All accounts share one keychain item so macOS asks for access once, and one
// lock keeps read-modify-write cycles from racing.
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

fn entry() -> Result<keyring::Entry, Error> {
    keyring::Entry::new(SERVICE, ENTRY).map_err(|e| Error::Keychain(e.to_string()))
}

pub(crate) fn load() -> Result<Vec<StoredAccount>, Error> {
    match entry()?.get_password() {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| Error::Keychain(e.to_string())),
        Err(keyring::Error::NoEntry) => Ok(Vec::new()),
        Err(e) => Err(Error::Keychain(e.to_string())),
    }
}

pub(crate) fn save(accounts: &[StoredAccount]) -> Result<(), Error> {
    let raw = serde_json::to_string(accounts).map_err(|e| Error::Keychain(e.to_string()))?;
    entry()?
        .set_password(&raw)
        .map_err(|e| Error::Keychain(e.to_string()))
}
