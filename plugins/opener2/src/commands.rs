use std::path::PathBuf;

use crate::Opener2PluginExt;

/// Links that come from the UI can originate in untrusted content such as an
/// email or a calendar invite, so only plain web, mail and phone links are
/// handed to the operating system. Anything else (`file:`, app-specific
/// schemes, shell-ish handlers) is refused.
pub(crate) fn is_allowed_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.trim().split_once(':') else {
        return false;
    };
    match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" => rest.starts_with("//") && rest.len() > 2,
        "mailto" | "tel" => !rest.is_empty(),
        _ => false,
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn open_url<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    url: String,
    open_with: Option<String>,
) -> Result<(), String> {
    if !is_allowed_url(&url) {
        return Err("this kind of link is not allowed".to_string());
    }

    app.opener2()
        .open_url(&url, open_with.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn open_path<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    open_with: Option<String>,
) -> Result<(), String> {
    app.opener2()
        .open_path(&path, open_with.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn reveal_item_in_dir<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: PathBuf,
) -> Result<(), String> {
    app.opener2()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_url;

    #[test]
    fn allows_web_mail_and_phone_links() {
        for url in [
            "https://example.com/a?b=c",
            "HTTP://example.com",
            "mailto:a@b.com?subject=Hi",
            "tel:+15551234",
        ] {
            assert!(is_allowed_url(url), "{url}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "ssh://host",
            "smb://host/share",
            "x-apple.systempreferences:com.apple.preference.security",
            "https:",
            "https://",
            "example.com",
            "",
        ] {
            assert!(!is_allowed_url(url), "{url}");
        }
    }
}
