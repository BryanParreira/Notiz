const COMMANDS: &[&str] = &[
    "list_mail_accounts",
    "add_mail_account",
    "add_apple_mail_account",
    "remove_mail_account",
    "recent_mail",
    "mail_with",
    "read_mail",
    "set_mail_seen",
    "trash_mail",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
