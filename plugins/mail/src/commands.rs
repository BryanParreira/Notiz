use notiz_mail::{MailAccountInfo, MailAccountInput, MailBody, MailMessage};

use crate::error::Error;

#[tauri::command]
#[specta::specta]
pub fn list_mail_accounts() -> Result<Vec<MailAccountInfo>, Error> {
    notiz_mail::list_accounts().map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn add_mail_account(input: MailAccountInput) -> Result<MailAccountInfo, Error> {
    notiz_mail::add_account(input).await.map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn remove_mail_account(id: String) -> Result<(), Error> {
    notiz_mail::remove_account(&id).await.map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn recent_mail(account_id: String, limit: u32) -> Result<Vec<MailMessage>, Error> {
    notiz_mail::recent(&account_id, limit as usize)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn mail_with(
    account_id: String,
    addresses: Vec<String>,
    limit: u32,
) -> Result<Vec<MailMessage>, Error> {
    notiz_mail::messages_with(&account_id, addresses, limit as usize)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn read_mail(account_id: String, uid: u32) -> Result<MailBody, Error> {
    notiz_mail::read(&account_id, uid).await.map_err(Into::into)
}
