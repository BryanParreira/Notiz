mod agents;
mod appearance;
mod commands;
mod db;
mod ext;
mod store;
mod supervisor;

use db::open_desktop_db;
use ext::*;
use store::*;

use tauri::Manager;
use tauri_plugin_permissions::{Permission, PermissionsPluginExt};
use tauri_plugin_windows::{AppWindow, WindowsPluginExt};

#[cfg(any(feature = "dev", feature = "devtools"))]
const STAGING_BUNDLE_ID: &str = "com.notiz.staging";

fn create_audio_provider(
    _bundle_id: &str,
) -> std::sync::Arc<dyn notiz_audio_actual::AudioProvider> {
    #[cfg(any(feature = "dev", feature = "devtools"))]
    {
        let bundle_id = _bundle_id;
        let selection: u32 = std::env::var("MOCK_AUDIO")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        let mock_audio_allowed = cfg!(feature = "dev") || bundle_id == STAGING_BUNDLE_ID;

        if mock_audio_allowed && selection > 0 {
            return std::sync::Arc::new(notiz_audio_mock::MockAudio::new(selection));
        }
    }
    std::sync::Arc::new(notiz_audio_actual::ActualAudio)
}

#[tokio::main]
pub async fn main() {
    tauri::async_runtime::set(tokio::runtime::Handle::current());
    let context = tauri::generate_context!();

    let (root_supervisor_ctx, root_supervisor_handle) =
        match supervisor::spawn_root_supervisor().await {
            Some((ctx, handle)) => (Some(ctx), Some(handle)),
            None => (None, None),
        };

    // Notiz is local-only: no crash or telemetry reporting is ever initialised.
    let sentry_client: Option<sentry::ClientInitGuard> = None;

    let _guard = sentry_client
        .as_ref()
        .map(|client| tauri_plugin_sentry::minidump::init(client));

    let audio: std::sync::Arc<dyn notiz_audio_actual::AudioProvider> =
        create_audio_provider(&context.config().identifier);

    let db = open_desktop_db(&context.config().identifier).await;

    let mut builder = tauri_plugin_windows::extend_builder(tauri::Builder::default())
        .manage(audio)
        .manage(db.clone());

    // https://docs.crabnebula.dev/plugins/tauri-e2e-tests/#macos-support
    #[cfg(all(target_os = "macos", feature = "automation"))]
    {
        builder = builder.plugin(tauri_plugin_automation::init());
    }

    // https://v2.tauri.app/plugin/deep-linking/#desktop
    // should always be the first plugin
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            app.windows().show(AppWindow::Main).unwrap();
        }));
    }

    builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_opener2::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_analytics::init())
        .plugin(tauri_plugin_agent::init())
        .plugin(tauri_plugin_auth::init())
        .plugin(tauri_plugin_db::init(db.clone()))
        .plugin(tauri_plugin_bedrock::init())
        .plugin(tauri_plugin_importer::init())
        .plugin(tauri_plugin_calendar::init())
        .plugin(tauri_plugin_mail::init())
        .plugin(tauri_plugin_todo::init())
        .plugin(tauri_plugin_tracing::init())
        .plugin(tauri_plugin_hooks::init())
        .plugin(tauri_plugin_icon::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sidecar2::init())
        .plugin(tauri_plugin_permissions::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_deeplink2::init())
        .plugin(tauri_plugin_fs_sync::init())
        .plugin(tauri_plugin_fs2::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_path2::init())
        .plugin(tauri_plugin_export::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_mcp::init())
        .plugin(tauri_plugin_messenger::init())
        .plugin(tauri_plugin_misc::init())
        .plugin(tauri_plugin_template::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_detect::init())
        .plugin(tauri_plugin_dock::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_notify::init())
        .plugin(tauri_plugin_overlay::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_store2::init())
        .plugin(tauri_plugin_updater2::init())
        .plugin(tauri_plugin_tray::init())
        .plugin(tauri_plugin_settings::init())
        .plugin(tauri_plugin_sfx::init())
        .plugin(tauri_plugin_shortcut::init())
        .plugin(tauri_plugin_dictation::init())
        .plugin(tauri_plugin_windows::init())
        .plugin(tauri_plugin_js::init())
        .plugin(tauri_plugin_flag::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_transcription::init())
        .plugin(tauri_plugin_tantivy::init())
        .plugin(tauri_plugin_audio_priority::init())
        .plugin(tauri_plugin_local_llm::init())
        .plugin(tauri_plugin_local_stt::init(
            tauri_plugin_local_stt::InitOptions {
                parent_supervisor: root_supervisor_ctx
                    .as_ref()
                    .map(|ctx| ctx.supervisor.get_cell()),
            },
        ))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ));

    if let Some(client) = sentry_client.as_ref() {
        builder = builder.plugin(tauri_plugin_sentry::init_with_no_injection(client));
    }

    #[cfg(any(debug_assertions, feature = "devtools"))]
    {
        builder = builder.plugin(tauri_plugin_relay::init());
    }

    #[cfg(all(not(debug_assertions), not(feature = "devtools")))]
    {
        let plugin = tauri_plugin_prevent_default::init();
        builder = builder.plugin(plugin);
    }

    let specta_builder = make_specta_builder::<tauri::Wry>();

    let root_supervisor_ctx_for_run = root_supervisor_ctx.clone();

    let app = builder
        .invoke_handler(specta_builder.invoke_handler())
        .on_window_event(tauri_plugin_windows::on_window_event)
        .setup(move |app| {
            let app_handle = app.handle().clone();

            specta_builder.mount_events(&app_handle);

            #[cfg(any(windows, target_os = "linux"))]
            {
                // https://v2.tauri.app/ko/plugin/deep-linking/#desktop-1
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            {
                use tauri_plugin_tray::TrayPluginExt;
                use tauri_plugin_windows::WindowsPluginExt;

                let appearance_settings =
                    appearance::load_app_appearance_settings::<tauri::Wry, _>(&app_handle);

                app_handle
                    .windows()
                    .set_show_app_in_dock(appearance_settings.show_app_in_dock)
                    .unwrap();

                if appearance_settings.show_tray_icon {
                    app_handle.tray().create_tray_menu().unwrap();
                }
                app_handle.tray().create_app_menu().unwrap();
            }

            {
                use tauri_plugin_tray::NotizMenuItem;
                app_handle.on_menu_event(|app, event| {
                    if let Ok(item) = NotizMenuItem::try_from(event.id().clone()) {
                        item.handle(app);
                    }
                });
            }

            {
                use tauri_plugin_settings::SettingsPluginExt;
                if let Ok(base) = app_handle.settings().vault_base()
                    && let Err(e) = agents::write_agents_file(base.as_std_path())
                {
                    tracing::error!("failed to write AGENTS.md: {}", e);
                }
            }

            if let (Some(ctx), Some(handle)) = (&root_supervisor_ctx, root_supervisor_handle) {
                supervisor::monitor_supervisor(handle, ctx.is_exiting.clone(), app_handle.clone());
            }

            {
                // Prefetch the default local AI models in the background so
                // they're already there by the time a user picks the local
                // provider in Settings — no manual "Download" click needed.
                // Idempotent (both check is-downloaded first) and silent —
                // failures (e.g. offline on first launch) are logged, not
                // surfaced, since this is a convenience prefetch, not a
                // blocking requirement.
                use tauri_plugin_local_llm::LocalLlmPluginExt;
                use tauri_plugin_local_stt::LocalSttPluginExt;

                let llm_app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    // Qwen2p5_3bQ4's download URL 404s (see
                    // useLocalLlmModel.ts's DEFAULT_LOCAL_LLM_MODEL comment)
                    // — keep this prefetch in sync with that default.
                    let model = tauri_plugin_local_llm::SupportedModel::Llama3p2_3bQ4;

                    // Download only — do NOT auto-start the server here.
                    // Starting loads the model into RAM for the lifetime of
                    // the process, and this prefetch runs on every launch
                    // regardless of whether the user has picked the local
                    // provider. The frontend starts the server on demand
                    // (see useLLMConnection's `current_llm_provider ===
                    // "notiz_local"` effect) and stops it again when the
                    // user switches away (see settings.ts
                    // `syncLocalLlmServer`).
                    if let Err(e) = llm_app_handle
                        .local_llm()
                        .ensure_model_downloaded(model)
                        .await
                    {
                        tracing::warn!("local LLM model prefetch failed: {e}");
                    }
                });

                let stt_app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    // Both, and the batch one matters most: streaming handles
                    // the live transcript during recording, but every finished
                    // transcript is produced by the batch model — including the
                    // fallback when live yields nothing. Prefetching only
                    // streaming left the model that does the real work to
                    // download on first use, mid-transcription.
                    for model in [
                        tauri_plugin_local_stt::SoniqoModel::ParakeetStreaming,
                        tauri_plugin_local_stt::SoniqoModel::ParakeetBatch,
                    ] {
                        let model = tauri_plugin_local_stt::LocalModel::Soniqo(model);
                        tracing::info!("stt prefetch: checking is_model_downloaded for {model:?}");
                        match stt_app_handle.local_stt().is_model_downloaded(&model).await {
                            Ok(true) => {
                                tracing::info!("stt prefetch: {model:?} already downloaded");
                            }
                            Ok(false) => {
                                tracing::info!("stt prefetch: {model:?} not downloaded, starting");
                                match stt_app_handle.local_stt().download_model(model).await {
                                    Ok(()) => {
                                        tracing::info!("stt prefetch: download call returned ok")
                                    }
                                    Err(e) => {
                                        tracing::warn!("local STT model prefetch failed: {e}")
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "failed to check local STT model download state: {e}"
                                )
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .build(context)
        .unwrap();

    match get_onboarding_flag() {
        None => {}
        Some(false) => app.set_onboarding_needed(false).unwrap(),
        Some(true) => {
            use tauri_plugin_settings::SettingsPluginExt;
            use tauri_plugin_store2::Store2PluginExt;

            let _ = app.settings().reset();
            let _ = app.store2().reset();
            let _ = app.set_onboarding_needed(true);

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let permissions = app_handle.permissions();
                let _ = permissions.reset(Permission::Microphone).await;
                let _ = permissions.reset(Permission::SystemAudio).await;
                let _ = permissions.reset(Permission::ScreenRecording).await;
                let _ = permissions.reset(Permission::Accessibility).await;
                let _ = permissions.reset(Permission::Calendar).await;
                let _ = permissions.reset(Permission::Reminders).await;
            });
        }
    }

    {
        let app_handle = app.handle().clone();
        AppWindow::Main.show(&app_handle).unwrap();
    }

    #[cfg(target_os = "macos")]
    notiz_intercept::setup_force_quit_handler();

    #[allow(unused_variables)]
    app.run(move |app, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            AppWindow::Main.show(app).unwrap();
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::ExitRequested { api, .. } => {
            if let Some(ref ctx) = root_supervisor_ctx_for_run {
                ctx.mark_exiting();
            }

            if notiz_intercept::should_force_quit() {
                return;
            }

            api.prevent_exit();

            for (_, window) in app.webview_windows() {
                let _ = window.close();
            }

            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
        tauri::RunEvent::Exit => {
            {
                use tauri_plugin_tray::TrayPluginExt;
                // NSStatusItem lingers as a ghost icon in the macOS menu bar if
                // the process exits without explicitly tearing it down first.
                let _ = app.tray().remove_immediate();
            }

            {
                // llama-server ships as a bundle.resources binary, not a
                // Tauri sidecar, so it's invisible to the
                // `ProcessMatcher::Sidecar` cleanup below — without this it
                // outlives the app entirely as an orphaned process still
                // holding the model in memory.
                //
                // Killed directly by process name rather than through
                // `local_llm().stop_server()`: that goes through an async
                // lock a concurrent `start_server()` call may still be
                // holding (itself possibly mid-flight for up to ~60s waiting
                // on the server's health check). A `block_on` there — even
                // timeout-wrapped — still has to get scheduled on the same
                // tokio runtime, which under load doesn't fire promptly
                // either, so quitting during a stuck start could still hang
                // the whole app (confirmed via a real 6.58s main-thread hang
                // in `psynch_cvwait` at quit). Killing by name is
                // synchronous, touches no lock, and can't hang.
                let killed = notiz_host::kill_processes_by_matcher(
                    notiz_host::ProcessMatcher::Name("llama-server".to_string()),
                );
                if killed > 0 {
                    tracing::info!("killed {killed} llama-server process(es) on quit");
                }
            }

            {
                use tauri_plugin_store2::Store2PluginExt;
                if let Ok(store) = app.store2().store() {
                    let _ = store.save();
                }
            }

            if let Some(ref ctx) = root_supervisor_ctx_for_run {
                ctx.mark_exiting();
                ctx.stop();
            }

            notiz_host::kill_processes_by_matcher(notiz_host::ProcessMatcher::Sidecar);
        }
        _ => {}
    });
}

fn get_onboarding_flag() -> Option<bool> {
    let parse_value = |v: &str| -> Option<bool> {
        match v {
            "1" | "true" => Some(true),
            "0" | "false" => Some(false),
            _ => {
                if let Ok(timestamp) = v.parse::<u64>() {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()?
                        .as_millis() as u64;
                    let elapsed = now.saturating_sub(timestamp * 1000);
                    if elapsed < 2500 { Some(true) } else { None }
                } else {
                    None
                }
            }
        }
    };

    pico_args::Arguments::from_env()
        .opt_value_from_str::<_, String>("--onboarding")
        .ok()
        .flatten()
        .and_then(|v| parse_value(&v))
        .or_else(|| {
            std::env::var("ONBOARDING")
                .ok()
                .and_then(|v| parse_value(&v))
        })
}

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .commands(tauri_specta::collect_commands![
            commands::get_onboarding_needed::<tauri::Wry>,
            commands::set_onboarding_needed::<tauri::Wry>,
            commands::get_dismissed_toasts::<tauri::Wry>,
            commands::set_dismissed_toasts::<tauri::Wry>,
            commands::get_env::<tauri::Wry>,
            commands::show_devtool::<tauri::Wry>,
            commands::get_tinybase_values::<tauri::Wry>,
            commands::set_tinybase_values::<tauri::Wry>,
            commands::get_pinned_tabs::<tauri::Wry>,
            commands::set_pinned_tabs::<tauri::Wry>,
            commands::get_recently_opened_sessions::<tauri::Wry>,
            commands::set_recently_opened_sessions::<tauri::Wry>,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn export_types() {
        const OUTPUT_FILE: &str = "../src/types/tauri.gen.ts";

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
