//! Reads the user's Mail.app through AppleScript, so Apple Mail accounts of any
//! provider work without a password or app-specific password in Notiz.
//!
//! Nothing user-controlled is ever spliced into a script except integers, and
//! address filtering happens in Rust after the fetch.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::Error;
use crate::{MailBody, MailMessage};

pub(crate) const HOST: &str = "apple-mail";
const TIMEOUT: Duration = Duration::from_secs(45);
const MAX_LIMIT: usize = 100;
// Filtering by address scans a wider window than a plain "recent" list.
const SEARCH_WINDOW: usize = 150;
const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';

pub(crate) fn is_apple(host: &str) -> bool {
    host == HOST
}

async fn run(script: String) -> Result<String, Error> {
    let mut child = Command::new("/usr/bin/osascript")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| Error::Imap(e.to_string()))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| Error::Imap("could not start osascript".into()))?;
    stdin
        .write_all(script.as_bytes())
        .await
        .map_err(|e| Error::Imap(e.to_string()))?;
    drop(stdin);

    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| Error::Timeout)?
        .map_err(|e| Error::Imap(e.to_string()))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("-1743") || stderr.contains("not allowed") {
        return Err(Error::Login(
            "Notiz is not allowed to control Mail. Turn on Mail for Notiz in System Settings > Privacy & Security > Automation."
                .into(),
        ));
    }
    Err(Error::Imap(stderr.trim().to_string()))
}

/// Triggers the macOS Automation prompt and confirms Mail answers.
pub(crate) async fn verify() -> Result<(), Error> {
    run(r#"tell application "Mail" to return (count of accounts)"#.to_string())
        .await
        .map(|_| ())
}

fn list_script(limit: usize) -> String {
    format!(
        r#"set US to character id 31
set RS to character id 30
set nowEpoch to (do shell script "date +%s") as integer
set nowDate to current date
tell application "Mail"
  set total to count of messages of inbox
  if total is 0 then return ""
  set n to {limit}
  if total < n then set n to total
  set ids to (get id of (messages 1 thru n of inbox))
  set subs to (get subject of (messages 1 thru n of inbox))
  set snds to (get sender of (messages 1 thru n of inbox))
  set dts to (get date received of (messages 1 thru n of inbox))
  set rds to (get read status of (messages 1 thru n of inbox))
end tell
set out to ""
repeat with i from 1 to n
  set out to out & (item i of ids) & US & (item i of subs) & US & (item i of snds) & US & (round (nowEpoch + ((item i of dts) - nowDate))) & US & (item i of rds) & RS
end repeat
return out"#
    )
}

fn read_script(id: u32) -> String {
    format!(
        r#"tell application "Mail"
  set m to first message of inbox whose id is {id}
  return source of m
end tell"#
    )
}

pub(crate) fn parse_sender(raw: &str) -> (String, String) {
    let raw = raw.trim();
    if let (Some(open), Some(close)) = (raw.rfind('<'), raw.rfind('>'))
        && open < close
    {
        let email = raw[open + 1..close].trim().to_string();
        let name = raw[..open].trim().trim_matches('"').trim().to_string();
        return (name, email);
    }
    (String::new(), raw.to_string())
}

pub(crate) fn parse_list(raw: &str) -> Vec<MailMessage> {
    let mut messages: Vec<MailMessage> = raw
        .split(RECORD)
        .filter_map(|record| {
            let mut fields = record.trim_matches(['\n', '\r']).split(FIELD);
            let uid: u32 = fields.next()?.trim().parse().ok()?;
            let subject = fields.next()?.to_string();
            let (from_name, from_email) = parse_sender(fields.next()?);
            // AppleScript prints large integers as reals, e.g. "1.79E+9".
            let epoch: f64 = fields.next()?.trim().parse().ok()?;
            let date = chrono::DateTime::from_timestamp(epoch as i64, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_default();
            let seen = fields.next()?.trim() == "true";

            Some(MailMessage {
                uid,
                subject,
                from_name,
                from_email,
                date,
                seen,
            })
        })
        .collect();

    messages.sort_unstable_by(|a, b| b.date.cmp(&a.date));
    messages
}

pub(crate) async fn search(
    addresses: Option<Vec<String>>,
    limit: usize,
) -> Result<Vec<MailMessage>, Error> {
    let limit = limit.clamp(1, MAX_LIMIT);
    let window = if addresses.is_some() {
        SEARCH_WINDOW
    } else {
        limit
    };

    let mut messages = parse_list(&run(list_script(window)).await?);
    if let Some(addresses) = addresses {
        messages.retain(|m| addresses.contains(&m.from_email.to_lowercase()));
    }
    messages.truncate(limit);
    Ok(messages)
}

pub(crate) async fn read_message(uid: u32) -> Result<MailBody, Error> {
    let source = run(read_script(uid)).await?;
    let bytes = source.as_bytes();
    let capped = &bytes[..bytes.len().min(MAX_SOURCE_BYTES)];

    let mut body = crate::client::parse_message(capped);
    body.uid = uid;
    body.truncated |= bytes.len() > MAX_SOURCE_BYTES;
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_named_and_bare_senders() {
        assert_eq!(
            parse_sender("Fabulove <help@fabulove.co>"),
            ("Fabulove".into(), "help@fabulove.co".into())
        );
        assert_eq!(
            parse_sender("\"Doe, Jane\" <jane@x.com>"),
            ("Doe, Jane".into(), "jane@x.com".into())
        );
        assert_eq!(parse_sender("a@b.com"), (String::new(), "a@b.com".into()));
    }

    #[test]
    fn parses_records_newest_first() {
        let raw = format!(
            "1{f}Old{f}A <a@x.com>{f}1.7E+9{f}true{r}2{f}New{f}B <b@x.com>{f}1.79E+9{f}false{r}",
            f = FIELD,
            r = RECORD
        );
        let list = parse_list(&raw);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].uid, 2);
        assert!(!list[0].seen);
        assert!(list[1].seen);
    }
}
