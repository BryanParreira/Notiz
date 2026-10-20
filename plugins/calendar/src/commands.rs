use notiz_calendar_interface::{
    CalendarEvent, CalendarListItem, CalendarProviderType, CreateEventInput, EventFilter,
};
use tauri_plugin_permissions::PermissionsPluginExt;

use crate::error::Error;

#[tauri::command]
#[specta::specta]
pub fn available_providers() -> Vec<CalendarProviderType> {
    notiz_calendar::available_providers()
}

#[tauri::command]
#[specta::specta]
pub async fn is_provider_enabled<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
) -> Result<bool, Error> {
    let apple = is_apple_authorized(&app).await?;
    notiz_calendar::is_provider_enabled(apple, provider)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_connection_ids<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<notiz_calendar::ProviderConnectionIds>, Error> {
    let apple = is_apple_authorized(&app).await?;
    notiz_calendar::list_connection_ids(apple)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn list_accounts() -> Result<Vec<notiz_calendar::AccountInfo>, Error> {
    notiz_calendar::list_accounts().map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn connect_account<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
) -> Result<notiz_calendar::AccountInfo, Error> {
    use tauri_plugin_opener::OpenerExt;

    notiz_calendar::connect_account(provider, |url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn add_ics_account(
    url: String,
    label: Option<String>,
) -> Result<notiz_calendar::AccountInfo, Error> {
    notiz_calendar::add_ics_account(url, label)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn disconnect_account(
    provider: CalendarProviderType,
    connection_id: String,
) -> Result<(), Error> {
    notiz_calendar::disconnect_account(provider, &connection_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_calendars(
    provider: CalendarProviderType,
    connection_id: String,
) -> Result<Vec<CalendarListItem>, Error> {
    notiz_calendar::list_calendars(provider, &connection_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_events(
    provider: CalendarProviderType,
    connection_id: String,
    filter: EventFilter,
) -> Result<Vec<CalendarEvent>, Error> {
    notiz_calendar::list_events(provider, &connection_id, filter)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn open_calendar<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
) -> Result<(), Error> {
    notiz_calendar::open_calendar(provider).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn create_event<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
    input: CreateEventInput,
) -> Result<String, Error> {
    notiz_calendar::create_event(provider, input).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn parse_meeting_link(text: String) -> Option<String> {
    notiz_calendar::parse_meeting_link(&text)
}

async fn is_apple_authorized<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<bool, Error> {
    #[cfg(target_os = "macos")]
    {
        let status = app
            .permissions()
            .check(tauri_plugin_permissions::Permission::Calendar)
            .await
            .map_err(|e| notiz_calendar::Error::Api(e.to_string()))?;
        Ok(matches!(
            status,
            tauri_plugin_permissions::PermissionStatus::Authorized
        ))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
}
