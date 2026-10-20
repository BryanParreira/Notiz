use std::collections::{HashMap, HashSet};
use std::io::BufReader;

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, TimeZone, Utc};
use ical::{IcalParser, property::Property};
use notiz_calendar_interface::{
    AttendeeRole, AttendeeStatus, CalendarEvent, CalendarProviderType, EventAttendee, EventPerson,
    EventStatus,
};

use crate::error::Error;

const MAX_ICS_BYTES: usize = 12_000_000;
const MAX_INSTANCES_PER_EVENT: u16 = 400;
const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);

/// Accepts `webcal://` links as well as http(s), and rejects anything else.
pub(crate) fn normalize_url(raw: &str) -> Result<String, Error> {
    let trimmed = raw.trim();
    let url = if let Some(rest) = trimmed.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("webcals://") {
        format!("https://{rest}")
    } else {
        trimmed.to_string()
    };

    let parsed = url::Url::parse(&url).map_err(|_| Error::Api("invalid calendar link".into()))?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() {
        return Err(Error::Api(
            "the calendar link must start with https:// or webcal://".into(),
        ));
    }
    Ok(url)
}

pub(crate) async fn fetch(url: &str) -> Result<String, Error> {
    // The link is a secret, and the HTTP library puts the URL in its error text,
    // so strip it before anything can reach the UI or a log.
    let fail = |e: reqwest::Error| Error::Api(e.without_url().to_string());

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(fail)?;
    let response = client.get(url).send().await.map_err(fail)?;
    let status = response.status();
    if !status.is_success() {
        return Err(Error::Api(format!("calendar link returned {status}")));
    }
    // Refuse an oversized file up front instead of downloading it all first.
    if response
        .content_length()
        .is_some_and(|len| len > MAX_ICS_BYTES as u64)
    {
        return Err(Error::Api("calendar file is too large".into()));
    }
    let bytes = response.bytes().await.map_err(fail)?;
    if bytes.len() > MAX_ICS_BYTES {
        return Err(Error::Api("calendar file is too large".into()));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Name of the calendar (`X-WR-CALNAME`), when the feed has one.
pub(crate) fn calendar_name(ics: &str) -> Option<String> {
    ics.lines()
        .find_map(|line| line.strip_prefix("X-WR-CALNAME:"))
        .map(|name| unescape(name.trim()))
        .filter(|name| !name.is_empty())
}

pub(crate) fn looks_like_calendar(ics: &str) -> bool {
    ics.contains("BEGIN:VCALENDAR")
}

struct Dt {
    utc: DateTime<Utc>,
    all_day: bool,
    /// IANA zone, when the value was written in one.
    tzid: Option<String>,
}

fn param<'a>(prop: &'a Property, name: &str) -> Option<&'a str> {
    prop.params
        .as_ref()?
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .and_then(|(_, values)| values.first())
        .map(String::as_str)
}

fn value(prop: &Property) -> &str {
    prop.value.as_deref().unwrap_or("").trim()
}

fn unescape(text: &str) -> String {
    text.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

fn windows_to_iana(name: &str) -> Option<&'static str> {
    Some(match name {
        "UTC" | "Coordinated Universal Time" => "UTC",
        "GMT Standard Time" => "Europe/London",
        "Greenwich Standard Time" => "Atlantic/Reykjavik",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Central Europe Standard Time" => "Europe/Budapest",
        "Central European Standard Time" => "Europe/Warsaw",
        "Romance Standard Time" => "Europe/Paris",
        "E. Europe Standard Time" => "Europe/Chisinau",
        "GTB Standard Time" => "Europe/Bucharest",
        "FLE Standard Time" => "Europe/Kiev",
        "Russian Standard Time" => "Europe/Moscow",
        "Turkey Standard Time" => "Europe/Istanbul",
        "Eastern Standard Time" => "America/New_York",
        "Central Standard Time" => "America/Chicago",
        "Mountain Standard Time" => "America/Denver",
        "US Mountain Standard Time" => "America/Phoenix",
        "Pacific Standard Time" => "America/Los_Angeles",
        "Alaskan Standard Time" => "America/Anchorage",
        "Hawaiian Standard Time" => "Pacific/Honolulu",
        "Atlantic Standard Time" => "America/Halifax",
        "Canada Central Standard Time" => "America/Regina",
        "Mexico Standard Time" => "America/Mexico_City",
        "SA Pacific Standard Time" => "America/Bogota",
        "SA Eastern Standard Time" => "America/Cayenne",
        "E. South America Standard Time" => "America/Sao_Paulo",
        "Argentina Standard Time" => "America/Argentina/Buenos_Aires",
        "South Africa Standard Time" => "Africa/Johannesburg",
        "Egypt Standard Time" => "Africa/Cairo",
        "Israel Standard Time" => "Asia/Jerusalem",
        "Arab Standard Time" => "Asia/Riyadh",
        "Arabian Standard Time" => "Asia/Dubai",
        "India Standard Time" => "Asia/Kolkata",
        "Pakistan Standard Time" => "Asia/Karachi",
        "SE Asia Standard Time" => "Asia/Bangkok",
        "China Standard Time" => "Asia/Shanghai",
        "Singapore Standard Time" => "Asia/Singapore",
        "Tokyo Standard Time" => "Asia/Tokyo",
        "Korea Standard Time" => "Asia/Seoul",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        "E. Australia Standard Time" => "Australia/Brisbane",
        "Cen. Australia Standard Time" => "Australia/Adelaide",
        "W. Australia Standard Time" => "Australia/Perth",
        "New Zealand Standard Time" => "Pacific/Auckland",
        _ => return None,
    })
}

