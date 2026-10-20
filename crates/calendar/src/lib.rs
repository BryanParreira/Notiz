mod accounts;
mod convert;
mod error;
mod fetch;
mod http;
mod ics;
mod oauth;
pub mod runtime;

pub use error::Error;
pub use notiz_calendar_interface::{
    CalendarEvent, CalendarListItem, CalendarProviderType, CreateEventInput, EventFilter,
};

pub fn start(runtime: impl runtime::CalendarRuntime) {
    #[cfg(target_os = "macos")]
    {
        use std::sync::Arc;
        let runtime = Arc::new(runtime);
        notiz_apple_calendar::setup_change_notification(move || {
            runtime.emit_changed();
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = runtime;
}

#[cfg(target_os = "macos")]
use chrono::{DateTime, Utc};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProviderConnectionIds {
    pub provider: CalendarProviderType,
    pub connection_ids: Vec<String>,
}

pub fn available_providers() -> Vec<CalendarProviderType> {
    #[cfg(target_os = "macos")]
    let providers = vec![
        CalendarProviderType::Apple,
        CalendarProviderType::Google,
        CalendarProviderType::Outlook,
        CalendarProviderType::Ics,
    ];

    #[cfg(not(target_os = "macos"))]
    let providers = vec![
        CalendarProviderType::Google,
        CalendarProviderType::Outlook,
        CalendarProviderType::Ics,
    ];

    providers
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AccountInfo {
    pub provider: CalendarProviderType,
    pub connection_id: String,
    pub label: String,
}

pub async fn list_connection_ids(
    apple_authorized: bool,
) -> Result<Vec<ProviderConnectionIds>, Error> {
    use std::collections::HashMap;

    let mut map: HashMap<CalendarProviderType, Vec<String>> = HashMap::new();

    #[cfg(target_os = "macos")]
    {
        // empty vec = provider is available but has no connections (vs absent = unavailable)
        map.entry(CalendarProviderType::Apple).or_default();
        if apple_authorized {
            map.insert(CalendarProviderType::Apple, vec!["apple".to_string()]);
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = apple_authorized;

    for provider in [
        CalendarProviderType::Google,
        CalendarProviderType::Outlook,
        CalendarProviderType::Ics,
    ] {
        map.entry(provider).or_default();
    }

    match accounts::load() {
        Ok(stored) => {
            for account in stored {
                map.entry(account.provider)
                    .or_default()
                    .push(account.connection_id);
            }
        }
        Err(e) => {
            tracing::warn!("failed to read stored calendar accounts: {e}");
        }
    }

    Ok(map
        .into_iter()
        .map(|(provider, connection_ids)| ProviderConnectionIds {
            provider,
            connection_ids,
        })
        .collect())
}

pub async fn is_provider_enabled(
    apple_authorized: bool,
    provider: CalendarProviderType,
) -> Result<bool, Error> {
    let all = list_connection_ids(apple_authorized).await?;
    Ok(all
        .iter()
        .any(|p| p.provider == provider && !p.connection_ids.is_empty()))
}

pub fn list_accounts() -> Result<Vec<AccountInfo>, Error> {
    Ok(accounts::load()?
        .into_iter()
        .map(|a| AccountInfo {
            provider: a.provider,
            connection_id: a.connection_id,
            label: a.label,
        })
        .collect())
}

/// Runs the browser sign-in for `provider`. `open_url` is handed the
/// authorization URL and must open it in the user's browser.
pub async fn connect_account(
    provider: CalendarProviderType,
    open_url: impl FnOnce(&str) -> Result<(), String>,
) -> Result<AccountInfo, Error> {
    let pending = oauth::begin(provider).await?;
    open_url(&pending.auth_url).map_err(Error::OAuth)?;
    let account = pending.finish().await?;
    Ok(AccountInfo {
        provider: account.provider,
        connection_id: account.connection_id,
        label: account.label,
    })
}

pub async fn disconnect_account(
    provider: CalendarProviderType,
    connection_id: &str,
) -> Result<(), Error> {
    oauth::remove_account(provider, connection_id).await
}

pub async fn list_calendars(
    provider: CalendarProviderType,
    connection_id: &str,
) -> Result<Vec<CalendarListItem>, Error> {
    match provider {
        CalendarProviderType::Apple => {
            let calendars = list_apple_calendars()?;
            Ok(convert::convert_apple_calendars(calendars))
        }
        CalendarProviderType::Google => {
            let calendars = fetch::list_google_calendars(connection_id).await?;
            Ok(convert::convert_google_calendars(calendars))
        }
        CalendarProviderType::Outlook => {
            let calendars = fetch::list_outlook_calendars(connection_id).await?;
            Ok(convert::convert_outlook_calendars(calendars))
        }
        CalendarProviderType::Ics => ics_calendar(connection_id),
    }
}

pub async fn list_events(
    provider: CalendarProviderType,
    connection_id: &str,
    filter: EventFilter,
) -> Result<Vec<CalendarEvent>, Error> {
    match provider {
        CalendarProviderType::Apple => {
            let events = list_apple_events(filter)?;
            Ok(convert::convert_apple_events(events))
        }
        CalendarProviderType::Google => {
            let calendar_id = filter.calendar_tracking_id.clone();
            let events = fetch::list_google_events(connection_id, filter).await?;
            Ok(convert::convert_google_events(events, &calendar_id))
        }
        CalendarProviderType::Outlook => {
            let calendar_id = filter.calendar_tracking_id.clone();
            let events = fetch::list_outlook_events(connection_id, filter).await?;
            Ok(convert::convert_outlook_events(events, &calendar_id))
        }
        CalendarProviderType::Ics => {
            let account = accounts::load()?
                .into_iter()
                .find(|a| a.provider == provider && a.connection_id == connection_id)
                .ok_or(Error::NotAuthenticated)?;
            let url = account.url.ok_or(Error::NotAuthenticated)?;
            let text = ics::fetch(&url).await?;
            Ok(ics::parse_events(
                &text,
                &filter.calendar_tracking_id,
                filter.from,
                filter.to,
            ))
        }
    }
}

fn ics_calendar(connection_id: &str) -> Result<Vec<CalendarListItem>, Error> {
    let account = accounts::load()?
        .into_iter()
        .find(|a| a.provider == CalendarProviderType::Ics && a.connection_id == connection_id)
        .ok_or(Error::NotAuthenticated)?;

    Ok(vec![CalendarListItem {
        provider: CalendarProviderType::Ics,
        id: account.connection_id,
        title: account.label,
        source: Some("Calendar link".to_string()),
        color: None,
        is_primary: Some(false),
        can_edit: Some(false),
        raw: String::new(),
    }])
}

/// Adds a calendar from a private iCal link. The link is fetched once to make
/// sure it really is a calendar before anything is stored.
pub async fn add_ics_account(url: String, label: Option<String>) -> Result<AccountInfo, Error> {
    let url = ics::normalize_url(&url)?;
    let text = ics::fetch(&url).await?;
    if !ics::looks_like_calendar(&text) {
        return Err(Error::Api(
            "that link did not return a calendar. Use the private iCal (.ics) link.".into(),
        ));
    }

    let label = label
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .or_else(|| ics::calendar_name(&text))
        .unwrap_or_else(|| {
            url::Url::parse(&url)
                .ok()
                .and_then(|u| u.host_str().map(str::to_string))
                .unwrap_or_else(|| "Calendar".to_string())
        });

    let account = accounts::StoredAccount {
        provider: CalendarProviderType::Ics,
        connection_id: uuid::Uuid::new_v4().to_string(),
        label,
        access_token: String::new(),
        refresh_token: String::new(),
        expires_at: 0,
        url: Some(url),
    };

    let _guard = accounts::LOCK.lock().await;
    let mut stored = accounts::load()?;
    let info = AccountInfo {
        provider: account.provider,
        connection_id: account.connection_id.clone(),
        label: account.label.clone(),
    };
    stored.push(account);
    accounts::save(&stored)?;
    Ok(info)
}

pub fn open_calendar(provider: CalendarProviderType) -> Result<(), Error> {
    match provider {
        CalendarProviderType::Apple => open_apple_calendar(),
        _ => Err(Error::UnsupportedOperation {
            operation: "open_calendar",
            provider,
        }),
    }
}

pub fn create_event(
    provider: CalendarProviderType,
    input: CreateEventInput,
) -> Result<String, Error> {
    match provider {
        CalendarProviderType::Apple => create_apple_event(input),
        _ => Err(Error::UnsupportedOperation {
            operation: "create_event",
            provider,
        }),
    }
}

pub fn parse_meeting_link(text: &str) -> Option<String> {
    use std::sync::LazyLock;

    use regex::Regex;

    static MEETING_REGEXES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
        vec![
            Regex::new(r"https://meet\.google\.com/[a-z0-9]{3,4}-[a-z0-9]{3,4}-[a-z0-9]{3,4}")
                .unwrap(),
            Regex::new(r"https://[a-z0-9.-]+\.zoom\.us/j/\d+(\?pwd=[a-zA-Z0-9.]+)?").unwrap(),
            Regex::new(r"https://app\.cal\.com/video/[a-zA-Z0-9]+").unwrap(),
        ]
    });
    for regex in MEETING_REGEXES.iter() {
        if let Some(m) = regex.find(text) {
            return Some(m.as_str().to_string());
        }
    }
    static URL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"https?://[^\s]+").unwrap());
    URL_RE.find(text).map(|m| m.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_meeting_link_real_world() {
        let cases = vec![
            (
                "cal.com",
                "Where:\nhttps://app.cal.com/video/d713v9w1d2krBptPtwUAnJ\nNeed to reschedule?",
                "https://app.cal.com/video/d713v9w1d2krBptPtwUAnJ",
            ),
            (
                "zoom with pwd",
                "Where:\nhttps://us05web.zoom.us/j/87636383039?pwd=NOWbxkY9GNblR0yaLKaIzcy76IWRoj.1\nDescription",
                "https://us05web.zoom.us/j/87636383039?pwd=NOWbxkY9GNblR0yaLKaIzcy76IWRoj.1",
            ),
            (
                "google meet",
                "https://meet.google.com/xhv-ubut-zph\ntel:+1%20650-817-8427",
                "https://meet.google.com/xhv-ubut-zph",
            ),
            (
                "zoom in html",
                "<p>Join Zoom Meeting<br/>https://hyprnote.zoom.us/j/86746313244?pwd=zFIICnVHzPim44QcYGbLCAAqtBrGzx.1<br/></p>",
                "https://hyprnote.zoom.us/j/86746313244?pwd=zFIICnVHzPim44QcYGbLCAAqtBrGzx.1",
            ),
            (
                "korean google meet",
                "Google Meet으로 참석: https://meet.google.com/xkf-xcmo-rwh\n또는 다음 전화번호로",
                "https://meet.google.com/xkf-xcmo-rwh",
            ),
        ];

        for (name, input, expected) in cases {
            assert_eq!(
                parse_meeting_link(input),
                Some(expected.to_string()),
                "failed: {name}"
            );
        }
    }
}

// --- Apple helpers ---

#[cfg(target_os = "macos")]
fn open_apple_calendar() -> Result<(), Error> {
    let script = String::from(
        "
            tell application \"Calendar\"
                activate
                switch view to month view
                view calendar at current date
            end tell
        ",
    );

    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn()
        .map_err(|e| Error::Apple(e.to_string()))?
        .wait()
        .map_err(|e| Error::Apple(e.to_string()))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn list_apple_calendars() -> Result<Vec<notiz_apple_calendar::types::AppleCalendar>, Error> {
    let handle = notiz_apple_calendar::Handle::new();
    handle
        .list_calendars()
        .map_err(|e| Error::Apple(e.to_string()))
}

#[cfg(target_os = "macos")]
fn list_apple_events(
    filter: EventFilter,
) -> Result<Vec<notiz_apple_calendar::types::AppleEvent>, Error> {
    let handle = notiz_apple_calendar::Handle::new();
    let filter = notiz_apple_calendar::types::EventFilter {
        from: filter.from,
        to: filter.to,
        calendar_tracking_id: filter.calendar_tracking_id,
    };

    handle
        .list_events(filter)
        .map_err(|e| Error::Apple(e.to_string()))
}

#[cfg(target_os = "macos")]
fn create_apple_event(input: CreateEventInput) -> Result<String, Error> {
    let handle = notiz_apple_calendar::Handle::new();

    let start_date = parse_datetime(&input.started_at, "started_at")?;
    let end_date = parse_datetime(&input.ended_at, "ended_at")?;

    let input = notiz_apple_calendar::types::CreateEventInput {
        title: input.title,
        start_date,
        end_date,
        calendar_id: input.calendar_tracking_id,
        is_all_day: input.is_all_day,
        location: input.location,
        notes: input.notes,
        url: input.url,
    };

    handle
        .create_event(input)
        .map_err(|e| Error::Apple(e.to_string()))
}

#[cfg(target_os = "macos")]
fn parse_datetime(value: &str, field: &'static str) -> Result<DateTime<Utc>, Error> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| Error::InvalidDateTime {
            field,
            value: value.to_string(),
        })
}

#[cfg(not(target_os = "macos"))]
fn open_apple_calendar() -> Result<(), Error> {
    Err(Error::ProviderUnavailable {
        provider: CalendarProviderType::Apple,
    })
}

#[cfg(not(target_os = "macos"))]
fn list_apple_calendars() -> Result<Vec<notiz_apple_calendar::types::AppleCalendar>, Error> {
    Err(Error::ProviderUnavailable {
        provider: CalendarProviderType::Apple,
    })
}

#[cfg(not(target_os = "macos"))]
fn list_apple_events(
    _filter: EventFilter,
) -> Result<Vec<notiz_apple_calendar::types::AppleEvent>, Error> {
    Err(Error::ProviderUnavailable {
        provider: CalendarProviderType::Apple,
    })
}

#[cfg(not(target_os = "macos"))]
fn create_apple_event(_input: CreateEventInput) -> Result<String, Error> {
    Err(Error::ProviderUnavailable {
        provider: CalendarProviderType::Apple,
    })
}
