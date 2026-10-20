mod commands;
mod error;
mod events;
mod ext;
#[cfg(target_os = "macos")]
mod startup_migration;
mod store;

pub use error::{Error, Result};
pub use events::*;
pub use ext::*;
pub(crate) use store::*;

const PLUGIN_NAME: &str = "updater2";

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::check::<tauri::Wry>,
            commands::download::<tauri::Wry>,
            commands::install::<tauri::Wry>,
            commands::is_downloaded::<tauri::Wry>,
            commands::postinstall::<tauri::Wry>,
            commands::maybe_emit_updated::<tauri::Wry>,
        ])
        .events(tauri_specta::collect_events![
            events::UpdateAvailableEvent,
            events::UpdateDownloadingEvent,
            events::UpdateDownloadProgressEvent,
            events::UpdateDownloadFailedEvent,
            events::UpdateReadyEvent,
            events::UpdatedEvent,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            specta_builder.mount_events(app);

            #[cfg(target_os = "macos")]
            match startup_migration::maybe_schedule_legacy_bundle_rename_on_launch(app) {
                Ok(true) => std::process::exit(0),
                Ok(false) => {}
                Err(err) => tracing::error!("failed to schedule legacy bundle rename: {}", err),
            }

            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    check_and_download(&handle).await;
                    tokio::time::sleep(std::time::Duration::from_secs(30 * 60)).await;
                }
            });

            Ok(())
        })
        .build()
}

/// Reads `general.auto_update` from the user's settings. Updates are on unless
/// the user switched them off, and an unreadable settings file never blocks them.
pub(crate) fn auto_update_enabled(settings: &serde_json::Value) -> bool {
    settings
        .get("general")
        .and_then(|general| general.get("auto_update"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true)
}

async fn check_and_download<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri_plugin_settings::SettingsPluginExt;

    if cfg!(debug_assertions) {
        return;
    }

    let enabled = match app.settings().load().await {
        Ok(settings) => auto_update_enabled(&settings),
        Err(_) => true,
    };
    if !enabled {
        return;
    }

    let updater2 = app.updater2();

    let version = match updater2.check().await {
        Ok(Some(v)) => v,
        Ok(None) => return,
        Err(e) => {
            tracing::error!("update_check_failed: {}", e);
            return;
        }
    };

    if let Err(e) = updater2.download(&version).await {
        tracing::error!("update_download_failed: {}", e);
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn auto_update_defaults_to_on_and_respects_the_switch() {
        assert!(auto_update_enabled(&serde_json::json!({})));
        assert!(auto_update_enabled(&serde_json::json!({"general": {}})));
        assert!(auto_update_enabled(
            &serde_json::json!({"general": {"auto_update": true}})
        ));
        assert!(!auto_update_enabled(
            &serde_json::json!({"general": {"auto_update": false}})
        ));
        assert!(auto_update_enabled(
            &serde_json::json!({"general": {"auto_update": "no"}})
        ));
    }

    #[test]
    fn export_types() {
        const OUTPUT_FILE: &str = "./js/bindings.gen.ts";

        make_specta_builder::<tauri::Wry>()
            .export(
                specta_typescript::Typescript::default()
                    .formatter(specta_typescript::formatter::prettier)
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                OUTPUT_FILE,
            )
            .unwrap();

        let content = std::fs::read_to_string(OUTPUT_FILE).unwrap();
        std::fs::write(OUTPUT_FILE, format!("// @ts-nocheck\n{content}")).unwrap();
    }
}
