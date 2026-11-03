use std::{path::Path, time::Duration};

use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::Error;

const READY_TIMEOUT: Duration = Duration::from_secs(60);
const READY_POLL_INTERVAL: Duration = Duration::from_millis(300);

// The conversation memory grows with the context size. On an 8 GB Mac, with
// the speech model and the app also loaded, a smaller window keeps the chat
// model from pushing the machine into swap.
fn ctx_size_for_memory(total_memory_bytes: Option<u64>) -> u32 {
    match total_memory_bytes {
        Some(bytes) if bytes >= 12 * 1024 * 1024 * 1024 => 8192,
        _ => 4096,
    }
}

// A crash or force-quit leaves llama-server running with no owner. It keeps the
// model in memory, so on a 16GB Mac the next launch cannot load a second copy
// and chat hangs until the readiness timeout.
fn take_field(line: &str) -> Option<(&str, &str)> {
    let line = line.trim_start();
    let end = line.find(char::is_whitespace)?;
    Some((&line[..end], line[end..].trim_start()))
}

fn orphan_pids(ps_output: &str, model_arg: &str) -> Vec<u32> {
    ps_output
        .lines()
        .filter_map(|line| {
            // `ps` pads its columns with runs of spaces, so peel the two
            // numeric fields off one at a time instead of splitting on each space.
            let (pid, rest) = take_field(line)?;
            let (ppid, command) = take_field(rest)?;
            let pid: u32 = pid.parse().ok()?;
            let ppid: u32 = ppid.parse().ok()?;
            (ppid == 1 && command.contains("llama-server") && command.contains(model_arg))
                .then_some(pid)
        })
        .collect()
}

#[cfg(unix)]
async fn reap_orphans(model_path: &Path) {
    let Ok(output) = tokio::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,command="])
        .output()
        .await
    else {
        return;
    };

    let model_arg = format!("--model {}", model_path.display());
    let pids = orphan_pids(&String::from_utf8_lossy(&output.stdout), &model_arg);
    for pid in &pids {
        let _ = tokio::process::Command::new("/bin/kill")
            .arg(pid.to_string())
            .status()
            .await;
    }
    if !pids.is_empty() {
        tokio::time::sleep(Duration::from_millis(800)).await;
    }
}

#[cfg(not(unix))]
async fn reap_orphans(_model_path: &Path) {}

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

        reap_orphans(file_path).await;

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
            // Qwen3.5 thinks before every reply by default: "hello" spends
            // hundreds of tokens on hidden reasoning and shows nothing. An
            // assistant that answers in a moment matters more than that.
            "--reasoning",
            "off",
            "--ctx-size",
            &ctx_size_for_memory(crate::total_memory_bytes()).to_string(),
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

#[cfg(test)]
mod orphan_tests {
    use super::orphan_pids;

    #[test]
    fn only_unowned_servers_for_this_model_are_picked() {
        let ps = "  101     1 /app/llama-server --model /m/llm.gguf --port 5\n  102   500 /app/llama-server --model /m/llm.gguf --port 6\n  103     1 /app/llama-server --model /other.gguf --port 7\n  104     1 /bin/zsh --model /m/llm.gguf\n";
        assert_eq!(orphan_pids(ps, "--model /m/llm.gguf"), vec![101]);
    }
}
