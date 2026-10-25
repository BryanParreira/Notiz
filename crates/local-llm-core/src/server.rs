use std::{path::Path, time::Duration};

use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::Error;

const READY_TIMEOUT: Duration = Duration::from_secs(60);
const READY_POLL_INTERVAL: Duration = Duration::from_millis(300);

pub struct LlmServer {
    child: CommandChild,
    base_url: String,
    exit_rx: tokio::sync::watch::Receiver<bool>,
}

impl LlmServer {
    pub async fn start_with_model_path(
        _name: String,
        file_path: impl AsRef<Path>,
        command: tauri_plugin_shell::process::Command,
    ) -> Result<Self, Error> {
        let file_path = file_path.as_ref();
        if !file_path.exists() {
            return Err(Error::ModelNotDownloaded);
        }

        let port = port_check::free_local_port()
            .ok_or_else(|| Error::ServerSpawnFailed("no free local port available".into()))?;

        let command = command.args([
            "--model",
            &file_path.to_string_lossy(),
            "--port",
            &port.to_string(),
            "--host",
            "127.0.0.1",
            "-ngl",
            "99",
            // 32768 previously here needed several GB of GPU memory just for
            // the KV cache (about 0.1 MB per token on this model), enough to
            // exhaust unified memory on 16GB Macs and crash the Metal compute
            // pipeline. 4096 left no room once tool descriptions, instructions
            // and a reply were in play ("context size exceeded"). 8192 costs
            // roughly half a gigabyte more, and only while the model is loaded:
            // it is unloaded after a few idle minutes.
            "--ctx-size",
            "8192",
        ]);

        let (mut rx, child) = command
            .spawn()
            .map_err(|e| Error::ServerSpawnFailed(e.to_string()))?;

        let (exit_tx, exit_rx) = tokio::sync::watch::channel(false);
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                if let CommandEvent::Terminated(_) = event {
                    let _ = exit_tx.send(true);
                    break;
                }
            }
        });

        if let Err(e) = wait_for_ready(port).await {
            let _ = child.kill();
            return Err(e);
        }

        Ok(Self {
            child,
            base_url: format!("http://127.0.0.1:{port}/v1"),
            exit_rx,
        })
    }

    pub fn url(&self) -> &str {
        &self.base_url
    }

    pub fn exit_receiver(&self) -> tokio::sync::watch::Receiver<bool> {
        self.exit_rx.clone()
    }

    pub async fn stop(self) {
        let _ = self.child.kill();
    }
}

async fn wait_for_ready(port: u16) -> Result<(), Error> {
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;

    loop {
        if health_check(port).await {
            return Ok(());
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(Error::ServerReadinessTimeout);
        }

        tokio::time::sleep(READY_POLL_INTERVAL).await;
    }
}

// llama-server binds its listener before the model finishes loading, so a bare
// TCP connect isn't a reliable readiness signal — it responds 503 on `/health`
// until the model is actually loaded and ready to serve requests.
async fn health_check(port: u16) -> bool {
    let Ok(mut stream) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await else {
        return false;
    };

    let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).await.is_err() {
        return false;
    }

    let mut response = Vec::new();
    if stream.read_to_end(&mut response).await.is_err() {
        return false;
    }

    response.starts_with(b"HTTP/1.1 200") || response.starts_with(b"HTTP/1.0 200")
}
