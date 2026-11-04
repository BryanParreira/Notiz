pub mod capture_panel;

use std::sync::atomic::{AtomicU64, Ordering};

static PANEL_SHOWN_MS: AtomicU64 = AtomicU64::new(0);
const PANEL_REOPEN_GRACE_MS: u64 = 1500;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// Showing a panel while no regular window is open makes macOS report an app
// "reopen", which would otherwise pop the main window up behind the panel.
pub(crate) fn mark_panel_shown() {
    PANEL_SHOWN_MS.store(now_ms(), Ordering::SeqCst);
}

pub fn panel_shown_recently() -> bool {
    now_ms().saturating_sub(PANEL_SHOWN_MS.load(Ordering::SeqCst)) < PANEL_REOPEN_GRACE_MS
}
pub(crate) mod devtools_panel;
pub(crate) mod floating_bar;
pub(crate) mod live_caption;
pub mod tray_panel;
mod v1;

pub type AppWindow = v1::AppWindow;

pub trait WindowImpl:
    std::fmt::Display
    + std::str::FromStr
    + std::fmt::Debug
    + Clone
    + serde::Serialize
    + serde::de::DeserializeOwned
    + specta::Type
    + PartialEq
    + Eq
    + std::hash::Hash
    + Send
    + Sync
    + 'static
{
    fn label(&self) -> String {
        self.to_string()
    }

    fn title(&self) -> String;

    fn build_window(
        &self,
        app: &tauri::AppHandle<tauri::Wry>,
    ) -> Result<tauri::WebviewWindow, crate::Error>;

    fn position_new_window(
        &self,
        app: &tauri::AppHandle<tauri::Wry>,
        window: &tauri::WebviewWindow<tauri::Wry>,
    ) -> Result<(), crate::Error> {
        let _ = app;
        let _ = window;
        Ok(())
    }
}
