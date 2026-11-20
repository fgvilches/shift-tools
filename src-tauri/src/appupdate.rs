//! In-app updates.
//!
//! Uses Tauri's updater: it reads `latest.json` from the GitHub release of this
//! repository, picks the artifact for this platform and architecture, verifies
//! the minisign signature against the public key baked into the binary, swaps
//! the bundle in place and lets the caller restart into it.
//!
//! `SHIFT_TOOLS_UPDATE_ENDPOINT` overrides the configured endpoint, which is how
//! the flow is tested against a local manifest without publishing a release.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

fn updater_for(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();

    if let Ok(endpoint) = std::env::var("SHIFT_TOOLS_UPDATE_ENDPOINT") {
        if !endpoint.trim().is_empty() {
            let url = endpoint
                .parse()
                .map_err(|e| format!("invalid endpoint: {e:?}"))?;
            builder = builder
                .endpoints(vec![url])
                .map_err(|e| format!("could not set the endpoint: {e}"))?;
        }
    }

    builder.build().map_err(|e| e.to_string())
}

/// Installed version, shown in the sidebar and in the update panel.
#[tauri::command]
pub fn update_current_version(app: AppHandle) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

/// Is there a newer release? Never fails hard on a network problem: the caller
/// gets `available: false` plus the error, so a laptop offline on a train does
/// not show a scary dialog.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Value, String> {
    let updater = updater_for(&app)?;

    match updater.check().await {
        Ok(Some(update)) => Ok(json!({
            "available": true,
            "version": update.version.to_string(),
            "currentVersion": update.current_version.to_string(),
            "notes": update.body,
            "date": update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(json!({
            "available": false,
            "currentVersion": app.package_info().version.to_string(),
        })),
        Err(e) => Ok(json!({
            "available": false,
            "currentVersion": app.package_info().version.to_string(),
            "error": e.to_string(),
        })),
    }
}

/// Downloads and installs the pending update. Progress goes out as
/// `app-update:progress` events; the caller restarts afterwards.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<Value, String> {
    let updater = updater_for(&app)?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(json!({ "installed": false, "reason": "no pending update" }));
    };

    let version = update.version.to_string();
    let handle = app.clone();

    update
        .download_and_install(
            move |chunk: usize, total: Option<u64>| {
                let _ = handle.emit("app-update:progress", json!({ "chunk": chunk, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| format!("{e}"))?;

    Ok(json!({ "installed": true, "version": version }))
}

/// Restarts into the freshly installed version.
#[tauri::command]
pub fn update_restart(app: AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    /// The public key baked into `tauri.conf.json` must be the one that signs
    /// the updater artifacts. If they drift, every install fails verification
    /// with a message that reads like a network error.
    ///
    /// `cargo test --lib -- --ignored pubkey_matches_signed_artifact` with
    /// SIG_FILE and ARTIFACT_FILE pointing at a real build.
    #[test]
    #[ignore]
    fn pubkey_matches_signed_artifact() {
        let sig_path = std::env::var("SIG_FILE").expect("SIG_FILE");
        let art_path = std::env::var("ARTIFACT_FILE").expect("ARTIFACT_FILE");

        let conf: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").unwrap()).unwrap();
        let pubkey_b64 = conf["plugins"]["updater"]["pubkey"].as_str().unwrap();

        let pem = String::from_utf8(base64_decode(pubkey_b64)).expect("pubkey is base64 text");
        let public_key = minisign_verify::PublicKey::decode(&pem).expect("valid minisign pubkey");

        let signature_text = std::fs::read_to_string(&sig_path).expect("signature file");
        let signature = minisign_verify::Signature::decode(
            &String::from_utf8(base64_decode(&signature_text)).expect("signature is base64 text"),
        )
        .expect("valid signature file");
        let data = std::fs::read(&art_path).expect("artifact file");

        public_key
            .verify(&data, &signature, false)
            .expect("signature must verify against the baked pubkey");
        println!("signature ok for {art_path} ({} bytes)", data.len());
    }

    fn base64_decode(input: &str) -> Vec<u8> {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = Vec::new();
        let mut buf: u32 = 0;
        let mut bits = 0;
        for c in input.bytes() {
            if c == b'=' || c == b'\n' || c == b'\r' {
                continue;
            }
            let Some(v) = T.iter().position(|&t| t == c) else {
                continue;
            };
            buf = (buf << 6) | v as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
            }
        }
        out
    }
}
