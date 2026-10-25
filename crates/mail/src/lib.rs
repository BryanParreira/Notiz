mod client;
mod error;
mod store;

use serde::{Deserialize, Serialize};

pub use error::Error;

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MailAccountInput {
    pub label: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

// Never print the password, even if the input is logged by mistake.
impl std::fmt::Debug for MailAccountInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MailAccountInput")
            .field("host", &self.host)
            .field("username", &self.username)
            .field("password", &"<redacted>")
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MailAccountInfo {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MailMessage {
    pub uid: u32,
    pub subject: String,
    pub from_name: String,
    pub from_email: String,
    /// RFC 3339, empty when the server gave no date.
    pub date: String,
    pub seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MailBody {
    pub uid: u32,
    pub subject: String,
    pub from_name: String,
    pub from_email: String,
    pub to: String,
    /// RFC 3339, empty when the message has no parsable date.
    pub date: String,
    /// Plain-text rendition, used when a message has no HTML part.
    pub text: String,
    /// HTML part with `cid:` images replaced by embedded data URIs. Empty when
    /// the message is plain text. The frontend sanitizes it and renders it in a
    /// sandboxed frame.
    pub html: String,
    pub truncated: bool,
}

impl From<&store::AccountMeta> for MailAccountInfo {
    fn from(a: &store::AccountMeta) -> Self {
        Self {
            id: a.id.clone(),
            label: a.label.clone(),
            host: a.host.clone(),
            port: a.port,
            username: a.username.clone(),
        }
    }
}

pub fn list_accounts() -> Result<Vec<MailAccountInfo>, Error> {
    Ok(store::list()?.iter().map(MailAccountInfo::from).collect())
}

/// Verifies the credentials against the server before anything is stored.
pub async fn add_account(input: MailAccountInput) -> Result<MailAccountInfo, Error> {
    if input.host.trim().is_empty() || input.username.trim().is_empty() {
        return Err(Error::Invalid("host and username are required"));
    }

    let account = store::StoredAccount {
        id: uuid::Uuid::new_v4().to_string(),
        label: input
            .label
            .filter(|l| !l.trim().is_empty())
            .unwrap_or_else(|| input.username.clone()),
        host: input.host.trim().to_string(),
        port: input.port,
        username: input.username.trim().to_string(),
        password: input.password,
    };

    client::verify(&account).await?;

    let _guard = store::LOCK.lock().await;
    let info = MailAccountInfo::from(&store::AccountMeta::from(&account));
    store::add(account)?;
    Ok(info)
}

pub async fn remove_account(id: &str) -> Result<(), Error> {
    let _guard = store::LOCK.lock().await;
    store::remove(id)?;
    client::forget(id);
    Ok(())
}

/// Newest messages in the inbox. The mailbox is opened read-only and message
/// bodies are never fetched.
pub async fn recent(account_id: &str, limit: usize) -> Result<Vec<MailMessage>, Error> {
    client::search(find(account_id).await?, None, limit).await
}

/// Newest inbox messages sent to or from any of `addresses`.
pub async fn messages_with(
    account_id: &str,
    addresses: Vec<String>,
    limit: usize,
) -> Result<Vec<MailMessage>, Error> {
    let addresses = client::sanitize_addresses(addresses);
    if addresses.is_empty() {
        return Ok(Vec::new());
    }
    client::search(find(account_id).await?, Some(addresses), limit).await
}

/// Reads one message for preview. The mailbox is opened read-only and the body
/// is fetched with PEEK, so nothing is marked as read on the server.
pub async fn read(account_id: &str, uid: u32) -> Result<MailBody, Error> {
    client::read_message(find(account_id).await?, uid).await
}

async fn find(account_id: &str) -> Result<store::StoredAccount, Error> {
    store::get(account_id)
}
