use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, Result,
    menu::{Menu, MenuItem, PredefinedMenuItem},
};

use crate::TRAY_ID;
use crate::menu_items::{
    AppNew, MenuItemHandler, TrayCheckUpdate, TrayOpen, TrayQuit, TraySettings, TrayStart,
    TrayVersion,
};

pub const EVENT_PREFIX: &str = "notiz_tray_event:";
pub const JOIN_PREFIX: &str = "notiz_tray_join:";
pub const CALENDAR_ID: &str = "notiz_tray_calendar";
pub const INBOX_ID: &str = "notiz_tray_inbox";
pub const TRAY_ACTION_EVENT: &str = "notiz://tray-action";
pub const TRAY_SUMMARY_EVENT: &str = "notiz://tray-summary";

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct TrayEventItem {
    pub id: String,
    pub title: String,
    pub label: String,
    pub start: Option<String>,
    pub end: Option<String>,
    pub color: Option<String>,
    pub join_url: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct TraySummary {
    pub title: Option<String>,
    pub next: Option<TrayEventItem>,
    pub agenda: Vec<TrayEventItem>,
    pub unread: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TrayAction {
    pub kind: String,
    pub value: Option<String>,
}

static SUMMARY: Mutex<Option<TraySummary>> = Mutex::new(None);
static START_DISABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn current_summary() -> TraySummary {
    SUMMARY
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_default()
}

pub fn store_summary(summary: TraySummary) {
    if let Ok(mut guard) = SUMMARY.lock() {
        *guard = Some(summary);
    }
}

pub fn set_start_disabled_flag(disabled: bool) {
    START_DISABLED.store(disabled, std::sync::atomic::Ordering::SeqCst);
}

pub fn build_menu(app: &AppHandle<tauri::Wry>) -> Result<Menu<tauri::Wry>> {
    let summary = SUMMARY
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_default();

    let menu = Menu::new(app)?;

    if let Some(next) = &summary.next {
        let item = MenuItem::with_id(
            app,
            format!("{EVENT_PREFIX}{}", next.id),
            &next.label,
            true,
            None::<&str>,
        )?;
        menu.append(&item)?;

        if next.join_url.is_some() {
            let join = MenuItem::with_id(
                app,
                format!("{JOIN_PREFIX}{}", next.id),
                "Join meeting",
                true,
                None::<&str>,
            )?;
            menu.append(&join)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    let others: Vec<_> = summary
        .agenda
        .iter()
        .filter(|item| summary.next.as_ref().is_none_or(|next| next.id != item.id))
        .collect();

    if !others.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            "notiz_tray_agenda_header",
            "Later today",
            false,
            None::<&str>,
        )?)?;
        for item in others {
            menu.append(&MenuItem::with_id(
                app,
                format!("{EVENT_PREFIX}{}", item.id),
                &item.label,
                true,
                None::<&str>,
            )?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    menu.append(&AppNew::build(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        CALENDAR_ID,
        "Open Calendar",
        true,
        None::<&str>,
    )?)?;
    let inbox_label = if summary.unread > 0 {
        format!("Open Inbox ({} unread)", summary.unread)
    } else {
        "Open Inbox".to_string()
    };
    menu.append(&MenuItem::with_id(
        app,
        INBOX_ID,
        inbox_label,
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&TrayOpen::build(app)?)?;
    menu.append(&TrayStart::build_with_disabled(
        app,
        START_DISABLED.load(std::sync::atomic::Ordering::SeqCst),
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&TrayVersion::build(app)?)?;
    menu.append(&TrayCheckUpdate::build(app)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&TrayQuit::build(app)?)?;

    Ok(menu)
}

pub fn apply_summary(app: &AppHandle<tauri::Wry>) {
    let _ = app.emit(TRAY_SUMMARY_EVENT, current_summary());

    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(tray) = app_clone.tray_by_id(TRAY_ID) else {
            return;
        };
        let title = SUMMARY
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().and_then(|s| s.title.clone()));
        let _ = tray.set_title(title.as_deref());
    });
}

pub fn dispatch(app: &AppHandle<tauri::Wry>, kind: &str, value: Option<String>) {
    use tauri_plugin_windows::AppWindow;

    if kind == "close" {
        let _ = tauri_plugin_windows::tray_panel::hide(app);
        return;
    }

    if matches!(
        kind,
        "app_open" | "app_settings" | "app_update" | "app_quit"
    ) {
        let _ = tauri_plugin_windows::tray_panel::hide(app);
        match kind {
            "app_open" => TrayOpen::handle(app),
            "app_settings" => TraySettings::handle(app),
            "app_update" => TrayCheckUpdate::handle(app),
            _ => TrayQuit::handle(app),
        }
        return;
    }

    if kind == "join" && value.is_none() {
        return;
    }

    if kind != "join" {
        let _ = AppWindow::Main.show(app);
    }
    let _ = tauri_plugin_windows::tray_panel::hide(app);
    let _ = app.emit_to(
        "main",
        TRAY_ACTION_EVENT,
        TrayAction {
            kind: kind.to_string(),
            value,
        },
    );
}

pub fn handle_menu_event(app: &AppHandle<tauri::Wry>, id: &str) {
    if let Some(event_id) = id.strip_prefix(EVENT_PREFIX) {
        dispatch(app, "open_event", Some(event_id.to_string()));
    } else if let Some(event_id) = id.strip_prefix(JOIN_PREFIX) {
        let url = SUMMARY.lock().ok().and_then(|guard| {
            guard.as_ref().and_then(|s| {
                s.next
                    .iter()
                    .chain(s.agenda.iter())
                    .find(|item| item.id == event_id)
                    .and_then(|item| item.join_url.clone())
            })
        });
        dispatch(app, "join", url);
    } else if id == CALENDAR_ID {
        dispatch(app, "open_calendar", None);
    } else if id == INBOX_ID {
        dispatch(app, "open_inbox", None);
    }
}
