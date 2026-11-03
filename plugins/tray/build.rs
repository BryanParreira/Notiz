const COMMANDS: &[&str] = &[
    "set_tray_icon_visible",
    "set_tray_summary",
    "get_tray_summary",
    "tray_action",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
