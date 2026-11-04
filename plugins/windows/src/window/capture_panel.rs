use std::sync::Mutex;

use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Position};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelBuilder, PanelHandle, PanelLevel, StyleMask, tauri_panel,
};

#[cfg(target_os = "macos")]
use tauri::{LogicalSize, Size, WebviewUrl};

use crate::Error;
#[cfg(target_os = "macos")]
use crate::ext::run_on_main_thread;

pub const LABEL: &str = "capture-panel";
pub const WIDTH: f64 = 600.0;
pub const HEIGHT: f64 = 200.0;
pub const OPENED_EVENT: &str = "notiz://capture-opened";

static CURRENT_HOTKEY: Mutex<Option<Shortcut>> = Mutex::new(None);

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(CapturePanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
        }
    })

    panel_event!(CapturePanelEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

#[cfg(target_os = "macos")]
fn panel(app: &AppHandle<tauri::Wry>) -> Result<PanelHandle<tauri::Wry>, Error> {
    app.get_webview_panel(LABEL)
        .map_err(|error| Error::PanelError(format!("{error:?}")))
}

#[cfg(target_os = "macos")]
fn create(app: &AppHandle<tauri::Wry>) -> Result<(), Error> {
    let app = app.clone();
    let handle = app.clone();

    run_on_main_thread(&handle, move || {
        let panel = PanelBuilder::<_, CapturePanel>::new(&app, LABEL)
            .url(WebviewUrl::App("app/capture".into()))
            .title("Quick capture")
            .position(Position::Logical(LogicalPosition::new(0.0, 0.0)))
            .size(Size::Logical(LogicalSize::new(WIDTH, HEIGHT)))
            .level(PanelLevel::Floating)
            .has_shadow(true)
            .collection_behavior(
                CollectionBehavior::new()
                    .full_screen_auxiliary()
                    .can_join_all_spaces(),
            )
            .hides_on_deactivate(false)
            .works_when_modal(true)
            .no_activate(true)
            .with_window(|window| {
                window
                    .visible(false)
                    .decorations(false)
                    .transparent(true)
                    .background_color(tauri::window::Color(0, 0, 0, 0))
            })
            .style_mask(StyleMask::empty().nonactivating_panel())
            .build()
            .map_err(Error::from)?;

        let handler = CapturePanelEventHandler::new();
        let handle = app.clone();

        handler.window_did_resign_key(move |_notification| {
            if let Ok(panel) = handle.get_webview_panel(LABEL)
                && panel.is_visible()
            {
                panel.hide();
            }
        });

        panel.set_event_handler(Some(handler.as_ref()));

        Ok(())
    })?
}

pub fn ensure(app: &AppHandle<tauri::Wry>) -> Result<(), Error> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        create(app)?;
    }

    Ok(())
}

pub fn toggle(app: &AppHandle<tauri::Wry>) -> Result<(), Error> {
    ensure(app)?;

    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        let handle = app.clone();

        return run_on_main_thread(&handle, move || {
            let panel = panel(&app)?;

            if panel.is_visible() {
                panel.hide();
                return Ok(());
            }

            let window = app
                .get_webview_window(LABEL)
                .ok_or_else(|| Error::WindowNotFound(LABEL.to_string()))?;

            position(&app, &window)?;
            super::mark_panel_shown();
            panel.show_and_make_key();
            let _ = app.emit_to(LABEL, OPENED_EVENT, ());
            Ok(())
        })?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

pub fn hide(app: &AppHandle<tauri::Wry>) -> Result<(), Error> {
    #[cfg(target_os = "macos")]
    {
        if app.get_webview_window(LABEL).is_none() {
            return Ok(());
        }
        let app = app.clone();
        let handle = app.clone();

        return run_on_main_thread(&handle, move || {
            panel(&app)?.hide();
            Ok(())
        })?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn position(
    app: &AppHandle<tauri::Wry>,
    window: &tauri::WebviewWindow<tauri::Wry>,
) -> Result<(), Error> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or(Error::MonitorNotFound)?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let size = work_area.size.to_logical::<f64>(scale_factor);
    let origin = work_area.position.to_logical::<f64>(scale_factor);

    window.set_position(Position::Logical(LogicalPosition::new(
        origin.x + (size.width - WIDTH) / 2.0,
        origin.y + size.height * 0.22,
    )))?;

    Ok(())
}

pub fn set_hotkey(app: &AppHandle<tauri::Wry>, accelerator: Option<&str>) -> Result<(), String> {
    let shortcuts = app.global_shortcut();

    if let Some(previous) = CURRENT_HOTKEY
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = shortcuts.unregister(previous);
    }

    let Some(accelerator) = accelerator.map(str::trim).filter(|a| !a.is_empty()) else {
        return Ok(());
    };

    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("invalid shortcut \"{accelerator}\": {e}"))?;

    shortcuts
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Err(error) = toggle(app) {
                    tracing::error!("quick capture toggle failed: {error}");
                }
            }
        })
        .map_err(|e| e.to_string())?;

    *CURRENT_HOTKEY.lock().unwrap_or_else(|e| e.into_inner()) = Some(shortcut);
    Ok(())
}
