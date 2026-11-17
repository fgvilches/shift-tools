use crate::util::{http_client, normalize_url, now_iso};
use serde::Serialize;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use std::sync::Arc;
use std::time::Instant;

/* ------------------------------ Hash engine ------------------------------ */

fn normalize_algorithm(algo: &str) -> String {
    algo.trim().to_lowercase().replace(['-', '_'], "")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HashResult {
    pub algorithm: String,
    pub value: String,
}

fn hash_bytes(data: &[u8], algorithms: &[String]) -> Vec<HashResult> {
    let list = if algorithms.is_empty() {
        vec![
            "md5".to_string(),
            "sha1".to_string(),
            "sha256".to_string(),
            "sha512".to_string(),
        ]
    } else {
        algorithms.to_vec()
    };

    list.iter()
        .map(|algo| {
            let key = normalize_algorithm(algo);
            let value = match key.as_str() {
                "md5" => {
                    use md5::Md5;
                    hex::encode(Md5::digest(data))
                }
                "sha1" => hex::encode(Sha1::digest(data)),
                "sha256" => hex::encode(Sha256::digest(data)),
                "sha512" => hex::encode(Sha512::digest(data)),
                "blake3" => blake3::hash(data).to_hex().to_string(),
                other => format!("unsupported:{other}"),
            };
            HashResult {
                algorithm: algo.to_uppercase().replace("SHA", "SHA-"),
                value,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn hash_text(text: String, algorithms: Vec<String>) -> Result<Vec<HashResult>, String> {
    Ok(hash_bytes(text.as_bytes(), &algorithms))
}

#[tauri::command]
pub async fn hash_file(path: String, algorithms: Vec<String>) -> Result<Vec<HashResult>, String> {
    use std::io::Read;

    let file_path = crate::util::expand_home(&path);
    let mut file = std::fs::File::open(&file_path).map_err(|e| format!("cannot open file: {e}"))?;

    let mut md5_hasher = md5::Md5::new();
    let mut sha1_hasher = Sha1::new();
    let mut sha256_hasher = Sha256::new();
    let mut sha512_hasher = Sha512::new();
    let mut blake3_hasher = blake3::Hasher::new();

    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| format!("read failed: {e}"))?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        md5_hasher.update(chunk);
        sha1_hasher.update(chunk);
        sha256_hasher.update(chunk);
        sha512_hasher.update(chunk);
        blake3_hasher.update(chunk);
    }

    let list = if algorithms.is_empty() {
        vec!["md5".to_string(), "sha1".to_string(), "sha256".to_string(), "sha512".to_string(), "blake3".to_string()]
    } else {
        algorithms
    };

    Ok(list
        .iter()
        .map(|algo| {
            let key = normalize_algorithm(algo);
            let value = match key.as_str() {
                "md5" => hex::encode(md5_hasher.clone().finalize()),
                "sha1" => hex::encode(sha1_hasher.clone().finalize()),
                "sha256" => hex::encode(sha256_hasher.clone().finalize()),
                "sha512" => hex::encode(sha512_hasher.clone().finalize()),
                "blake3" => blake3_hasher.clone().finalize().to_hex().to_string(),
                other => format!("unsupported:{other}"),
            };
            HashResult {
                algorithm: algo.to_uppercase().replace("SHA", "SHA-"),
                value,
            }
        })
        .collect())
}

/* --------------------------- Password utilities -------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordStrength {
    pub score: u8,
    pub entropy_bits: f64,
    pub label: String,
    pub crack_time: String,
    pub issues: Vec<String>,
    pub suggestions: Vec<String>,
}

#[tauri::command]
pub async fn password_strength(password: String) -> Result<PasswordStrength, String> {
    let len = password.chars().count();
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password.chars().any(|c| !c.is_alphanumeric());

    let mut charset = 0u32;
    if has_lower {
        charset += 26;
    }
    if has_upper {
        charset += 26;
    }
    if has_digit {
        charset += 10;
    }
    if has_symbol {
        charset += 32;
    }
    let charset = charset.max(1) as f64;
    let entropy = (len as f64) * charset.log2();

    let mut issues = Vec::new();
    let mut suggestions = Vec::new();

    if len < 12 {
        issues.push("Shorter than 12 characters".into());
        suggestions.push("Use at least 12 characters — 16 if this guards anything valuable.".into());
    }
    if !has_upper || !has_lower {
        issues.push("Missing mixed case".into());
        suggestions.push("Mix upper and lower case letters.".into());
    }
    if !has_digit {
        issues.push("No digits".into());
        suggestions.push("Add digits, or better, rely on length over character classes.".into());
    }
    if !has_symbol {
        issues.push("No symbols".into());
        suggestions.push("Add a symbol to widen the search space.".into());
    }
    if is_common_password(&password) {
        issues.push("Appears in common password lists".into());
        suggestions.push("This pattern is guessed first — choose something unrelated to dictionary words.".into());
    }
    if has_sequential_run(&password) {
        issues.push("Contains a sequential run (abc, 123)".into());
    }
    if has_repeat(&password) {
        issues.push("Contains repeated characters".into());
    }

    let score = if is_common_password(&password) || len < 8 {
        1
    } else if entropy < 40.0 {
        2
    } else if entropy < 60.0 {
        3
    } else if entropy < 80.0 {
        4
    } else {
        5
    };

    let label = match score {
        1 => "critical",
        2 => "weak",
        3 => "fair",
        4 => "strong",
        _ => "excellent",
    };

    // 10 billion guesses/second offline attack
    let guesses = 2f64.powf(entropy.min(1024.0)) / 2.0;
    let seconds = guesses / 1e10;
    let crack_time = humanize_seconds(seconds);

    Ok(PasswordStrength {
        score,
        entropy_bits: (entropy * 10.0).round() / 10.0,
        label: label.into(),
        crack_time,
        issues,
        suggestions,
    })
}

fn is_common_password(password: &str) -> bool {
    const COMMON: &[&str] = &[
        "password", "123456", "12345678", "qwerty", "letmein", "admin", "welcome", "monkey",
        "dragon", "iloveyou", "sunshine", "princess", "football", "charlie", "aa123456", "password1",
        "qwerty123", "1q2w3e4r", "123456789", "abc123", "password123",
    ];
    let lower = password.to_lowercase();
    COMMON.iter().any(|c| lower == *c || lower.contains(c))
}

fn has_sequential_run(password: &str) -> bool {
    let bytes = password.as_bytes();
    bytes.windows(3).any(|w| {
        (w[0].is_ascii_alphanumeric() && w[1] == w[0] + 1 && w[2] == w[1] + 1)
            || (w[0].is_ascii_digit() && w[1] + 1 == w[0] && w[2] + 1 == w[1])
    })
}

fn has_repeat(password: &str) -> bool {
    let chars: Vec<char> = password.chars().collect();
    chars.windows(3).any(|w| w[0] == w[1] && w[1] == w[2])
}

fn humanize_seconds(seconds: f64) -> String {
    if !seconds.is_finite() || seconds > 3.15e10 {
        return "centuries".into();
    }
    if seconds < 1.0 {
        return "instantly".into();
    }
    if seconds < 60.0 {
        return format!("{:.0} seconds", seconds);
    }
    if seconds < 3600.0 {
        return format!("{:.0} minutes", seconds / 60.0);
    }
    if seconds < 86400.0 {
        return format!("{:.0} hours", seconds / 3600.0);
    }
    if seconds < 2.6e6 {
        return format!("{:.0} days", seconds / 86400.0);
    }
    if seconds < 3.15e7 {
        return format!("{:.0} months", seconds / 2.6e6);
    }
    format!("{:.0} years", seconds / 3.15e7)
}

#[tauri::command]
pub async fn generate_password(length: u32, symbols: bool, numbers: bool, uppercase: bool) -> Result<String, String> {
    use rand::Rng;
    const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
    const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    const DIGITS: &[u8] = b"23456789";
    const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{};:,.?";

    let mut pool: Vec<u8> = LOWER.to_vec();
    if uppercase {
        pool.extend_from_slice(UPPER);
    }
    if numbers {
        pool.extend_from_slice(DIGITS);
    }
    if symbols {
        pool.extend_from_slice(SYMBOLS);
    }

    let length = length.clamp(4, 128) as usize;
    let mut rng = rand::thread_rng();
    let password: String = (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..pool.len());
            pool[idx] as char
        })
        .collect();
    Ok(password)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PwnedResult {
    pub count: u64,
    pub breached: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_pwned(password: String) -> Result<PwnedResult, String> {
    if password.is_empty() {
        return Ok(PwnedResult {
            count: 0,
            breached: false,
            error: Some("password is empty".into()),
        });
    }
    let digest = hex::encode_upper(Sha1::digest(password.as_bytes()));
    let (prefix, suffix) = digest.split_at(5);

    let client = http_client(8000, true, false);
    let response = client
        .get(format!("https://api.pwnedpasswords.com/range/{prefix}"))
        .header("Add-Padding", "true")
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(body) => {
                let count = body
                    .lines()
                    .filter_map(|line| {
                        let mut parts = line.split(':');
                        let hash = parts.next()?.trim();
                        let value = parts.next()?.trim();
                        if hash.eq_ignore_ascii_case(suffix) {
                            value.parse::<u64>().ok()
                        } else {
                            None
                        }
                    })
                    .next()
                    .unwrap_or(0);
                Ok(PwnedResult {
                    count,
                    breached: count > 0,
                    error: None,
                })
            }
            Err(e) => Ok(PwnedResult {
                count: 0,
                breached: false,
                error: Some(e.to_string()),
            }),
        },
        Ok(resp) => Ok(PwnedResult {
            count: 0,
            breached: false,
            error: Some(format!("haveibeenpwned returned HTTP {}", resp.status())),
        }),
        Err(e) => Ok(PwnedResult {
            count: 0,
            breached: false,
            error: Some(format!("offline or blocked: {e}")),
        }),
    }
}

/* ---------------------------- Header analyzer ---------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFinding {
    pub name: String,
    pub value: Option<String>,
    pub status: String,
    pub weight: i32,
    pub recommendation: String,
    pub group: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieFinding {
    pub name: String,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<String>,
    pub issues: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderAnalysis {
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub grade: String,
    pub score: i32,
    pub findings: Vec<HeaderFinding>,
    pub raw_headers: Vec<(String, String)>,
    pub cookies: Vec<CookieFinding>,
    pub fetched_at: String,
    pub duration_ms: u64,
}

fn header(map: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    map.get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string())
}

fn grade_for(score: i32) -> &'static str {
    match score {
        90..=100 => "A",
        80..=89 => "B",
        70..=79 => "C",
        55..=69 => "D",
        40..=54 => "E",
        _ => "F",
    }
}

fn parse_cookie(raw: &str) -> CookieFinding {
    let mut parts = raw.split(';');
    let name = parts.next().unwrap_or("").split('=').next().unwrap_or("").trim().to_string();
    let mut secure = false;
    let mut http_only = false;
    let mut same_site: Option<String> = None;
    for attr in parts {
        let attr = attr.trim();
        let lower = attr.to_lowercase();
        if lower == "secure" {
            secure = true;
        } else if lower == "httponly" {
            http_only = true;
        } else if let Some(value) = lower.strip_prefix("samesite=") {
            same_site = Some(value.trim().to_string());
        }
    }
    let mut issues = Vec::new();
    if !secure {
        issues.push("Missing Secure".to_string());
    }
    if !http_only {
        issues.push("Missing HttpOnly".to_string());
    }
    if same_site.is_none() {
        issues.push("Missing SameSite".to_string());
    } else if same_site.as_deref() == Some("none") && !secure {
        issues.push("SameSite=None requires Secure".to_string());
    }
    CookieFinding {
        name,
        secure,
        http_only,
        same_site,
        issues,
    }
}

#[tauri::command]
pub async fn analyze_headers(url: String, follow_redirects: bool) -> Result<HeaderAnalysis, String> {
    let target = normalize_url(&url);
    if target.is_empty() {
        return Err("URL is required".into());
    }
    let client = http_client(15_000, follow_redirects, false);
    let start = Instant::now();
    let response = client
        .get(&target)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let headers = response.headers().clone();
    let is_https = final_url.starts_with("https://");

    let mut findings = Vec::new();
    let mut score = 100i32;

    let hsts = header(&headers, "strict-transport-security");
    let hsts_ok = hsts.as_ref().map(|v| {
        v.to_lowercase()
            .split("max-age=")
            .nth(1)
            .and_then(|s| s.split(&[';', ' '][..]).next())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
            >= 15552000
    });
    let hsts_status = match hsts_ok {
        Some(true) => "pass",
        Some(false) => "warn",
        None => if is_https { "fail" } else { "warn" },
    };
    if hsts_status != "pass" {
        score -= 20;
    }
    findings.push(HeaderFinding {
        name: "Strict-Transport-Security".into(),
        value: hsts,
        status: hsts_status.into(),
        weight: 20,
        recommendation: "Send `max-age=63072000; includeSubDomains; preload` on every HTTPS response.".into(),
        group: "Transport".into(),
    });

    let csp = header(&headers, "content-security-policy");
    let csp_status = match &csp {
        Some(v) if v.contains("unsafe-inline") || v.contains("unsafe-eval") => "warn",
        Some(_) => "pass",
        None => "fail",
    };
    if csp_status == "fail" {
        score -= 18;
    } else if csp_status == "warn" {
        score -= 8;
    }
    findings.push(HeaderFinding {
        name: "Content-Security-Policy".into(),
        value: csp.clone(),
        status: csp_status.into(),
        weight: 18,
        recommendation: "Define a CSP that restricts script-src and object-src; avoid `unsafe-inline`.".into(),
        group: "Injection".into(),
    });

    let xfo = header(&headers, "x-frame-options");
    let frame_ancestors = csp.as_ref().map(|c| c.contains("frame-ancestors")).unwrap_or(false);
    let xfo_status = if xfo.is_some() || frame_ancestors { "pass" } else { "warn" };
    if xfo_status == "warn" {
        score -= 10;
    }
    findings.push(HeaderFinding {
        name: "X-Frame-Options".into(),
        value: xfo,
        status: xfo_status.into(),
        weight: 10,
        recommendation: "Send `X-Frame-Options: DENY` or a CSP `frame-ancestors` directive.".into(),
        group: "Clickjacking".into(),
    });

    let nosniff = header(&headers, "x-content-type-options");
    let nosniff_status = if nosniff.as_deref().map(|v| v.to_lowercase().contains("nosniff")).unwrap_or(false) {
        "pass"
    } else {
        "warn"
    };
    if nosniff_status == "warn" {
        score -= 8;
    }
    findings.push(HeaderFinding {
        name: "X-Content-Type-Options".into(),
        value: nosniff,
        status: nosniff_status.into(),
        weight: 8,
        recommendation: "Send `X-Content-Type-Options: nosniff`.".into(),
        group: "Sniffing".into(),
    });

    let referrer = header(&headers, "referrer-policy");
    let referrer_status = if referrer.is_some() { "pass" } else { "warn" };
    if referrer_status == "warn" {
        score -= 6;
    }
    findings.push(HeaderFinding {
        name: "Referrer-Policy".into(),
        value: referrer,
        status: referrer_status.into(),
        weight: 6,
        recommendation: "Send `Referrer-Policy: strict-origin-when-cross-origin`.".into(),
        group: "Privacy".into(),
    });

    let permissions = header(&headers, "permissions-policy");
    let permissions_status = if permissions.is_some() { "pass" } else { "info" };
    findings.push(HeaderFinding {
        name: "Permissions-Policy".into(),
        value: permissions,
        status: permissions_status.into(),
        weight: 6,
        recommendation: "Restrict camera, microphone and geolocation with `Permissions-Policy`.".into(),
        group: "Privacy".into(),
    });

    let coep = header(&headers, "cross-origin-opener-policy");
    let coep_status = if coep.is_some() { "pass" } else { "info" };
    findings.push(HeaderFinding {
        name: "Cross-Origin-Opener-Policy".into(),
        value: coep,
        status: coep_status.into(),
        weight: 5,
        recommendation: "Send `Cross-Origin-Opener-Policy: same-origin` to isolate browsing contexts.".into(),
        group: "Isolation".into(),
    });

    let acao = header(&headers, "access-control-allow-origin");
    let acac = header(&headers, "access-control-allow-credentials");
    let cors_status = if acao.as_deref() == Some("*") && acac.as_deref() == Some("true") {
        "fail"
    } else if acao.is_some() {
        "info"
    } else {
        "pass"
    };
    if cors_status == "fail" {
        score -= 15;
    }
    findings.push(HeaderFinding {
        name: "Access-Control-Allow-Origin".into(),
        value: acao,
        status: cors_status.into(),
        weight: 15,
        recommendation: "Never combine a wildcard origin with `allow-credentials: true`.".into(),
        group: "CORS".into(),
    });

    let powered_by = header(&headers, "x-powered-by");
    let server = header(&headers, "server");
    if powered_by.is_some() || server.is_some() {
        findings.push(HeaderFinding {
            name: "Technology disclosure".into(),
            value: powered_by.or(server),
            status: "info".into(),
            weight: 3,
            recommendation: "Consider removing `X-Powered-By` and detailed `Server` banners.".into(),
            group: "Disclosure".into(),
        });
    }

    let cookies: Vec<CookieFinding> = headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(parse_cookie)
        .collect();

    for cookie in &cookies {
        if !cookie.issues.is_empty() {
            score -= 4;
        }
    }

    let raw_headers = headers
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let score = score.clamp(0, 100);

    Ok(HeaderAnalysis {
        url: target,
        final_url,
        status,
        grade: grade_for(score).into(),
        score,
        findings,
        raw_headers,
        cookies,
        fetched_at: now_iso(),
        duration_ms,
    })
}

/* ------------------------------ TLS inspector ---------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertNode {
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub self_signed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsInfo {
    pub domain: String,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub days_remaining: i64,
    pub sans: Vec<String>,
    pub serial: String,
    pub fingerprint_sha256: String,
    pub tls_version: String,
    pub cipher_suite: String,
    pub key_bits: Option<usize>,
    pub signature_algorithm: Option<String>,
    pub chain: Vec<CertNode>,
    pub alerts: Vec<String>,
    pub grade: String,
}

#[derive(Debug)]
struct AcceptAnyCert;

impl rustls::client::danger::ServerCertVerifier for AcceptAnyCert {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
        ]
    }
}

#[tauri::command]
pub async fn inspect_tls(domain: String, port: Option<u16>) -> Result<TlsInfo, String> {
    let host = domain.trim().trim_start_matches("https://").trim_end_matches('/').to_string();
    if host.is_empty() {
        return Err("domain is required".into());
    }
    let host = host.split('/').next().unwrap_or(&host).to_string();
    let port = port.unwrap_or(443);

    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyCert))
        .with_no_client_auth();
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));

    let stream = tokio::net::TcpStream::connect(format!("{host}:{port}"))
        .await
        .map_err(|e| format!("TCP connect to {host}:{port} failed: {e}"))?;

    let server_name = rustls::pki_types::ServerName::try_from(host.clone())
        .map_err(|_| format!("invalid hostname: {host}"))?;

    let tls = connector
        .connect(server_name, stream)
        .await
        .map_err(|e| format!("TLS handshake failed: {e}"))?;

    let (_, connection) = tls.get_ref();
    let certs = connection
        .peer_certificates()
        .ok_or_else(|| "server presented no certificate".to_string())?
        .to_vec();
    let tls_version = connection
        .protocol_version()
        .map(|v| format!("{v:?}"))
        .unwrap_or_else(|| "unknown".into());
    let cipher_suite = connection
        .negotiated_cipher_suite()
        .map(|c| format!("{:?}", c.suite()))
        .unwrap_or_else(|| "unknown".into());

    let leaf = certs.first().ok_or_else(|| "empty certificate chain".to_string())?;
    let (_, parsed) = x509_parser::parse_x509_certificate(leaf.as_ref())
        .map_err(|e| format!("could not parse certificate: {e}"))?;

    let subject = parsed.subject().to_string();
    let issuer = parsed.issuer().to_string();
    let not_before_ts = parsed.validity().not_before.to_datetime().unix_timestamp();
    let not_after_ts = parsed.validity().not_after.to_datetime().unix_timestamp();
    let fmt = |ts: i64| {
        chrono::DateTime::from_timestamp(ts, 0)
            .map(|d| d.to_rfc3339())
            .unwrap_or_default()
    };
    let days_remaining = (not_after_ts - chrono::Utc::now().timestamp()) / 86_400;

    let mut sans = Vec::new();
    for ext in parsed.extensions() {
        if let x509_parser::extensions::ParsedExtension::SubjectAlternativeName(san) = ext.parsed_extension() {
            for name in &san.general_names {
                if let x509_parser::extensions::GeneralName::DNSName(dns) = name {
                    sans.push(dns.to_string());
                }
            }
        }
    }

    let serial = parsed.raw_serial_as_string();
    let fingerprint = hex::encode(Sha256::digest(leaf.as_ref()));
    let fingerprint_pretty = fingerprint
        .as_bytes()
        .chunks(2)
        .map(|c| String::from_utf8_lossy(c).to_uppercase())
        .collect::<Vec<_>>()
        .join(":");

    let key_bits = match parsed.public_key().parsed() {
        Ok(x509_parser::public_key::PublicKey::RSA(rsa)) => Some(rsa.key_size()),
        _ => None,
    };

    let signature_algorithm = Some(parsed.signature_algorithm.algorithm.to_id_string());

    let mut chain = Vec::new();
    for der in &certs {
        if let Ok((_, cert)) = x509_parser::parse_x509_certificate(der.as_ref()) {
            let from = cert.validity().not_before.to_datetime().unix_timestamp();
            let to = cert.validity().not_after.to_datetime().unix_timestamp();
            chain.push(CertNode {
                subject: cert.subject().to_string(),
                issuer: cert.issuer().to_string(),
                valid_from: fmt(from),
                valid_to: fmt(to),
                self_signed: cert.subject().to_string() == cert.issuer().to_string(),
            });
        }
    }

    let mut alerts = Vec::new();
    if days_remaining < 0 {
        alerts.push("Certificate has expired".to_string());
    } else if days_remaining < 14 {
        alerts.push(format!("Expires in {days_remaining} days"));
    } else if days_remaining < 30 {
        alerts.push(format!("Expires in {days_remaining} days — renew soon"));
    }
    if parsed.subject().to_string() == issuer {
        alerts.push("Self-signed certificate".to_string());
    }
    if tls_version.contains("1_2") || tls_version.contains("1.2") {
        alerts.push("TLS 1.2 negotiated — prefer TLS 1.3".to_string());
    }
    if tls_version.contains("1_1") || tls_version.contains("1.1") || tls_version.contains("SSLv") {
        alerts.push("Deprecated protocol version negotiated".to_string());
    }
    if cipher_suite.contains("RC4") || cipher_suite.contains("3DES") || cipher_suite.contains("CBC") {
        alerts.push("Weak cipher suite negotiated".to_string());
    }

    let grade = if days_remaining < 0 || tls_version.contains("SSLv") {
        "F"
    } else if !alerts.is_empty() {
        "C"
    } else if tls_version.contains("1_3") || tls_version.contains("TLSv1_3") {
        "A"
    } else {
        "B"
    };

    Ok(TlsInfo {
        domain: host,
        subject,
        issuer,
        valid_from: fmt(not_before_ts),
        valid_to: fmt(not_after_ts),
        days_remaining,
        sans,
        serial,
        fingerprint_sha256: fingerprint_pretty,
        tls_version,
        cipher_suite,
        key_bits,
        signature_algorithm,
        chain,
        alerts,
        grade: grade.into(),
    })
}

#[cfg(test)]
mod live_tests {
    use super::*;

    #[tokio::test]
    async fn inspect_tls_reads_a_real_certificate() {
        let info = inspect_tls("github.com".into(), Some(443))
            .await
            .expect("TLS handshake should succeed");
        assert!(!info.subject.is_empty(), "subject parsed");
        assert!(!info.fingerprint_sha256.is_empty(), "fingerprint computed");
        assert!(!info.sans.is_empty(), "SANs extracted");
        assert!(info.days_remaining > 0, "certificate not expired");
        assert!(!info.chain.is_empty(), "chain captured");
        println!(
            "tls: {} | {} | {} | {} days | {} SANs | {} chain",
            info.domain,
            info.tls_version,
            info.cipher_suite,
            info.days_remaining,
            info.sans.len(),
            info.chain.len()
        );
    }

    #[tokio::test]
    async fn analyze_headers_grades_a_real_response() {
        let analysis = analyze_headers("https://example.com".into(), true)
            .await
            .expect("HTTP fetch should succeed");
        assert_eq!(analysis.status, 200);
        assert!(!analysis.findings.is_empty(), "findings produced");
        assert!((0..=100).contains(&analysis.score));
        println!(
            "headers: {} | grade {} | score {} | {} findings | {} raw headers | {} cookies",
            analysis.final_url,
            analysis.grade,
            analysis.score,
            analysis.findings.len(),
            analysis.raw_headers.len(),
            analysis.cookies.len()
        );
    }

    #[tokio::test]
    async fn dns_and_hashes_work() {
        let answer = crate::commands::network::dns_query("example.com".into(), "A".into(), None)
            .await
            .expect("dns query should not error");
        assert!(answer.error.is_none(), "resolver error: {:?}", answer.error);
        assert!(!answer.records.is_empty(), "A records returned");

        // Expected values cross-checked with `printf 'shift-tools' | shasum -a 256` / `md5`.
        let digests = hash_text("shift-tools".into(), vec!["sha256".into(), "md5".into()])
            .await
            .unwrap();
        assert_eq!(
            digests[0].value,
            "1d381e56195546105f7bffd5e1e4265880d97aeceb1d886b3d8c62750990060b"
        );
        assert_eq!(digests[1].value, "4b9f447dc14a322eab8ffdbc4fb60f41");
    }
}
