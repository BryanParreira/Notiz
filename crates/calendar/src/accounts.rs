use notiz_calendar_interface::CalendarProviderType;
use serde::{Deserialize, Serialize};

use crate::error::Error;

const SERVICE: &str = "com.notiz.app.calendar";
const ENTRY: &str = "accounts";

// One lock for the whole read-modify-write cycle: refreshes and sign-ins can
// race, and the accounts live in a single keychain item.
pub(crate) static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredAccount {
    pub provider: CalendarProviderType,
    pub connection_id: String,
    pub label: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    /// Private iCal link for `Ics` accounts. It is a secret, so it lives in the
    /// keychain with the rest.
    #[serde(default)]
    pub url: Option<String>,
}

// Tokens and the private calendar link must never end up in a log line.
impl std::fmt::Debug for StoredAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredAccount")
            .field("provider", &self.provider)
            .field("connection_id", &self.connection_id)
            .field("label", &self.label)
            .field("secrets", &"<redacted>")
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
