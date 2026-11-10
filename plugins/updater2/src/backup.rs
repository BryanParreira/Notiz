use std::path::{Path, PathBuf};

const KEEP_BACKUPS: usize = 3;
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const SKIPPED_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "m4a", "ogg", "opus", "flac", "webm", "mp4", "mov", "aac",
];
const BACKUP_DIR: &str = "backups";
const BACKUP_PREFIX: &str = "pre-update-";

fn is_skipped(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SKIPPED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn copy_notes_tree(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_notes_tree(&path, &target)?;
        } else if file_type.is_file() && !is_skipped(&path) {
            if entry.metadata()?.len() > MAX_FILE_BYTES {
                continue;
            }
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

fn prune_old_backups(root: &Path) {
    let Ok(read) = std::fs::read_dir(root) else {
        return;
    };
    let mut backups: Vec<PathBuf> = read
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(BACKUP_PREFIX))
        })
        .collect();
    backups.sort();
    while backups.len() > KEEP_BACKUPS {
        let oldest = backups.remove(0);
        let _ = std::fs::remove_dir_all(oldest);
    }
}

/// Copies the user's notes data (the `sessions` folder and every top-level JSON
/// file such as daily notes, tasks, events and settings) into
/// `backups/pre-update-<version>-<timestamp>` next to the app data, skipping
/// audio and oversized files, and keeps only the most recent few. Best effort:
/// a failure is logged and never blocks the update.
pub(crate) fn backup_notes(
    vault_base: &Path,
    backups_parent: &Path,
    current_version: &str,
    timestamp: u64,
) -> std::io::Result<PathBuf> {
    let root = backups_parent.join(BACKUP_DIR);
    let dest = root.join(format!("{BACKUP_PREFIX}{current_version}-{timestamp}"));
    std::fs::create_dir_all(&dest)?;

    for entry in std::fs::read_dir(vault_base)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let file_type = entry.file_type()?;

        if file_type.is_dir() && name == "sessions" {
            copy_notes_tree(&path, &dest.join(&name))?;
        } else if file_type.is_file()
            && path.extension().and_then(|e| e.to_str()) == Some("json")
            && entry.metadata()?.len() <= MAX_FILE_BYTES
        {
            std::fs::copy(&path, dest.join(&name))?;
        }
    }

    prune_old_backups(&root);
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_notes_and_json_but_not_audio_and_prunes_old_backups() {
        let tmp = std::env::temp_dir().join(format!("notiz-backup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let vault = tmp.join("vault");
        std::fs::create_dir_all(vault.join("sessions/abc")).unwrap();
        std::fs::write(vault.join("sessions/abc/_meta.json"), "meta").unwrap();
        std::fs::write(vault.join("sessions/abc/note.md"), "hello").unwrap();
        std::fs::write(vault.join("sessions/abc/audio.mp3"), "audio").unwrap();
        std::fs::write(vault.join("daily_notes.json"), "{}").unwrap();
        std::fs::write(vault.join("big-model.bin"), "ignored").unwrap();

        let parent = tmp.join("global");
        for ts in 1..=5u64 {
            backup_notes(&vault, &parent, "1.0.0", ts).unwrap();
        }

        let dest = parent.join("backups/pre-update-1.0.0-5");
        assert_eq!(
            std::fs::read_to_string(dest.join("sessions/abc/note.md")).unwrap(),
            "hello"
        );
        assert!(dest.join("sessions/abc/_meta.json").exists());
        assert!(dest.join("daily_notes.json").exists());
        assert!(!dest.join("sessions/abc/audio.mp3").exists());
        assert!(!dest.join("big-model.bin").exists());

        let kept = std::fs::read_dir(parent.join("backups")).unwrap().count();
        assert_eq!(kept, KEEP_BACKUPS);
        assert!(!parent.join("backups/pre-update-1.0.0-1").exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
