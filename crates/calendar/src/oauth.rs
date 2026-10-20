use std::time::Duration;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use notiz_calendar_interface::CalendarProviderType;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::accounts::{self, LOCK, StoredAccount};
use crate::error::Error;

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

struct ProviderConfig {
    auth_url: &'static str,
    token_url: &'static str,
    scope: &'static str,
    redirect_host: &'static str,
    client_id: Option<String>,
    client_secret: Option<String>,
    extra: &'static [(&'static str, &'static str)],
}

// Client IDs identify the app registration, not a user, and desktop OAuth
// clients are public by design (PKCE replaces the secret). They are read at
// build time, with a runtime override for development.
fn setting(compiled: Option<&'static str>, runtime_key: &str) -> Option<String> {
    compiled
        .map(str::to_string)
        .or_else(|| std::env::var(runtime_key).ok())
        .filter(|v| !v.is_empty())
}

fn config(provider: CalendarProviderType) -> Result<ProviderConfig, Error> {
    match provider {
        CalendarProviderType::Google => Ok(ProviderConfig {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
            redirect_host: "127.0.0.1",
            client_id: setting(
                option_env!("NOTIZ_GOOGLE_CLIENT_ID"),
                "NOTIZ_GOOGLE_CLIENT_ID",
            ),
            client_secret: setting(
                option_env!("NOTIZ_GOOGLE_CLIENT_SECRET"),
                "NOTIZ_GOOGLE_CLIENT_SECRET",
            ),
            extra: &[("access_type", "offline"), ("prompt", "consent")],
        }),
        CalendarProviderType::Outlook => Ok(ProviderConfig {
            auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            scope: "offline_access openid email Calendars.Read",
            redirect_host: "localhost",
            client_id: setting(
                option_env!("NOTIZ_MICROSOFT_CLIENT_ID"),
                "NOTIZ_MICROSOFT_CLIENT_ID",
            ),
            client_secret: None,
            extra: &[("prompt", "select_account")],
        }),
        CalendarProviderType::Apple | CalendarProviderType::Ics => {
            Err(Error::UnsupportedOperation {
                operation: "sign_in",
                provider,
            })
        }
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    id_token: Option<String>,
}

fn random_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn form_body(params: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(params)
        .finish()
}

async fn token_request(token_url: &str, params: &[(&str, &str)]) -> Result<TokenResponse, Error> {
    let resp = reqwest::Client::new()
        .post(token_url)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(form_body(params))
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(Error::OAuth(format!("token endpoint returned {status}")));
    }
    serde_json::from_str(&body).map_err(|e| Error::OAuth(e.to_string()))
}

fn label_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    ["email", "preferred_username"]
        .iter()
        .find_map(|key| claims.get(*key)?.as_str().map(str::to_string))
}

pub(crate) struct PendingSignIn {
    provider: CalendarProviderType,
    cfg: ProviderConfig,
    listener: TcpListener,
    redirect_uri: String,
    verifier: String,
    state: String,
    pub(crate) auth_url: String,
}