fn resolve_tz(tzid: &str) -> Option<(chrono_tz::Tz, String)> {
    let tzid = tzid.trim_matches('"');
    if let Ok(tz) = tzid.parse::<chrono_tz::Tz>() {
        return Some((tz, tzid.to_string()));
    }
    let iana = windows_to_iana(tzid)?;
    iana.parse::<chrono_tz::Tz>()
        .ok()
        .map(|tz| (tz, iana.to_string()))
}

fn parse_dt(prop: &Property) -> Option<Dt> {
    let raw = value(prop);
    let is_date = param(prop, "VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE"))
        || (raw.len() == 8 && !raw.contains('T'));

    if is_date {
        let date = NaiveDate::parse_from_str(raw, "%Y%m%d").ok()?;
        return Some(Dt {
            utc: Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0)?),
            all_day: true,
            tzid: None,
        });
    }

    if let Some(stripped) = raw.strip_suffix('Z') {
        let naive = NaiveDateTime::parse_from_str(stripped, "%Y%m%dT%H%M%S").ok()?;
        return Some(Dt {
            utc: Utc.from_utc_datetime(&naive),
            all_day: false,
            tzid: None,
        });
    }

    let naive = NaiveDateTime::parse_from_str(raw, "%Y%m%dT%H%M%S").ok()?;
    match param(prop, "TZID").and_then(resolve_tz) {
        Some((tz, name)) => {
            let local = tz.from_local_datetime(&naive).earliest()?;
            Some(Dt {
                utc: local.with_timezone(&Utc),
                all_day: false,
                tzid: Some(name),
            })
        }
        // Floating or unknown zone: treat as UTC rather than dropping the event.
        None => Some(Dt {
            utc: Utc.from_utc_datetime(&naive),
            all_day: false,
            tzid: None,
        }),
    }
}

