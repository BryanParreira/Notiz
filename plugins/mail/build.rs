const COMMANDS: &[&str] = &[
    "list_mail_accounts",
    "add_mail_account",
    "remove_mail_account",
    "recent_mail",
    "mail_with",
    "read_mail",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
