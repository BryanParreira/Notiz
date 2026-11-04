use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, LogicalPosition, Manager, Position, WebviewWindow};

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelBuilder, PanelHandle, PanelLevel, StyleMask, tauri_panel,
};

#[cfg(target_os = "macos")]
use tauri::{LogicalSize, Size, WebviewUrl};

#[cfg(target_os = "macos")]
use crate::ext::run_on_main_thread;
use crate::{AppWindow, Error, WindowImpl};

static LAST_HIDDEN_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub const WIDTH: f64 = 340.0;
pub const HEIGHT: f64 = 500.0;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(TrayPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
        }
    })

    panel_event!(TrayPanelEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

#[cfg(target_os = "macos")]
fn panel(app: &AppHandle<tauri::Wry>) -> Result<PanelHandle<tauri::Wry>, Error> {
    app.get_webview_panel(&AppWindow::TrayPanel.label())
        .map_err(|error| Error::PanelError(format!("{error:?}")))
}

#[cfg(target_os = "macos")]
fn create(app: &AppHandle<tauri::Wry>) -> Result<(), Error> {
    let app = app.clone();
    let handle = app.clone();

    run_on_main_thread(&handle, move || {
        let panel = PanelBuilder::<_, TrayPanel>::new(&app, AppWindow::TrayPanel.label())
            .url(WebviewUrl::App("app/tray".into()))
            .title("Notiz")
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

        let handler = TrayPanelEventHandler::new();
        let handle = app.clone();

        handler.window_did_resign_key(move |_notification| {
            if let Ok(panel) = handle.get_webview_panel(&AppWindow::TrayPanel.label())
                && panel.is_visible()
            {
                LAST_HIDDEN_MS.store(now_ms(), Ordering::SeqCst);
                panel.hide();
            }
        });

        panel.set_event_handler(Some(handler.as_ref()));

        Ok(())
    })?
}

pub fn ensure(app: &AppHandle<tauri::Wry>) -> Result<(), Error> {
    if app
        .get_webview_window(&AppWindow::TrayPanel.label())
        .is_some()
    {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        create(app)?;
    }

    Ok(())
}

pub fn show(app: &AppHandle<tauri::Wry>) -> Result<WebviewWindow, Error> {
    ensure(app)?;

    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        let handle = app.clone();

        return run_on_main_thread(&handle, move || {
            let window = app
                .get_webview_window(&AppWindow::TrayPanel.label())
                .ok_or_else(|| Error::WindowNotFound(AppWindow::TrayPanel.label()))?;
            let panel = panel(&app)?;

            position(&app, &window)?;
            panel.show_and_make_key();

            Ok(window)
        })?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        app.get_webview_window(&AppWindow::TrayPanel.label())
            .ok_or_else(|| Error::WindowNotFound(AppWindow::TrayPanel.label()))
    }
}

pub fn hide(app: &AppHandle<tauri::Wry>) -> Result<(), Error> {
    #[cfg(target_os = "macos")]
    {
        ensure(app)?;
        let app = app.clone();
        let handle = app.clone();

        return run_on_main_thread(&handle, move || {
            panel(&app)?.hide();
            Ok(())
        })?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window(&AppWindow::TrayPanel.label()) {
            window.hide()?;
        }

        Ok(())
    }
}

fn position(app: &AppHandle<tauri::Wry>, window: &WebviewWindow<tauri::Wry>) -> Result<(), Error> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or(Error::MonitorNotFound)?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let work_area_size = work_area.size.to_logical::<f64>(scale_factor);
    let work_area_position = work_area.position.to_logical::<f64>(scale_factor);
    let bottom_offset = (work_area_size.height * 0.06).clamp(28.0, 56.0);

    window.set_position(Position::Logical(LogicalPosition::new(
        work_area_position.x + ((work_area_size.width - WIDTH) / 2.0),
        work_area_position.y + work_area_size.height - HEIGHT - bottom_offset,
    )))?;

    Ok(())
}

// A click on the tray icon while the panel is open first resigns key (which hides
// the panel), then arrives here; without the grace window it would reopen at once.
const REOPEN_GRACE_MS: u64 = 250;

pub fn toggle_anchored(
    app: &AppHandle<tauri::Wry>,
    icon_position: (f64, f64),
    icon_size: (f64, f64),
) -> Result<(), Error> {
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

            if now_ms().saturating_sub(LAST_HIDDEN_MS.load(Ordering::SeqCst)) < REOPEN_GRACE_MS {
                return Ok(());
            }

            let window = app
                .get_webview_window(&AppWindow::TrayPanel.label())
                .ok_or_else(|| Error::WindowNotFound(AppWindow::TrayPanel.label()))?;

            anchor(&app, &window, icon_position, icon_size)?;
            super::mark_panel_shown();
            panel.show_and_make_key();
            Ok(())
        })?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (icon_position, icon_size);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn anchor(
    app: &AppHandle<tauri::Wry>,
    window: &WebviewWindow<tauri::Wry>,
    icon_position: (f64, f64),
    icon_size: (f64, f64),
) -> Result<(), Error> {
    let monitor = app
        .monitor_from_point(icon_position.0, icon_position.1)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or(Error::MonitorNotFound)?;
    let scale = monitor.scale_factor();
    let panel_width = WIDTH * scale;
    let margin = 8.0 * scale;
    let monitor_left = monitor.position().x as f64;
    let monitor_right = monitor_left + monitor.size().width as f64;

    let centered = icon_position.0 + icon_size.0 / 2.0 - panel_width / 2.0;
    let x = centered
        .min(monitor_right - panel_width - margin)
        .max(monitor_left + margin);
    let y = icon_position.1 + icon_size.1 + 6.0 * scale;

    window.set_position(Position::Physical(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    )))?;

    Ok(())
}