fn parse_duration(raw: &str) -> Option<Duration> {
    let raw = raw.trim();
    let (negative, body) = match raw.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, raw.strip_prefix('+').unwrap_or(raw)),
    };
    let body = body.strip_prefix('P')?;

    let mut total = Duration::zero();
    let mut number = String::new();
    let mut in_time = false;
    for ch in body.chars() {
        match ch {
            'T' => in_time = true,
            '0'..='9' => number.push(ch),
            unit => {
                let n: i64 = number.parse().ok()?;
                number.clear();
                total += match (unit, in_time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(if negative { -total } else { total })
}

fn mailto(prop: &Property) -> Option<String> {
    let raw = value(prop);
    let email = raw
        .strip_prefix("mailto:")
        .or_else(|| raw.strip_prefix("MAILTO:"))
        .unwrap_or(raw)
        .trim();
    email.contains('@').then(|| email.to_string())
}

fn first<'a>(props: &'a [Property], name: &str) -> Option<&'a Property> {
    props.iter().find(|p| p.name.eq_ignore_ascii_case(name))
}

fn text(props: &[Property], name: &str) -> Option<String> {
    first(props, name)
        .map(|p| unescape(value(p)))
        .filter(|t| !t.is_empty())
}

fn iso(utc: DateTime<Utc>) -> String {
    utc.to_rfc3339()
}

/// Builds the iCalendar text `rrule` needs, keeping the original zone so
/// repeating meetings stay at the same local time across daylight saving.
fn recurrence_text(props: &[Property], start: &Dt) -> Option<String> {
    let rules: Vec<&Property> = props
        .iter()
        .filter(|p| p.name.eq_ignore_ascii_case("RRULE"))
        .collect();
    if rules.is_empty() {
        return None;
    }

    let compact = start.utc.format("%Y%m%dT%H%M%S").to_string();
    let mut out = if start.all_day {
        format!("DTSTART;VALUE=DATE:{}\n", start.utc.format("%Y%m%d"))
    } else if let Some(tz) = &start.tzid {
        let local = tz.parse::<chrono_tz::Tz>().ok().map(|tz| {
            start
                .utc
                .with_timezone(&tz)
                .format("%Y%m%dT%H%M%S")
                .to_string()
        })?;
        format!("DTSTART;TZID={tz}:{local}\n")
    } else {
        format!("DTSTART:{compact}Z\n")
    };

    for rule in rules {
        out.push_str(&format!("RRULE:{}\n", value(rule)));
    }
    for prop in props
        .iter()
        .filter(|p| p.name.eq_ignore_ascii_case("EXDATE") || p.name.eq_ignore_ascii_case("RDATE"))
    {
        let raw = value(prop);
        let line = match param(prop, "TZID").and_then(resolve_tz) {
            Some((_, name)) => format!("{};TZID={name}:{raw}\n", prop.name.to_uppercase()),
            None if param(prop, "VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE")) => {
                format!("{};VALUE=DATE:{raw}\n", prop.name.to_uppercase())
            }
            None => format!("{}:{raw}\n", prop.name.to_uppercase()),
        };
        out.push_str(&line);
    }
    Some(out)
}

fn attendee_from(prop: &Property) -> EventAttendee {
    let status = match param(prop, "PARTSTAT")
        .map(str::to_ascii_uppercase)
        .as_deref()
    {
        Some("ACCEPTED") => AttendeeStatus::Accepted,
        Some("DECLINED") => AttendeeStatus::Declined,
        Some("TENTATIVE") => AttendeeStatus::Tentative,
        _ => AttendeeStatus::Pending,
    };
    let role = match param(prop, "ROLE").map(str::to_ascii_uppercase).as_deref() {
        Some("CHAIR") => AttendeeRole::Chair,
        Some("OPT-PARTICIPANT") => AttendeeRole::Optional,
        Some("NON-PARTICIPANT") => AttendeeRole::NonParticipant,
        _ => AttendeeRole::Required,
    };

    EventAttendee {
        name: param(prop, "CN").map(|n| n.trim_matches('"').to_string()),
        email: mailto(prop),
        is_current_user: false,
        status,
        role,
    }
}

struct Parsed {
    uid: String,
    props: Vec<Property>,
    start: Dt,
    duration: Duration,
    recurrence_id: Option<DateTime<Utc>>,
}

fn parse_event(props: Vec<Property>) -> Option<Parsed> {
    let start = parse_dt(first(&props, "DTSTART")?)?;

    let duration = match first(&props, "DTEND").and_then(parse_dt) {
        Some(end) if end.utc >= start.utc => end.utc - start.utc,
        _ => match first(&props, "DURATION").and_then(|p| parse_duration(value(p))) {
            Some(duration) => duration,
            None if start.all_day => Duration::days(1),
            None => Duration::hours(1),
        },
    };

    let uid = text(&props, "UID").unwrap_or_else(|| {
        format!(
            "{}-{}",
            text(&props, "SUMMARY").unwrap_or_default(),
            start.utc.timestamp()
        )
    });
    let recurrence_id = first(&props, "RECURRENCE-ID")
        .and_then(parse_dt)
        .map(|d| d.utc);

    Some(Parsed {
        uid,
        props,
        start,
        duration,
        recurrence_id,
    })
}

