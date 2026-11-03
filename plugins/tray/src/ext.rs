use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

use tauri::async_runtime::JoinHandle;
use tauri::{
    AppHandle, Result,
    image::Image,
    menu::{MenuItemKind, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
};

use crate::tray_icon::{RECORDING_FRAMES, TrayIconState};

use crate::menu_items::{
    AppInfo, AppNew, HelpReportBug, HelpSuggestFeature, MenuItemHandler, TrayCheckUpdate, TrayQuit,
    TraySettings,
};

pub(crate) const TRAY_ID: &str = "notiz-tray";

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static IS_DEGRADED: AtomicBool = AtomicBool::new(false);
static IS_UPDATE_AVAILABLE: AtomicBool = AtomicBool::new(false);
static ANIMATION_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

pub struct Tray<'a, R: tauri::Runtime, M: tauri::Manager<R>> {
    manager: &'a M,
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<'a, M: tauri::Manager<tauri::Wry>> Tray<'a, tauri::Wry, M> {
    pub fn create_app_menu(&self) -> Result<()> {
        let app = self.manager.app_handle();

        let info_item = AppInfo::build(app)?;
        let check_update_item = TrayCheckUpdate::build(app)?;
        let settings_item = TraySettings::build(app)?;
        let new_item = AppNew::build(app)?;
        let report_bug_item = HelpReportBug::build(app)?;
        let suggest_feature_item = HelpSuggestFeature::build(app)?;

        if cfg!(target_os = "macos")
            && let Some(menu) = app.menu()
        {
            let items = menu.items()?;

            if !items.is_empty()
                && let MenuItemKind::Submenu(old_submenu) = &items[0]
            {
                let app_name = old_submenu.text()?;

                let new_app_submenu = Submenu::with_items(
                    app,
                    &app_name,
                    true,
                    &[
                        &info_item,
                        &check_update_item,
                        &settings_item,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &TrayQuit::build(app)?,
                    ],
                )?;

                menu.remove(old_submenu)?;
                menu.prepend(&new_app_submenu)?;
            }

            if items.len() > 1
                && let MenuItemKind::Submenu(submenu) = &items[1]
            {
                submenu.prepend(&new_item)?;
            }

            for item in &items {
                if let MenuItemKind::Submenu(submenu) = item
                    && submenu.text()? == "Help"
                {
                    menu.remove(submenu)?;
                    break;
                }
            }

            let help_submenu = Submenu::with_items(
                app,
                "Help",
                true,
                &[&report_bug_item, &suggest_feature_item],
            )?;
            menu.append(&help_submenu)?;
        }

        Ok(())
    }

    pub fn create_tray_menu(&self) -> Result<()> {
        let app = self.manager.app_handle();

        if app.tray_by_id(TRAY_ID).is_some() {
            return Ok(());
        }

        TrayIconBuilder::with_id(TRAY_ID)
            .icon(TrayIconState::Default.to_image()?)
            .icon_as_template(true)
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};

                if let TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    ..
                } = &event
                {
                    use tauri::{Manager, menu::ContextMenu};
                    let app = tray.app_handle();
                    if let (Ok(menu), Some(window)) = (
                        crate::summary::build_menu(app),
                        app.get_webview_window("main"),
                    ) {
                        let _ = menu.popup(window.as_ref().window());
                    }
                }

                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    rect,
                    ..
                } = event
                {
                    let (px, py) = match rect.position {
                        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
                        tauri::Position::Logical(p) => (p.x, p.y),
                    };
                    let (w, h) = match rect.size {
                        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
                        tauri::Size::Logical(s) => (s.width, s.height),
                    };
                    if let Err(error) = tauri_plugin_windows::tray_panel::toggle_anchored(
                        tray.app_handle(),
                        (px, py),
                        (w, h),
                    ) {
                        tracing::error!("tray panel toggle failed: {error}");
                    }
                }
            })
            .build(app)?;

        Ok(())
    }

    pub fn set_visible(&self, visible: bool) -> Result<()> {
        let app = self.manager.app_handle().clone();

        if visible {
            let app_clone = app.clone();
            app.run_on_main_thread(move || {
                let _ = app_clone.tray().create_tray_menu();
            })?;
            Self::refresh_icon(&app)?;
        } else {
            if let Ok(mut task) = ANIMATION_TASK.lock()
                && let Some(handle) = task.take()
            {
                handle.abort();
            }
            let app_clone = app.clone();
            app.run_on_main_thread(move || {
                let _ = app_clone.remove_tray_by_id(TRAY_ID);
            })?;
        }

        Ok(())
    }

    // Unlike `set_visible(false)`, this removes the tray icon immediately on
    // the calling thread instead of deferring via `run_on_main_thread` — for
    // use on app-exit paths, where the event loop may stop pumping before a
    // deferred closure gets a chance to run, leaving a ghost icon behind.
    pub fn remove_immediate(&self) -> Result<()> {
        let app = self.manager.app_handle();

        if let Ok(mut task) = ANIMATION_TASK.lock()
            && let Some(handle) = task.take()
        {
            handle.abort();
        }

        let _ = app.remove_tray_by_id(TRAY_ID);
        Ok(())
    }

    pub fn set_title(&self, title: Option<&str>) -> Result<()> {
        let app = self.manager.app_handle().clone();
        let title = title.map(str::to_string);
        let app_clone = app.clone();
        app.run_on_main_thread(move || {
            if let Some(tray) = app_clone.tray_by_id(TRAY_ID) {
                let _ = tray.set_title(title.as_deref());
            }
        })?;
        Ok(())
    }

    pub fn set_recording(&self, recording: bool) -> Result<()> {
        IS_RECORDING.store(recording, Ordering::SeqCst);
        Self::refresh_icon(self.manager.app_handle())
    }

    pub fn set_degraded(&self, degraded: bool) -> Result<()> {
        IS_DEGRADED.store(degraded, Ordering::SeqCst);
        Self::refresh_icon(self.manager.app_handle())
    }

    pub fn set_update_available(&self, available: bool) -> Result<()> {
        IS_UPDATE_AVAILABLE.store(available, Ordering::SeqCst);
        Self::refresh_icon(self.manager.app_handle())
    }

    fn refresh_icon(app_ref: &AppHandle<tauri::Wry>) -> Result<()> {
        let app = app_ref.clone();
        {
            let mut task = ANIMATION_TASK.lock().unwrap();
            if let Some(handle) = task.take() {
                handle.abort();
            }

            if IS_RECORDING.load(Ordering::SeqCst) {
                let app = app.clone();
                *task = Some(tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
                    let mut frame = 0usize;
                    loop {
                        interval.tick().await;
                        let app2 = app.clone();
                        let frame_data = RECORDING_FRAMES[frame];
                        let _ = app.run_on_main_thread(move || {
                            if let Some(tray) = app2.tray_by_id(TRAY_ID)
                                && let Ok(image) = Image::from_bytes(frame_data)
                            {
                                let _ = tray.set_icon(Some(image));
                            }
                        });
                        frame = (frame + 1) % RECORDING_FRAMES.len();
                    }
                }));
                return Ok(());
            }
        }

        let state = if IS_UPDATE_AVAILABLE.load(Ordering::SeqCst) {
            TrayIconState::UpdateAvailable
        } else if IS_DEGRADED.load(Ordering::SeqCst) {
            TrayIconState::Degraded
        } else {
            TrayIconState::Default
        };

        let image = state.to_image()?;
        let app_clone = app.clone();
        app.run_on_main_thread(move || {
            if let Some(tray) = app_clone.tray_by_id(TRAY_ID) {
                let _ = tray.set_icon(Some(image));
            }
        })?;

        Ok(())
    }

    pub fn set_start_disabled(&self, disabled: bool) -> Result<()> {
        crate::summary::set_start_disabled_flag(disabled);
        crate::summary::apply_summary(self.manager.app_handle());
        Ok(())
    }

    pub fn set_summary(&self, summary: crate::summary::TraySummary) -> Result<()> {
        crate::summary::store_summary(summary);
        crate::summary::apply_summary(self.manager.app_handle());
        Ok(())
    }
}

pub trait TrayPluginExt<R: tauri::Runtime> {
    fn tray(&self) -> Tray<'_, R, Self>
    where
        Self: tauri::Manager<R> + Sized;
}

impl<R: tauri::Runtime, T: tauri::Manager<R>> TrayPluginExt<R> for T {
    fn tray(&self) -> Tray<'_, R, Self>
    where
        Self: Sized,
    {
        Tray {
            manager: self,
            _runtime: std::marker::PhantomData,
        }
    }
}
