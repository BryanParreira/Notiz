use std::time::Duration;

use imap::types::Flag;

use crate::error::Error;
use crate::store::StoredAccount;
use crate::{MailBody, MailMessage};

const NETWORK_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_LIMIT: usize = 100;
const MAX_FETCH_BYTES: usize = 6_000_000;
const MAX_HTML_BYTES: usize = 2_500_000;
const MAX_INLINE_IMAGE_BYTES: usize = 1_000_000;
const MAX_INLINE_TOTAL_BYTES: usize = 4_000_000;
const MAX_TEXT_CHARS: usize = 30_000;

type Session = imap::Session<imap::Connection>;

fn connect(account: &StoredAccount) -> Result<Session, Error> {
    let client = imap::ClientBuilder::new(account.host.as_str(), account.port)
        .connect()
        .map_err(|e| Error::Imap(e.to_string()))?;

    client
        .login(&account.username, &account.password)
        .map_err(|(e, _)| Error::Login(e.to_string()))
}

async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    let task = tokio::task::spawn_blocking(job);
    match tokio::time::timeout(NETWORK_TIMEOUT, task).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => Err(Error::Imap(e.to_string())),
        Err(_) => Err(Error::Timeout),
    }
}

pub(crate) async fn verify(account: &StoredAccount) -> Result<(), Error> {
    let account = account.clone();
    run_blocking(move || {
        let mut session = connect(&account)?;
        let _ = session.logout();
        Ok(())
    })
    .await
}

// Addresses go straight into an IMAP search string, so anything that could
// break out of the quoted argument is dropped rather than escaped.
pub(crate) fn sanitize_addresses(addresses: Vec<String>) -> Vec<String> {
    let mut clean: Vec<String> = addresses
        .into_iter()
        .map(|a| a.trim().to_lowercase())
        .filter(|a| {
            !a.is_empty()
                && a.contains('@')
                && a.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "@._+-".contains(c))
        })
        .collect();
    clean.sort();
    clean.dedup();
    clean.truncate(10);
    clean
}

fn build_query(addresses: &[String]) -> String {
    let keys: Vec<String> = addresses
        .iter()
        .flat_map(|a| [format!("FROM \"{a}\""), format!("TO \"{a}\"")])
        .collect();

    // IMAP's OR takes exactly two keys, so fold the list into nested pairs.
    keys.into_iter()
        .rev()
        .reduce(|acc, key| format!("OR {key} {acc}"))
        .unwrap_or_else(|| "ALL".to_string())
}

pub(crate) async fn search(
    account: StoredAccount,
    addresses: Option<Vec<String>>,
    limit: usize,
) -> Result<Vec<MailMessage>, Error> {
    let limit = limit.clamp(1, MAX_LIMIT);

    run_blocking(move || {
        let mut session = connect(&account)?;
        session
            .examine("INBOX")
            .map_err(|e| Error::Imap(e.to_string()))?;

        let query = addresses
            .as_deref()
            .map(build_query)
            .unwrap_or_else(|| "ALL".to_string());

        let mut uids: Vec<u32> = session
            .uid_search(&query)
            .map_err(|e| Error::Imap(e.to_string()))?
            .into_iter()
            .collect();
        uids.sort_unstable_by(|a, b| b.cmp(a));
        uids.truncate(limit);

        if uids.is_empty() {
            let _ = session.logout();
            return Ok(Vec::new());
        }

        let set = uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let fetched = session
            .uid_fetch(
                &set,
                "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])",
            )
            .map_err(|e| Error::Imap(e.to_string()))?;

        let mut messages: Vec<MailMessage> = fetched
            .iter()
            .filter_map(|fetch| {
                let uid = fetch.uid?;
                let (subject, from_name, from_email) =
                    parse_headers(fetch.header().unwrap_or_default());

                Some(MailMessage {
                    uid,
                    subject,
                    from_name,
                    from_email,
                    date: fetch
                        .internal_date()
                        .map(|d| d.to_rfc3339())
                        .unwrap_or_default(),
                    seen: fetch.flags().iter().any(|f| matches!(f, Flag::Seen)),
                })
            })
            .collect();

        messages.sort_unstable_by(|a, b| b.uid.cmp(&a.uid));
        let _ = session.logout();
        Ok(messages)
    })
    .await
}