pub(crate) async fn begin(provider: CalendarProviderType) -> Result<PendingSignIn, Error> {
    let cfg = config(provider)?;
    let client_id = cfg
        .client_id
        .clone()
        .ok_or(Error::NotConfigured { provider })?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| Error::OAuth(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| Error::OAuth(e.to_string()))?
        .port();
    let redirect_uri = format!("http://{}:{port}", cfg.redirect_host);

    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token();

    let mut params: Vec<(&str, &str)> = vec![
        ("response_type", "code"),
        ("client_id", &client_id),
        ("redirect_uri", &redirect_uri),
        ("scope", cfg.scope),
        ("state", &state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
    ];
    params.extend_from_slice(cfg.extra);

    let auth_url = url::Url::parse_with_params(cfg.auth_url, &params)
        .map_err(|e| Error::OAuth(e.to_string()))?
        .to_string();

    Ok(PendingSignIn {
        provider,
        cfg,
        listener,
        redirect_uri,
        verifier,
        state,
        auth_url,
    })
}

impl PendingSignIn {
    pub(crate) async fn finish(self) -> Result<StoredAccount, Error> {
        let code = tokio::time::timeout(SIGN_IN_TIMEOUT, self.wait_for_code())
            .await
            .map_err(|_| Error::OAuth("sign-in timed out".to_string()))??;

        let client_id = self.cfg.client_id.clone().unwrap_or_default();
        let mut params: Vec<(&str, &str)> = vec![
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("client_id", &client_id),
            ("redirect_uri", &self.redirect_uri),
            ("code_verifier", &self.verifier),
        ];
        if let Some(secret) = self.cfg.client_secret.as_deref() {
            params.push(("client_secret", secret));
        }

        let tokens = token_request(self.cfg.token_url, &params).await?;
        let refresh_token = tokens
            .refresh_token
            .ok_or_else(|| Error::OAuth("provider did not return a refresh token".to_string()))?;

        let account = StoredAccount {
            provider: self.provider,
            connection_id: uuid::Uuid::new_v4().to_string(),
            label: tokens
                .id_token
                .as_deref()
                .and_then(label_from_id_token)
                .unwrap_or_else(|| "Account".to_string()),
            access_token: tokens.access_token,
            refresh_token,
            expires_at: chrono::Utc::now().timestamp() + tokens.expires_in.unwrap_or(3600),
            url: None,
        };

        let _guard = LOCK.lock().await;
        let mut stored = accounts::load()?;
        stored.push(account.clone());
        accounts::save(&stored)?;

        Ok(account)
    }

    async fn wait_for_code(&self) -> Result<String, Error> {
        loop {
            let (mut stream, _) = self
                .listener
                .accept()
                .await
                .map_err(|e| Error::OAuth(e.to_string()))?;

            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let target = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/");

            let Ok(url) = url::Url::parse(&format!("http://localhost{target}")) else {
                respond(&mut stream, "400 Bad Request", "Invalid request.").await;
                continue;
            };

            let mut code = None;
            let mut state = None;
            let mut error = None;
            for (key, value) in url.query_pairs() {
                match key.as_ref() {
                    "code" => code = Some(value.into_owned()),
                    "state" => state = Some(value.into_owned()),
                    "error" => error = Some(value.into_owned()),
                    _ => {}
                }
            }

            if let Some(error) = error {
                respond(
                    &mut stream,
                    "200 OK",
                    "Sign-in was cancelled. You can close this tab.",
                )
                .await;
                return Err(Error::OAuth(error));
            }

            match (code, state) {
                (Some(code), Some(state)) if state == self.state => {
                    respond(
                        &mut stream,
                        "200 OK",
                        "Notiz is connected. You can close this tab.",
                    )
                    .await;
                    return Ok(code);
                }
                (None, _) => {
                    // Browsers also probe /favicon.ico; keep waiting.
                    respond(&mut stream, "404 Not Found", "Not found.").await;
                }
                _ => {
                    respond(&mut stream, "400 Bad Request", "State mismatch.").await;
                }
            }
        }
    }
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Notiz</title>\
         <body style=\"font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0\">\
         <p>{message}</p></body>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

pub(crate) async fn access_token(
    provider: CalendarProviderType,
    connection_id: &str,
) -> Result<String, Error> {
    let _guard = LOCK.lock().await;
    let mut stored = accounts::load()?;
    let account = stored
        .iter_mut()
        .find(|a| a.provider == provider && a.connection_id == connection_id)
        .ok_or(Error::NotAuthenticated)?;

    if account.expires_at - 60 > chrono::Utc::now().timestamp() {
        return Ok(account.access_token.clone());
    }

    let cfg = config(provider)?;
    let client_id = cfg
        .client_id
        .clone()
        .ok_or(Error::NotConfigured { provider })?;
    let mut params: Vec<(&str, &str)> = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", &account.refresh_token),
        ("client_id", &client_id),
    ];
    if let Some(secret) = cfg.client_secret.as_deref() {
        params.push(("client_secret", secret));
    }

    let tokens = token_request(cfg.token_url, &params)
        .await
        .map_err(|_| Error::NotAuthenticated)?;

    account.access_token = tokens.access_token;
    account.expires_at = chrono::Utc::now().timestamp() + tokens.expires_in.unwrap_or(3600);
    if let Some(refresh_token) = tokens.refresh_token {
        account.refresh_token = refresh_token;
    }
    let token = account.access_token.clone();

    accounts::save(&stored)?;
    Ok(token)
}

pub(crate) async fn remove_account(
    provider: CalendarProviderType,
    connection_id: &str,
) -> Result<(), Error> {
    let _guard = LOCK.lock().await;
    let mut stored = accounts::load()?;
    stored.retain(|a| !(a.provider == provider && a.connection_id == connection_id));
    accounts::save(&stored)
}
