use crate::TrayPluginExt;

#[tauri::command]
#[specta::specta]
pub async fn set_tray_icon_visible(
    app: tauri::AppHandle<tauri::Wry>,
    visible: bool,
) -> Result<(), String> {
    app.tray().set_visible(visible).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_tray_summary(
    app: tauri::AppHandle<tauri::Wry>,
    summary: crate::TraySummary,
) -> Result<(), String> {
    app.tray().set_summary(summary).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_tray_summary() -> Result<crate::TraySummary, String> {
    Ok(crate::summary::current_summary())
}

#[tauri::command]
#[specta::specta]
pub async fn tray_action(
    app: tauri::AppHandle<tauri::Wry>,
    kind: String,
    value: Option<String>,
) -> Result<(), String> {
    crate::summary::dispatch(&app, &kind, value);
    Ok(())
}