pub(crate) async fn read_message(account: StoredAccount, uid: u32) -> Result<MailBody, Error> {
    run_blocking(move || {
        let mut session = connect(&account)?;
        session
            .examine("INBOX")
            .map_err(|e| Error::Imap(e.to_string()))?;

        let query = format!("(UID INTERNALDATE BODY.PEEK[]<0.{MAX_FETCH_BYTES}>)");
        let fetched = session
            .uid_fetch(uid.to_string(), query)
            .map_err(|e| Error::Imap(e.to_string()))?;

        let fetch = fetched
            .iter()
            .next()
            .ok_or_else(|| Error::Imap("message not found".to_string()))?;
        let raw = fetch.body().or_else(|| fetch.text()).unwrap_or_default();

        let mut body = parse_message(raw);
        body.uid = uid;
        if body.date.is_empty() {
            body.date = fetch
                .internal_date()
                .map(|d| d.to_rfc3339())
                .unwrap_or_default();
        }
        let _ = session.logout();
        Ok(body)
    })
    .await
}

pub(crate) fn parse_message(raw: &[u8]) -> MailBody {
    let mut body = MailBody {
        uid: 0,
        subject: String::new(),
        from_name: String::new(),
        from_email: String::new(),
        to: String::new(),
        date: String::new(),
        text: String::new(),
        html: String::new(),
        truncated: raw.len() >= MAX_FETCH_BYTES,
    };

    let Ok(parsed) = mailparse::parse_mail(raw) else {
        return body;
    };

    for header in &parsed.headers {
        match header.get_key_ref().to_ascii_lowercase().as_str() {
            "subject" => body.subject = header.get_value(),
            "to" => body.to = header.get_value(),
            "date" => {
                if let Ok(ts) = mailparse::dateparse(&header.get_value())
                    && let Some(dt) = chrono::DateTime::from_timestamp(ts, 0)
                {
                    body.date = dt.to_rfc3339();
                }
            }
            "from" => {
                if let Ok(list) = mailparse::addrparse(&header.get_value())
                    && let Some(mailparse::MailAddr::Single(info)) = list.first()
                {
                    body.from_name = info.display_name.clone().unwrap_or_default();
                    body.from_email = info.addr.clone();
                }
            }
            _ => {}
        }
    }

    let mut plain = None;
    let mut html = None;
    let mut inline_images = std::collections::HashMap::new();
    let mut inline_total = 0usize;
    collect_text(
        &parsed,
        &mut plain,
        &mut html,
        &mut inline_images,
        &mut inline_total,
    );

    if let Some(markup) = html.as_deref() {
        let mut markup = markup.to_string();
        for (cid, data_uri) in &inline_images {
            markup = markup.replace(&format!("cid:{cid}"), data_uri);
        }
        if markup.len() <= MAX_HTML_BYTES {
            body.html = markup;
        } else {
            body.truncated = true;
        }
    }

    let text = plain
        .filter(|t| !t.trim().is_empty())
        .or_else(|| html.map(|h| html_to_text(&h)))
        .unwrap_or_default();

    body.text = clean_text(&text);
    if body.text.chars().count() > MAX_TEXT_CHARS {
        body.text = body.text.chars().take(MAX_TEXT_CHARS).collect::<String>();
        body.truncated = true;
    }
    body
}

fn collect_text(
    part: &mailparse::ParsedMail<'_>,
    plain: &mut Option<String>,
    html: &mut Option<String>,
    inline_images: &mut std::collections::HashMap<String, String>,
    inline_total: &mut usize,
) {
    if part.subparts.is_empty() {
        let mime = part.ctype.mimetype.to_ascii_lowercase();

        if mime.starts_with("image/") {
            let content_id = part
                .headers
                .iter()
                .find(|h| h.get_key_ref().eq_ignore_ascii_case("content-id"))
                .map(|h| h.get_value().trim().trim_matches(['<', '>']).to_string());
            if let (Some(cid), Ok(bytes)) = (content_id, part.get_body_raw())
                && !cid.is_empty()
                && bytes.len() <= MAX_INLINE_IMAGE_BYTES
                && *inline_total + bytes.len() <= MAX_INLINE_TOTAL_BYTES
            {
                use base64::Engine;
                *inline_total += bytes.len();
                inline_images.insert(
                    cid,
                    format!(
                        "data:{mime};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(bytes)
                    ),
                );
            }
            return;
        }

        let is_attachment =
            part.get_content_disposition().disposition == mailparse::DispositionType::Attachment;
        if is_attachment {
            return;
        }
        if mime == "text/plain" && plain.is_none() {
            *plain = part.get_body().ok();
        } else if mime == "text/html" && html.is_none() {
            *html = part.get_body().ok();
        }
        return;
    }
    for sub in &part.subparts {
        collect_text(sub, plain, html, inline_images, inline_total);
    }
}

fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let rest = &lower[i..];
            let skip_to = if rest.starts_with("<script") {
                lower[i..].find("</script>").map(|n| i + n + 9)
            } else if rest.starts_with("<style") {
                lower[i..].find("</style>").map(|n| i + n + 8)
            } else if rest.starts_with("<!--") {
                lower[i..].find("-->").map(|n| i + n + 3)
            } else {
                None
            };
            if let Some(next) = skip_to {
                i = next;
                continue;
            }
            let end = lower[i..]
                .find('>')
                .map(|n| i + n + 1)
                .unwrap_or(bytes.len());
            let tag = &lower[i + 1..end.saturating_sub(1).max(i + 1)];
            let name = tag
                .trim_start_matches('/')
                .split(|c: char| c.is_whitespace() || c == '/' || c == '>')
                .next()
                .unwrap_or("");
            if matches!(
                name,
                "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" | "h4" | "table"
            ) {
                out.push('\n');
            }
            i = end;
        } else {
            let next = html[i..].find('<').map(|n| i + n).unwrap_or(html.len());
            out.push_str(&html[i..next]);
            i = next;
        }
    }

    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&zwnj;", "")
}

fn clean_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_run = 0;
    for line in text.replace("\r\n", "\n").lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
        } else {
            blank_run = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

fn parse_headers(raw: &[u8]) -> (String, String, String) {
    let Ok((headers, _)) = mailparse::parse_headers(raw) else {
        return (String::new(), String::new(), String::new());
    };

    let mut subject = String::new();
    let mut from_name = String::new();
    let mut from_email = String::new();

    for header in &headers {
        match header.get_key_ref().to_ascii_lowercase().as_str() {
            "subject" => subject = header.get_value(),
            "from" => {
                if let Ok(list) = mailparse::addrparse(&header.get_value())
                    && let Some(mailparse::MailAddr::Single(info)) = list.first()
                {
                    from_name = info.display_name.clone().unwrap_or_default();
                    from_email = info.addr.clone();
                }
            }
            _ => {}
        }
    }

    (subject, from_name, from_email)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_drops_unsafe_and_duplicate_addresses() {
        let clean = sanitize_addresses(vec![
            "A@X.com".into(),
            "a@x.com".into(),
            "evil\" OR ALL \"@x.com".into(),
            "no-at-sign".into(),
            "".into(),
        ]);
        assert_eq!(clean, vec!["a@x.com".to_string()]);
    }

    #[test]
    fn query_nests_or_pairs() {
        let q = build_query(&["a@x.com".into()]);
        assert_eq!(q, "OR FROM \"a@x.com\" TO \"a@x.com\"");

        let q = build_query(&["a@x.com".into(), "b@y.com".into()]);
        assert_eq!(
            q,
            "OR FROM \"a@x.com\" OR TO \"a@x.com\" OR FROM \"b@y.com\" TO \"b@y.com\""
        );
    }

    #[test]
    fn reads_plain_text_part_and_ignores_attachments() {
        let raw = b"From: Ana <ana@x.com>\r\nTo: me@x.com\r\nSubject: Hi\r\nDate: Mon, 19 Oct 2026 10:00:00 +0000\r\nContent-Type: multipart/mixed; boundary=B\r\n\r\n--B\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello there\r\n\r\n\r\n\r\nBye\r\n--B\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=a.pdf\r\n\r\nJVBERi0=\r\n--B--\r\n";
        let body = parse_message(raw);
        assert_eq!(body.subject, "Hi");
        assert_eq!(body.from_email, "ana@x.com");
        assert_eq!(body.text, "Hello there\n\nBye");
        assert!(!body.date.is_empty());
        assert!(body.html.is_empty());
    }

    #[test]
    fn keeps_html_and_inlines_cid_images() {
        let raw = b"Subject: Logo\r\nContent-Type: multipart/related; boundary=R\r\n\r\n--R\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hi</p><img src=\"cid:logo123\">\r\n--R\r\nContent-Type: image/png\r\nContent-ID: <logo123>\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--R--\r\n";
        let body = parse_message(raw);
        assert!(body.html.contains("<p>Hi</p>"));
        assert!(body.html.contains("data:image/png;base64,"));
        assert!(!body.html.contains("cid:logo123"));
        assert_eq!(body.text, "Hi");
    }

    #[test]
    fn falls_back_to_html_without_scripts_or_tags() {
        let raw = b"Subject: News\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><style>p{color:red}</style><body><p>Hello &amp; welcome</p><script>alert(1)</script><div>Second line</div></body></html>";
        let body = parse_message(raw);
        assert!(body.text.contains("Hello & welcome"));
        assert!(body.text.contains("Second line"));
        assert!(!body.text.contains("alert"));
        assert!(!body.text.contains("color:red"));
    }

    #[test]
    fn parses_encoded_subject_and_sender() {
        let raw =
            b"From: =?UTF-8?Q?Ana_P=C3=A9rez?= <ana@x.com>\r\nSubject: =?UTF-8?Q?Q4_plan?=\r\n\r\n";
        let (subject, name, email) = parse_headers(raw);
        assert_eq!(subject, "Q4 plan");
        assert_eq!(name, "Ana Pérez");
        assert_eq!(email, "ana@x.com");
    }
}
