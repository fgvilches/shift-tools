use std::process::Command;

/// Run a command and return stdout, mapping any failure into a user-facing string.
pub fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run {program}: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            detail
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Same as `run`, but tolerates a non-zero exit code (e.g. `du` on missing paths).
pub fn run_lossy(program: &str, args: &[&str]) -> String {
    match Command::new(program).args(args).output() {
        Ok(output) => {
            let mut text = String::from_utf8_lossy(&output.stdout).to_string();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            text
        }
        Err(e) => format!("{program} unavailable: {e}"),
    }
}

pub fn home() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"))
}

pub fn expand_home(path: &str) -> std::path::PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" || trimmed.is_empty() {
        return home();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home().join(rest);
    }
    std::path::PathBuf::from(trimmed)
}

/// Recursive size in bytes, without following symlinks.
pub fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if !path.exists() {
        return 0;
    }
    for entry in walkdir::WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total += meta.len();
            }
        }
    }
    total
}

pub fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

pub fn http_client(timeout_ms: u64, follow: bool, insecure: bool) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .user_agent("shift-tools/1.0 (macOS; +https://shift.tools)");

    builder = if follow {
        builder.redirect(reqwest::redirect::Policy::limited(10))
    } else {
        builder.redirect(reqwest::redirect::Policy::none())
    };

    if insecure {
        builder = builder.danger_accept_invalid_certs(true);
    }

    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

pub fn normalize_url(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_home_in_every_shape() {
        let home = home();
        assert_eq!(expand_home("~"), home, "bare tilde is the home directory");
        assert_eq!(expand_home(" ~ "), home, "whitespace is tolerated");
        assert_eq!(expand_home("~/Desktop"), home.join("Desktop"));
        assert_eq!(expand_home("/tmp"), std::path::PathBuf::from("/tmp"));
        assert_eq!(expand_home(""), home);
        assert!(expand_home("~").is_dir(), "home must be a real directory");
    }
}