fn to_event(
    parsed: &Parsed,
    start: DateTime<Utc>,
    calendar_id: &str,
    is_instance: bool,
) -> CalendarEvent {
    let props = &parsed.props;
    let description = text(props, "DESCRIPTION");
    let location = text(props, "LOCATION");
    let url = text(props, "URL");

    let meeting_source = [location.as_deref(), description.as_deref(), url.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n");

    let status = match text(props, "STATUS")
        .map(|s| s.to_ascii_uppercase())
        .as_deref()
    {
        Some("TENTATIVE") => EventStatus::Tentative,
        Some("CANCELLED") => EventStatus::Cancelled,
        _ => EventStatus::Confirmed,
    };

    let organizer = first(props, "ORGANIZER").map(|p| EventPerson {
        name: param(p, "CN").map(|n| n.trim_matches('"').to_string()),
        email: mailto(p),
        is_current_user: false,
    });

    let attendees = props
        .iter()
        .filter(|p| p.name.eq_ignore_ascii_case("ATTENDEE"))
        .map(attendee_from)
        .collect();

    let has_rule = props.iter().any(|p| p.name.eq_ignore_ascii_case("RRULE"));

    CalendarEvent {
        provider: CalendarProviderType::Ics,
        id: if is_instance {
            format!("{}:{}", parsed.uid, start.format("%Y%m%dT%H%M%SZ"))
        } else {
            parsed.uid.clone()
        },
        calendar_id: calendar_id.to_string(),
        external_id: parsed.uid.clone(),
        title: text(props, "SUMMARY").unwrap_or_else(|| "Untitled event".to_string()),
        description,
        location,
        url,
        meeting_link: crate::parse_meeting_link(&meeting_source),
        started_at: iso(start),
        ended_at: iso(start + parsed.duration),
        timezone: parsed.start.tzid.clone(),
        is_all_day: parsed.start.all_day,
        status,
        organizer,
        attendees,
        has_recurrence_rules: has_rule || parsed.recurrence_id.is_some(),
        recurring_event_id: (is_instance || parsed.recurrence_id.is_some())
            .then(|| parsed.uid.clone()),
        raw: String::new(),
    }
}

pub(crate) fn parse_events(
    ics: &str,
    calendar_id: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<CalendarEvent> {
    let mut parsed_events = Vec::new();
    for calendar in IcalParser::new(BufReader::new(ics.as_bytes())).flatten() {
        for event in calendar.events {
            if let Some(parsed) = parse_event(event.properties) {
                parsed_events.push(parsed);
            }
        }
    }

    // Edited single occurrences of a repeating event replace the generated one.
    let overridden: HashSet<(String, i64)> = parsed_events
        .iter()
        .filter_map(|e| Some((e.uid.clone(), e.recurrence_id?.timestamp())))
        .collect();

    let mut events = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();

    for parsed in &parsed_events {
        let recurrence = if parsed.recurrence_id.is_none() {
            recurrence_text(&parsed.props, &parsed.start)
        } else {
            None
        };

        match recurrence.and_then(|text| text.parse::<rrule::RRuleSet>().ok()) {
            Some(set) => {
                let window_start = (from - parsed.duration).with_timezone(&rrule::Tz::UTC);
                let window_end = to.with_timezone(&rrule::Tz::UTC);
                let result = set
                    .after(window_start)
                    .before(window_end)
                    .all(MAX_INSTANCES_PER_EVENT);

                for date in result.dates {
                    let start = date.with_timezone(&Utc);
                    if overridden.contains(&(parsed.uid.clone(), start.timestamp())) {
                        continue;
                    }
                    events.push(to_event(parsed, start, calendar_id, true));
                }
            }
            None => {
                let start = parsed.start.utc;
                if start < to && start + parsed.duration > from {
                    let is_override = parsed.recurrence_id.is_some();
                    let mut event = to_event(parsed, start, calendar_id, false);
                    if is_override {
                        event.id = format!(
                            "{}:{}",
                            parsed.uid,
                            parsed
                                .recurrence_id
                                .map(|r| r.format("%Y%m%dT%H%M%SZ").to_string())
                                .unwrap_or_default()
                        );
                    }
                    // Some feeds repeat a UID; keep ids unique.
                    let count = seen.entry(event.id.clone()).or_insert(0);
                    *count += 1;
                    if *count > 1 {
                        event.id = format!("{}#{}", event.id, count);
                    }
                    events.push(event);
                }
            }
        }
    }

    events.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const FEED: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Work\r\n\
BEGIN:VEVENT\r\nUID:one@x\r\nDTSTART:20261020T090000Z\r\nDTEND:20261020T093000Z\r\nSUMMARY:Standup\\, daily\r\nDESCRIPTION:Join https://meet.google.com/abc-defg-hij\r\n\
ORGANIZER;CN=Ana:mailto:ana@x.com\r\nATTENDEE;CN=Bo;PARTSTAT=ACCEPTED;ROLE=OPT-PARTICIPANT:mailto:bo@x.com\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:day@x\r\nDTSTART;VALUE=DATE:20261021\r\nDTEND;VALUE=DATE:20261022\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:week@x\r\nDTSTART;TZID=America/New_York:20261019T100000\r\nDTEND;TZID=America/New_York:20261019T110000\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=America/New_York:20261026T100000\r\nSUMMARY:Weekly sync\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:week@x\r\nRECURRENCE-ID;TZID=America/New_York:20261102T100000\r\nDTSTART;TZID=America/New_York:20261102T140000\r\nDTEND;TZID=America/New_York:20261102T150000\r\nSUMMARY:Weekly sync (moved)\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn parses_single_all_day_and_details() {
        let events = parse_events(
            FEED,
            "cal",
            utc("2026-10-20T00:00:00Z"),
            utc("2026-10-22T23:59:00Z"),
        );
        let standup = events.iter().find(|e| e.external_id == "one@x").unwrap();
        assert_eq!(standup.title, "Standup, daily");
        assert_eq!(standup.started_at, "2026-10-20T09:00:00+00:00");
        assert_eq!(standup.ended_at, "2026-10-20T09:30:00+00:00");
        assert_eq!(
            standup.meeting_link.as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );
        assert_eq!(standup.attendees[0].email.as_deref(), Some("bo@x.com"));
        assert_eq!(standup.attendees[0].role, AttendeeRole::Optional);
        assert_eq!(
            standup.organizer.as_ref().unwrap().name.as_deref(),
            Some("Ana")
        );

        let holiday = events.iter().find(|e| e.external_id == "day@x").unwrap();
        assert!(holiday.is_all_day);
        assert_eq!(holiday.started_at, "2026-10-21T00:00:00+00:00");
    }

    #[test]
    fn expands_weekly_events_with_exdate_and_override() {
        let events = parse_events(
            FEED,
            "cal",
            utc("2026-10-19T00:00:00Z"),
            utc("2026-11-30T00:00:00Z"),
        );
        let weekly: Vec<_> = events
            .iter()
            .filter(|e| e.external_id == "week@x")
            .collect();

        let titles: Vec<_> = weekly.iter().map(|e| e.title.as_str()).collect();
        // Oct 19, (Oct 26 excluded), Nov 2 replaced by the moved one, Nov 9.
        assert_eq!(weekly.len(), 3, "{titles:?}");
        assert!(titles.contains(&"Weekly sync (moved)"));
        assert_eq!(titles.iter().filter(|t| **t == "Weekly sync").count(), 2);

        // 10:00 New York stays 10:00 local: EDT (-4) in October, EST (-5) in November.
        let first = weekly
            .iter()
            .find(|e| e.started_at.starts_with("2026-10-19"))
            .unwrap();
        assert_eq!(first.started_at, "2026-10-19T14:00:00+00:00");
        let nov9 = weekly
            .iter()
            .find(|e| e.started_at.starts_with("2026-11-09"))
            .unwrap();
        assert_eq!(nov9.started_at, "2026-11-09T15:00:00+00:00");
    }

    #[test]
    fn maps_windows_time_zone_names() {
        let feed = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:w@x\r\nDTSTART;TZID=Pacific Standard Time:20261020T090000\r\nDTEND;TZID=Pacific Standard Time:20261020T100000\r\nSUMMARY:West\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let events = parse_events(
            feed,
            "cal",
            utc("2026-10-20T00:00:00Z"),
            utc("2026-10-21T00:00:00Z"),
        );
        assert_eq!(events[0].started_at, "2026-10-20T16:00:00+00:00");
    }

    #[test]
    fn normalizes_links() {
        assert_eq!(
            normalize_url("webcal://calendar.example.com/a.ics").unwrap(),
            "https://calendar.example.com/a.ics"
        );
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert!(normalize_url("not a url").is_err());
        assert_eq!(calendar_name(FEED).as_deref(), Some("Work"));
    }

    #[test]
    fn parses_durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(Duration::minutes(90)));
        assert_eq!(parse_duration("P1D"), Some(Duration::days(1)));
        assert_eq!(parse_duration("P1W"), Some(Duration::weeks(1)));
    }
}
