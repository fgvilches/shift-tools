use crate::util::{http_client, normalize_url};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HttpAuth {
    pub kind: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub token: Option<String>,
    pub header_name: Option<String>,
    #[serde(default)]
    pub in_query: bool,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequestSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    #[serde(default = "default_body_kind")]
    pub body_kind: String,
    #[serde(default = "default_auth")]
    pub auth: HttpAuth,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_true")]
    pub follow_redirects: bool,
    #[serde(default)]
    pub insecure: bool,
}

fn default_body_kind() -> String {
    "none".into()
}
fn default_timeout() -> u64 {
    30_000
}
fn default_true() -> bool {
    true
}
fn default_auth() -> HttpAuth {
    HttpAuth {
        kind: "none".into(),
        username: None,
        password: None,
        token: None,
        header_name: None,
        in_query: false,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub body_bytes: usize,
    pub duration_ms: u64,
    pub redirected: bool,
    pub final_url: String,
    pub content_type: Option<String>,
    pub truncated: bool,
}

const MAX_BODY: usize = 2_500_000;

#[tauri::command]
pub async fn send_http_request(spec: ApiRequestSpec) -> Result<ApiResponseData, String> {
    let url = normalize_url(&spec.url);
    if url.is_empty() {
        return Err("URL is required".into());
    }

    let method = reqwest::Method::from_bytes(spec.method.to_uppercase().as_bytes())
        .map_err(|_| format!("invalid HTTP method: {}", spec.method))?;

    let client = http_client(spec.timeout_ms.max(1000), spec.follow_redirects, spec.insecure);
    let mut request = client.request(method, &url);

    let mut has_content_type = false;
    for (key, value) in &spec.headers {
        if key.trim().is_empty() {
            continue;
        }
        if key.eq_ignore_ascii_case("content-type") {
            has_content_type = true;
        }
        request = request.header(key.as_str(), value.as_str());
    }

    // Authorization
    match spec.auth.kind.as_str() {
        "basic" => {
            let credentials = format!(
                "{}:{}",
                spec.auth.username.clone().unwrap_or_default(),
                spec.auth.password.clone().unwrap_or_default()
            );
            let encoded = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
            request = request.header("Authorization", format!("Basic {encoded}"));
        }
        "bearer" => {
            if let Some(token) = spec.auth.token.as_ref().filter(|t| !t.trim().is_empty()) {
                request = request.header("Authorization", format!("Bearer {token}"));
            }
        }
        "apiKey" => {
            let header_name = spec.auth.header_name.clone().unwrap_or_else(|| "X-API-Key".into());
            let value = spec.auth.token.clone().unwrap_or_default();
            if spec.auth.in_query {
                let separator = if url.contains('?') { '&' } else { '?' };
                request = client.request(
                    reqwest::Method::from_bytes(spec.method.to_uppercase().as_bytes())
                        .map_err(|e| e.to_string())?,
                    format!("{url}{separator}{header_name}={value}"),
                );
                for (key, header_value) in &spec.headers {
                    request = request.header(key.as_str(), header_value.as_str());
                }
            } else if !value.is_empty() {
                request = request.header(header_name.as_str(), value.as_str());
            }
        }
        _ => {}
    }

    if let Some(body) = spec.body.as_ref().filter(|b| !b.is_empty()) {
        if !has_content_type {
            let default_ct = match spec.body_kind.as_str() {
                "json" => "application/json",
                "urlencoded" => "application/x-www-form-urlencoded",
                "form" => "multipart/form-data",
                _ => "text/plain; charset=utf-8",
            };
            request = request.header("Content-Type", default_ct);
        }
        request = request.body(body.clone());
    }

    let start = Instant::now();
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("request timed out after {} ms", spec.timeout_ms)
        } else if e.is_connect() {
            format!("connection failed: {e}")
        } else {
            format!("request failed: {e}")
        }
    })?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let final_url = response.url().to_string();
    let redirected = final_url != url;
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = response.bytes().await.map_err(|e| format!("could not read response: {e}"))?;
    let truncated = bytes.len() > MAX_BODY;
    let slice = if truncated { &bytes[..MAX_BODY] } else { &bytes[..] };

    let body = String::from_utf8(slice.to_vec()).unwrap_or_else(|_| {
        format!("[binary payload: {} bytes, base64]\n{}", bytes.len(), base64::engine::general_purpose::STANDARD.encode(slice))
    });

    Ok(ApiResponseData {
        status: status.as_u16(),
        status_text,
        headers,
        body,
        body_bytes: bytes.len(),
        duration_ms,
        redirected,
        final_url,
        content_type,
        truncated,
    })
}
