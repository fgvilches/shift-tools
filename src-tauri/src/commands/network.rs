use crate::util::{http_client, now_iso, run, run_lossy};
use futures_util::StreamExt;
use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig, ResolverOpts};
use hickory_resolver::TokioAsyncResolver;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::{IpAddr, Ipv4Addr};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/* ---------------------------------- WiFi --------------------------------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WifiAp {
    pub ssid: Option<String>,
    pub bssid: Option<String>,
    pub rssi: Option<i32>,
    pub noise: Option<i32>,
    pub snr: Option<i32>,
    pub channel: Option<i32>,
    pub band: Option<String>,
    pub width_mhz: Option<i32>,
    pub phy_mode: Option<String>,
    pub security: Option<String>,
    pub vendor: Option<String>,
    pub hidden: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WifiScanResult {
    pub aps: Vec<WifiAp>,
    pub scanned_at: String,
    pub interface: String,
    pub redacted: bool,
    pub source: String,
}

fn parse_signal_noise(raw: &str) -> (Option<i32>, Option<i32>) {
    // "-67 dBm / -96 dBm"
    let mut nums = raw
        .split('/')
        .map(|part| part.split_whitespace().next().unwrap_or("").parse::<i32>().ok());
    let signal = nums.next().flatten();
    let noise = nums.next().flatten();
    (signal, noise)
}

fn parse_channel(raw: &str) -> (Option<i32>, Option<String>, Option<i32>) {
    // "161 (5GHz, 80MHz)"
    let channel = raw
        .split_whitespace()
        .next()
        .and_then(|c| c.parse::<i32>().ok());
    let band = if raw.contains("6GHz") {
        Some("6 GHz".to_string())
    } else if raw.contains("5GHz") {
        Some("5 GHz".to_string())
    } else if raw.contains("2GHz") || raw.contains("2.4GHz") {
        Some("2.4 GHz".to_string())
    } else {
        None
    };
    let width = raw
        .split("MHz")
        .next()
        .and_then(|s| s.trim().rsplit(|c: char| !c.is_ascii_digit()).next())
        .and_then(|s| s.trim().parse::<i32>().ok());
    (channel, band, width)
}

fn security_from_mode(raw: &str) -> String {
    let cleaned = raw.replace("spairport_security_mode_", "");
    match cleaned.as_str() {
        "wpa3_personal" => "WPA3".into(),
        "wpa3_personal_mixed" => "WPA3/WPA2".into(),
        "wpa2_personal" => "WPA2".into(),
        "wpa2_personal_mixed" => "WPA/WPA2".into(),
        "wpa_personal" => "WPA".into(),
        "wpa3_enterprise" => "WPA3-Enterprise".into(),
        "wpa2_enterprise" => "WPA2-Enterprise".into(),
        "none" => "Open".into(),
        other => other.replace('_', " ").to_uppercase(),
    }
}

fn ssid_is_redacted(ssid: &str) -> bool {
    ssid.is_empty() || ssid == "<redacted>" || ssid.contains("redacted")
}


/* ------------------------------- CoreWLAN -------------------------------- */

/// Reads the neighbour-AP list straight from CoreWLAN.
///
/// This is the only source macOS un-redacts: `system_profiler` runs as a
/// separate binary with its own TCC identity, so it keeps SSIDs redacted even
/// when shift-tools itself holds Location permission.
unsafe fn corewlan_scan() -> Result<(String, Vec<WifiAp>), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::ffi::{CStr, CString};

    let path = CString::new("/System/Library/Frameworks/CoreWLAN.framework/CoreWLAN")
        .map_err(|e| e.to_string())?;
    if libc::dlopen(path.as_ptr(), libc::RTLD_LAZY).is_null() {
        return Err("could not load CoreWLAN".to_string());
    }

    unsafe fn ns_string(obj: *mut AnyObject) -> Option<String> {
        if obj.is_null() {
            return None;
        }
        let utf8: *const std::os::raw::c_char = objc2::msg_send![obj, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(CStr::from_ptr(utf8).to_string_lossy().to_string())
    }

    fn security_label(net: *mut AnyObject) -> Option<String> {
        // Highest supported security wins; values from CoreWLANTypes.h.
        const ORDER: &[(isize, &str)] = &[
            (12, "WPA3-Enterprise"),
            (11, "WPA3"),
            (13, "WPA3 Transition"),
            (10, "WPA2/WPA3-Enterprise"),
            (9, "WPA2-Enterprise"),
            (7, "WPA-Enterprise"),
            (4, "WPA2"),
            (5, "WPA2/WPA3"),
            (3, "WPA/WPA2"),
            (2, "WPA"),
            (15, "OWE Transition"),
            (14, "OWE"),
            (1, "WEP"),
            (0, "Open"),
        ];
        for (value, label) in ORDER {
            let supported: bool = unsafe { objc2::msg_send![net, supportsSecurity: *value] };
            if supported {
                return Some((*label).to_string());
            }
        }
        None
    }

    fn phy_label(net: *mut AnyObject) -> Option<String> {
        const ORDER: &[(isize, &str)] = &[
            (7, "802.11be"),
            (6, "802.11ax"),
            (5, "802.11ac"),
            (4, "802.11n"),
            (3, "802.11g"),
            (1, "802.11a"),
            (2, "802.11b"),
        ];
        for (value, label) in ORDER {
            let supported: bool = unsafe { objc2::msg_send![net, supportsPHYMode: *value] };
            if supported {
                return Some((*label).to_string());
            }
        }
        None
    }

    let client_cls = AnyClass::get("CWWiFiClient").ok_or_else(|| "CWWiFiClient unavailable".to_string())?;
    let client: *mut AnyObject = msg_send![client_cls, sharedWiFiClient];
    if client.is_null() {
        return Err("no CWWiFiClient".to_string());
    }
    let iface: *mut AnyObject = msg_send![client, interface];
    if iface.is_null() {
        return Err("Wi-Fi interface unavailable".to_string());
    }
    let iface_name = ns_string(msg_send![iface, interfaceName]).unwrap_or_else(|| "en0".to_string());

    let mut error: *mut AnyObject = std::ptr::null_mut();
    let networks: *mut AnyObject = msg_send![
        iface,
        scanForNetworksWithName: std::ptr::null::<AnyObject>(),
        includeHidden: true,
        error: &mut error
    ];
    if networks.is_null() {
        let detail = ns_string(error).unwrap_or_else(|| "scan returned nothing".to_string());
        return Err(format!("CoreWLAN scan failed: {detail}"));
    }

    let array: *mut AnyObject = msg_send![networks, allObjects];
    let count: usize = msg_send![array, count];
    let mut aps = Vec::with_capacity(count);

    for index in 0..count {
        let net: *mut AnyObject = msg_send![array, objectAtIndex: index];
        if net.is_null() {
            continue;
        }
        let ssid = ns_string(msg_send![net, ssid]);
        let bssid = ns_string(msg_send![net, bssid]);
        let rssi: i64 = msg_send![net, rssiValue];
        let noise: i64 = msg_send![net, noiseMeasurement];

        let channel: *mut AnyObject = msg_send![net, wlanChannel];
        let (mut channel_number, mut band, mut width) = (None, None, None);
        if !channel.is_null() {
            let number: i64 = msg_send![channel, channelNumber];
            let band_value: i64 = msg_send![channel, channelBand];
            let width_value: i64 = msg_send![channel, channelWidth];
            channel_number = if number > 0 { Some(number as i32) } else { None };
            band = match band_value {
                1 => Some("2.4 GHz".to_string()),
                2 => Some("5 GHz".to_string()),
                3 => Some("6 GHz".to_string()),
                _ => None,
            };
            width = match width_value {
                1 => Some(20),
                2 => Some(40),
                3 => Some(80),
                4 => Some(160),
                5 => Some(320),
                _ => None,
            };
        }

        let vendor = bssid.as_deref().and_then(oui_vendor);
        aps.push(WifiAp {
            ssid: ssid.clone(),
            bssid,
            rssi: Some(rssi as i32),
            noise: if noise != 0 { Some(noise as i32) } else { None },
            snr: if noise != 0 { Some((rssi - noise) as i32) } else { None },
            channel: channel_number,
            band,
            width_mhz: width,
            phy_mode: phy_label(net),
            security: security_label(net),
            vendor,
            hidden: ssid.is_none(),
        });
    }

    aps.sort_by_key(|a| std::cmp::Reverse(a.rssi.unwrap_or(-120)));
    Ok((iface_name, aps))
}

/// `system_profiler` takes ~12 s per call on macOS 26, and the UI polls faster
/// than that. Cache the survey briefly so repeat scans are instant.
static WIFI_CACHE: once_cell::sync::Lazy<std::sync::Mutex<Option<(std::time::Instant, WifiScanResult)>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

const WIFI_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

#[tauri::command]
pub async fn wifi_scan() -> Result<WifiScanResult, String> {
    if let Ok(guard) = WIFI_CACHE.lock() {
        if let Some((taken, cached)) = guard.as_ref() {
            if taken.elapsed() < WIFI_CACHE_TTL {
                return Ok(cached.clone());
            }
        }
    }

    // CoreWLAN first: it is the only API macOS lets us read un-redacted.
    if let Ok((interface, aps)) = tauri::async_runtime::spawn_blocking(|| unsafe { corewlan_scan() })
        .await
        .map_err(|e| e.to_string())
        .and_then(|inner| inner)
    {
        if !aps.is_empty() {
            let redacted = aps.iter().all(|ap| ap.ssid.is_none());
            let result = WifiScanResult {
                aps,
                scanned_at: now_iso(),
                interface,
                redacted,
                source: "CoreWLAN · CWInterface.scanForNetworks".into(),
            };
            if let Ok(mut guard) = WIFI_CACHE.lock() {
                *guard = Some((std::time::Instant::now(), result.clone()));
            }
            return Ok(result);
        }
    }

    tauri::async_runtime::spawn_blocking(|| {
        let raw = run(
            "/usr/sbin/system_profiler",
            &["SPAirPortDataType", "-json", "-detailLevel", "basic"],
        )?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("unexpected system_profiler output: {e}"))?;

        let interfaces = json
            .get("SPAirPortDataType")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.get("spairport_airport_interfaces"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut aps: Vec<WifiAp> = Vec::new();
        let mut interface = String::from("en0");
        let mut redacted = false;

        let mut current_network: Option<WifiAp> = None;

        for iface in interfaces {
            // Prefer the primary Wi-Fi interface (en0) over awdl0/llw0 helpers.
            if let Some(name) = iface.get("_name").and_then(|v| v.as_str()) {
                if name.starts_with("en") {
                    interface = name.to_string();
                }
            }

            // macOS exposes the associated network even when it withholds the
            // neighbour list (no Location permission). Capture it as a real row.
            if let Some(current) = iface.get("spairport_current_network_information") {
                let ssid_raw = current.get("_name").and_then(|v| v.as_str()).unwrap_or("");
                let is_redacted = ssid_is_redacted(ssid_raw);
                if is_redacted {
                    redacted = true;
                }
                let (channel, band, width) = parse_channel(
                    current.get("spairport_network_channel").and_then(|v| v.as_str()).unwrap_or(""),
                );
                let (rssi, noise) = parse_signal_noise(
                    current.get("spairport_signal_noise").and_then(|v| v.as_str()).unwrap_or(""),
                );
                current_network.get_or_insert(WifiAp {
                    ssid: if is_redacted { None } else { Some(ssid_raw.to_string()) },
                    bssid: None,
                    rssi,
                    noise,
                    snr: match (rssi, noise) {
                        (Some(r), Some(n)) => Some(r - n),
                        _ => None,
                    },
                    channel,
                    band,
                    width_mhz: width,
                    phy_mode: current
                        .get("spairport_network_phymode")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    security: current
                        .get("spairport_security_mode")
                        .and_then(|v| v.as_str())
                        .map(security_from_mode),
                    vendor: None,
                    hidden: true,
                });
            }
            let networks = iface
                .get("spairport_airport_other_local_wireless_networks")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            for net in networks {
                let ssid_raw = net.get("_name").and_then(|v| v.as_str()).unwrap_or("");
                let is_redacted = ssid_is_redacted(ssid_raw);
                if is_redacted {
                    redacted = true;
                }
                let (rssi, noise) = parse_signal_noise(
                    net.get("spairport_signal_noise").and_then(|v| v.as_str()).unwrap_or(""),
                );
                let (channel, band, width) = parse_channel(
                    net.get("spairport_network_channel").and_then(|v| v.as_str()).unwrap_or(""),
                );
                let security = net
                    .get("spairport_security_mode")
                    .and_then(|v| v.as_str())
                    .map(security_from_mode);

                aps.push(WifiAp {
                    ssid: if is_redacted { None } else { Some(ssid_raw.to_string()) },
                    bssid: None,
                    rssi,
                    noise,
                    snr: match (rssi, noise) {
                        (Some(r), Some(n)) => Some(r - n),
                        _ => None,
                    },
                    channel,
                    band,
                    width_mhz: width,
                    phy_mode: net.get("spairport_network_phymode").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    security,
                    vendor: None,
                    hidden: is_redacted,
                });
            }
        }

        aps.sort_by_key(|a| std::cmp::Reverse(a.rssi.unwrap_or(-120)));

        // Neighbour list unavailable: fall back to the associated network so the
        // view still shows real channel/PHY data, and say why in `source`.
        let mut source = "system_profiler SPAirPortDataType".to_string();
        if aps.is_empty() {
            if let Some(current) = current_network {
                aps.push(current);
                source = "system_profiler · current network only (neighbour scan withheld by macOS)".into();
            }
        }

        if aps.is_empty() {
            return Err(
                "macOS returned no Wi-Fi data. Wi-Fi is off, or the interface is not associated. \
                 Neighbour listings additionally require Location permission for shift-tools in \
                 System Settings → Privacy & Security → Location Services."
                    .into(),
            );
        }

        Ok::<_, String>(WifiScanResult {
            aps,
            scanned_at: now_iso(),
            interface,
            redacted,
            source,
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .inspect(|result| {
        if let Ok(mut guard) = WIFI_CACHE.lock() {
            *guard = Some((std::time::Instant::now(), result.clone()));
        }
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothDevice {
    pub name: Option<String>,
    pub address: Option<String>,
    pub rssi: Option<i32>,
    pub connected: bool,
    pub kind: Option<String>,
    pub vendor: Option<String>,
}

#[tauri::command]
pub async fn bluetooth_devices() -> Result<Vec<BluetoothDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let raw = run("/usr/sbin/system_profiler", &["SPBluetoothDataType", "-json"])?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("unexpected system_profiler output: {e}"))?;
        let mut out = Vec::new();

        let blocks = json
            .get("SPBluetoothDataType")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for block in blocks {
            for key in ["device_connected", "device_not_connected"] {
                let connected = key == "device_connected";
                let Some(list) = block.get(key).and_then(|v| v.as_array()) else { continue };
                for entry in list {
                    let Some(obj) = entry.as_object() else { continue };
                    for (name, details) in obj {
                        let addr = details
                            .get("device_address")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let kind = details
                            .get("device_minorType")
                            .or_else(|| details.get("device_majorType"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        out.push(BluetoothDevice {
                            name: Some(name.clone()),
                            address: addr,
                            rssi: None,
                            connected,
                            kind,
                            vendor: details
                                .get("device_manufacturer")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        });
                    }
                }
            }
        }

        if out.is_empty() {
            return Err("No Bluetooth devices reported. Bluetooth may be off.".into());
        }
        Ok::<_, String>(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------------------------------- LAN ---------------------------------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LanPort {
    pub port: u16,
    pub service: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LanHost {
    pub ip: String,
    pub hostname: Option<String>,
    pub mac: Option<String>,
    pub vendor: Option<String>,
    pub open_ports: Vec<LanPort>,
    pub latency_ms: Option<f64>,
    pub alive: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LanScanProgress {
    pub scanned: usize,
    pub total: usize,
    pub hosts: Vec<LanHost>,
    pub done: bool,
    pub error: Option<String>,
}

fn service_for_port(port: u16) -> &'static str {
    match port {
        22 => "SSH",
        23 => "Telnet",
        53 => "DNS",
        80 => "HTTP",
        88 => "Kerberos",
        139 => "NetBIOS",
        443 => "HTTPS",
        445 => "SMB",
        548 => "AFP",
        631 => "IPP",
        3000 => "Dev server",
        3306 => "MySQL",
        3389 => "RDP",
        5000 => "Dev server",
        5432 => "PostgreSQL",
        5900 => "VNC",
        6379 => "Redis",
        7000 => "AirPlay",
        8000 => "HTTP alt",
        8080 => "HTTP proxy",
        8443 => "HTTPS alt",
        9000 => "Dev server",
        _ => "unknown",
    }
}

fn detect_cidr() -> Option<String> {
    let out = run_lossy("/sbin/ifconfig", &[]);
    let mut current_iface = String::new();
    for line in out.lines() {
        if !line.starts_with(char::is_whitespace) {
            current_iface = line.split(':').next().unwrap_or("").to_string();
        }
        if line.contains("status: active") && current_iface.starts_with("en") {
            // fall through; the inet line precedes status
        }
        let trimmed = line.trim();
        if trimmed.starts_with("inet ") && !trimmed.contains("127.0.0.1") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 4 {
                let ip = parts[1];
                let mask = parts[3];
                if let (Ok(addr), Ok(mask_num)) = (
                    ip.parse::<Ipv4Addr>(),
                    u32::from_str_radix(mask.trim_start_matches("0x"), 16),
                ) {
                    let prefix = mask_num.count_ones();
                    if (22..=30).contains(&prefix) {
                        let ip_u = u32::from(addr) & mask_num;
                        return Some(format!("{}/{}", Ipv4Addr::from(ip_u), prefix));
                    }
                }
            }
        }
    }
    None
}

fn arp_table() -> Vec<(String, String)> {
    let out = run_lossy("/usr/sbin/arp", &["-an"]);
    let mut rows = Vec::new();
    for line in out.lines() {
        // ? (192.168.1.1) at 3c:37:12:aa:bb:cc on en0 ifscope [ethernet]
        let ip = line
            .split('(')
            .nth(1)
            .and_then(|s| s.split(')').next())
            .unwrap_or("")
            .to_string();
        let mac = line
            .split(" at ")
            .nth(1)
            .and_then(|s| s.split_whitespace().next())
            .unwrap_or("")
            .to_string();
        if !ip.is_empty() && mac.contains(':') && mac != "(incomplete)" {
            rows.push((ip, mac.to_uppercase()));
        }
    }
    rows
}

/// Full IEEE MA-L registry, embedded at build time (40k assignments).
/// Format: `PREFIX|Organization` — one per line, sorted.
static OUI_DB: once_cell::sync::Lazy<std::collections::HashMap<&'static str, &'static str>> =
    once_cell::sync::Lazy::new(|| {
        include_str!("../data/oui.txt")
            .lines()
            .filter_map(|line| line.split_once('|'))
            .collect()
    });

fn oui_vendor(mac: &str) -> Option<String> {
    let hex: String = mac
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_uppercase();
    if hex.len() < 6 {
        return None;
    }
    OUI_DB.get(&hex[..6]).map(|vendor| (*vendor).to_string())
}

fn resolver_for(resolver_ip: Option<&str>) -> Result<TokioAsyncResolver, String> {
    match resolver_ip {
        Some(ip) if !ip.trim().is_empty() => {
            let addr: IpAddr = ip.trim().parse().map_err(|_| format!("invalid resolver address: {ip}"))?;
            let group = NameServerConfigGroup::from_ips_clear(&[addr], 53, true);
            let config = ResolverConfig::from_parts(None, vec![], group);
            Ok(TokioAsyncResolver::tokio(config, ResolverOpts::default()))
        }
        _ => TokioAsyncResolver::tokio_from_system_conf().map_err(|e| format!("cannot read system resolvers: {e}")),
    }
}

async fn probe_host(ip: String, ports: Vec<u16>, resolver: TokioAsyncResolver) -> LanHost {
    let mut open = Vec::new();
    let mut latency: Option<f64> = None;

    for port in ports {
        let start = Instant::now();
        let target = format!("{ip}:{port}");
        if let Ok(Ok(_)) = tokio::time::timeout(Duration::from_millis(420), tokio::net::TcpStream::connect(&target)).await {
            open.push(LanPort {
                port,
                service: service_for_port(port).to_string(),
            });
            if latency.is_none() {
                latency = Some(start.elapsed().as_secs_f64() * 1000.0);
            }
        }
    }

    let hostname = resolver
        .reverse_lookup(ip.parse::<IpAddr>().unwrap())
        .await
        .ok()
        .and_then(|names| names.iter().next().map(|n| n.to_string().trim_end_matches('.').to_string()));

    let alive = !open.is_empty() || hostname.is_some();
    LanHost {
        ip,
        hostname,
        mac: None,
        vendor: None,
        alive,
        open_ports: open,
        latency_ms: latency,
    }
}

#[tauri::command]
pub async fn start_lan_scan(app: AppHandle, cidr: String, ports: Vec<u16>) -> Result<String, String> {
    let subnet = if cidr.trim().is_empty() {
        detect_cidr().ok_or_else(|| "could not detect the local subnet; pass a CIDR such as 192.168.1.0/24".to_string())?
    } else {
        cidr.trim().to_string()
    };

    let (base, prefix) = subnet
        .split_once('/')
        .ok_or_else(|| "CIDR must look like 192.168.1.0/24".to_string())?;
    let base_ip: Ipv4Addr = base.parse().map_err(|_| "invalid network address".to_string())?;
    let prefix: u32 = prefix.parse().map_err(|_| "invalid prefix length".to_string())?;
    if !(22..=32).contains(&prefix) {
        return Err("scan range limited to /22 or narrower".into());
    }

    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix) };
    let network = u32::from(base_ip) & mask;
    let broadcast = network | !mask;
    let total = (broadcast - network).saturating_sub(1) as usize;

    let ports = if ports.is_empty() { vec![22, 80, 443, 445, 3389, 5000, 8000, 8080] } else { ports };
    let resolver = resolver_for(None)?;

    let task_id = uuid::Uuid::new_v4().to_string();
    let emitter = app.clone();
    let resolver_clone = resolver.clone();

    tauri::async_runtime::spawn(async move {
        let mut scanned = 0usize;
        let mut found: Vec<LanHost> = Vec::new();
        let mut batch = Vec::new();

        for offset in 1..=(broadcast - network).saturating_sub(1) {
            let ip = Ipv4Addr::from(network + offset).to_string();
            batch.push(probe_host(ip, ports.clone(), resolver_clone.clone()));
            scanned += 1;

            if batch.len() >= 24 || scanned == total {
                let results: Vec<LanHost> = futures_util::future::join_all(batch.drain(..)).await;
                found.extend(results.into_iter().filter(|h| h.alive));
                let _ = emitter.emit(
                    "lan-scan-progress",
                    LanScanProgress {
                        scanned,
                        total,
                        hosts: found.clone(),
                        done: false,
                        error: None,
                    },
                );
            }
        }

        // Enrich with ARP MACs + vendor
        let arp = arp_table();
        for host in found.iter_mut() {
            if let Some((_, mac)) = arp.iter().find(|(ip, _)| *ip == host.ip) {
                host.mac = Some(mac.clone());
                host.vendor = oui_vendor(mac);
            }
        }

        let _ = emitter.emit(
            "lan-scan-progress",
            LanScanProgress {
                scanned,
                total,
                hosts: found,
                done: true,
                error: None,
            },
        );
    });

    Ok(task_id)
}

/* ---------------------------------- DNS ---------------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    pub record_type: String,
    pub value: String,
    pub ttl: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsAnswer {
    pub resolver: String,
    pub domain: String,
    pub record_type: String,
    pub records: Vec<DnsRecord>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn dns_query(domain: String, record_type: String, resolver: Option<String>) -> Result<DnsAnswer, String> {
    let domain = domain.trim().trim_end_matches('.').to_string();
    if domain.is_empty() {
        return Err("domain is required".into());
    }
    let resolver_label = resolver.clone().unwrap_or_else(|| "system".into());
    let rtype = record_type.to_uppercase();

    let client = match resolver_for(resolver.as_deref()) {
        Ok(client) => client,
        Err(e) => {
            return Ok(DnsAnswer {
                resolver: resolver_label,
                domain,
                record_type: rtype,
                records: vec![],
                duration_ms: 0,
                error: Some(e),
            })
        }
    };

    let start = Instant::now();
    let result = match rtype.as_str() {
        "A" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::A).await,
        "AAAA" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::AAAA).await,
        "CNAME" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::CNAME).await,
        "NS" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::NS).await,
        "MX" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::MX).await,
        "TXT" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::TXT).await,
        "SOA" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::SOA).await,
        "PTR" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::PTR).await,
        "CAA" => client.lookup(domain.clone(), hickory_resolver::proto::rr::RecordType::CAA).await,
        other => return Err(format!("unsupported record type: {other}")),
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(lookup) => Ok(DnsAnswer {
            resolver: resolver_label,
            domain,
            record_type: rtype,
            records: lookup
                .record_iter()
                .map(|record| DnsRecord {
                    record_type: record.record_type().to_string(),
                    value: record.data().map(|d| d.to_string().trim_matches('"').to_string()).unwrap_or_default(),
                    ttl: Some(record.ttl()),
                })
                .collect(),
            duration_ms,
            error: None,
        }),
        Err(e) => Ok(DnsAnswer {
            resolver: resolver_label,
            domain,
            record_type: rtype,
            records: vec![],
            duration_ms,
            error: Some(e.to_string()),
        }),
    }
}

/* ---------------------------- Ping / Traceroute --------------------------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PingSample {
    pub seq: u32,
    pub rtt_ms: Option<f64>,
    pub ttl: Option<i32>,
    pub error: Option<String>,
}

fn parse_ping_line(line: &str) -> Option<PingSample> {
    // 64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=12.345 ms
    let seq = line
        .split("icmp_seq=")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse::<u32>().ok())?;
    let ttl = line
        .split("ttl=")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse::<i32>().ok());
    let rtt = line
        .split("time=")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse::<f64>().ok());
    Some(PingSample {
        seq,
        rtt_ms: rtt,
        ttl,
        error: None,
    })
}

#[tauri::command]
pub async fn start_ping(app: AppHandle, host: String, count: u32) -> Result<String, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("host is required".into());
    }
    let count = count.clamp(1, 200);
    let task = uuid::Uuid::new_v4().to_string();
    let emitter = app.clone();

    tauri::async_runtime::spawn(async move {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let spawned = Command::new("/sbin/ping")
            .args(["-n", "-c", &count.to_string(), &host])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        match spawned {
            Ok(mut child) => {
                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines().map_while(Result::ok) {
                        if let Some(sample) = parse_ping_line(&line) {
                            let _ = emitter.emit("ping-sample", sample);
                        } else if line.contains("Request timeout") || line.contains("100.0% packet loss") {
                            let _ = emitter.emit(
                                "ping-sample",
                                PingSample {
                                    seq: 0,
                                    rtt_ms: None,
                                    ttl: None,
                                    error: Some(line.trim().to_string()),
                                },
                            );
                        }
                    }
                }
                let _ = child.wait();
            }
            Err(e) => {
                let _ = emitter.emit(
                    "ping-sample",
                    PingSample {
                        seq: 0,
                        rtt_ms: None,
                        ttl: None,
                        error: Some(format!("could not run ping: {e}")),
                    },
                );
            }
        }
    });

    Ok(task)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteHop {
    pub hop: u32,
    pub host: Option<String>,
    pub ip: Option<String>,
    pub rtt_ms: Vec<f64>,
}

#[tauri::command]
pub async fn traceroute(host: String, max_hops: u32) -> Result<Vec<TracerouteHop>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hops = max_hops.clamp(1, 64);
        let out = run(
            "/usr/sbin/traceroute",
            &["-n", "-w", "2", "-q", "3", "-m", &hops.to_string(), &host],
        )?;

        let mut result = Vec::new();
        for line in out.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.is_empty() {
                continue;
            }
            let Ok(hop) = cols[0].parse::<u32>() else { continue };
            let mut ip: Option<String> = None;
            let mut rtts: Vec<f64> = Vec::new();
            for col in cols.iter().skip(1) {
                if col.parse::<f64>().is_ok() {
                    if let Ok(v) = col.parse::<f64>() {
                        rtts.push(v);
                    }
                } else if *col != "ms" && *col != "*" && ip.is_none() {
                    ip = Some(col.trim_matches(|c| c == '(' || c == ')').to_string());
                }
            }
            result.push(TracerouteHop {
                hop,
                host: None,
                ip,
                rtt_ms: rtts,
            });
        }
        Ok::<_, String>(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* -------------------------------- Speed test ------------------------------ */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpeedSample {
    pub mbps: f64,
    pub bytes: u64,
    pub elapsed_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestResult {
    pub download_mbps: f64,
    pub upload_mbps: Option<f64>,
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub server: String,
    pub bytes_transferred: u64,
    pub duration_ms: u64,
}

/// Streams a real download from Cloudflare's speed endpoint and emits
/// throughput samples every ~250 ms so the UI can plot the curve.
#[tauri::command]
pub async fn start_speed_test(app: AppHandle) -> Result<SpeedTestResult, String> {
    let client = http_client(60_000, true, false);
    let down_url = "https://speed.cloudflare.com/__down?bytes=50000000";

    // Latency + jitter: three tiny requests
    let mut latencies = Vec::new();
    for _ in 0..3 {
        let start = Instant::now();
        let _ = client.get("https://speed.cloudflare.com/__down?bytes=0").send().await;
        latencies.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    let latency = latencies.iter().cloned().fold(f64::MAX, f64::min);
    let jitter = if latencies.len() > 1 {
        let max = latencies.iter().cloned().fold(0.0_f64, f64::max);
        Some((max - latency).max(0.0))
    } else {
        None
    };

    let start = Instant::now();
    let response = client
        .get(down_url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut bytes = 0u64;
    let mut mbps = 0.0f64;
    let mut last_emit = Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("transfer interrupted: {e}"))?;
        bytes += chunk.len() as u64;
        let elapsed = start.elapsed().as_secs_f64();
        if elapsed > 0.0 {
            mbps = (bytes as f64 * 8.0) / elapsed / 1_000_000.0;
        }
        if last_emit.elapsed() >= Duration::from_millis(250) {
            last_emit = Instant::now();
            let _ = app.emit(
                "speed-sample",
                SpeedSample {
                    mbps: (mbps * 100.0).round() / 100.0,
                    bytes,
                    elapsed_ms: (elapsed * 1000.0) as u64,
                },
            );
        }
        if elapsed > 12.0 {
            break;
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(SpeedTestResult {
        download_mbps: (mbps * 100.0).round() / 100.0,
        upload_mbps: None,
        latency_ms: Some((latency * 10.0).round() / 10.0),
        jitter_ms: jitter.map(|j| (j * 10.0).round() / 10.0),
        server: "speed.cloudflare.com".into(),
        bytes_transferred: bytes,
        duration_ms,
    })
}

/* ------------------------------ Subdomains ------------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubdomainFinding {
    pub host: String,
    pub source: String,
    pub ips: Vec<String>,
}

#[tauri::command]
pub async fn find_subdomains(domain: String) -> Result<Vec<SubdomainFinding>, String> {
    let domain = domain.trim().trim_end_matches('.').to_lowercase();
    if domain.is_empty() {
        return Err("domain is required".into());
    }
    let client = http_client(45_000, true, false);
    let url = format!("https://crt.sh/?q=%25.{domain}&output=json");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("crt.sh request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("crt.sh returned HTTP {}", response.status()));
    }

    let body = response.text().await.map_err(|e| e.to_string())?;
    let parsed: Vec<Value> = serde_json::from_str(&body).unwrap_or_default();

    let mut names: Vec<String> = Vec::new();
    for entry in parsed {
        if let Some(name_value) = entry.get("name_value").and_then(|v| v.as_str()) {
            for name in name_value.split('\n') {
                let candidate = name.trim().trim_start_matches("*.").to_lowercase();
                if !candidate.is_empty()
                    && candidate.ends_with(&domain)
                    && !candidate.contains('@')
                    && !names.contains(&candidate)
                {
                    names.push(candidate);
                }
            }
        }
    }

    names.sort();
    names.truncate(400);

    let resolver = resolver_for(None)?;
    let mut out = Vec::new();
    for name in names {
        let ips = resolver
            .lookup_ip(name.clone())
            .await
            .map(|lookup| lookup.iter().map(|ip| ip.to_string()).collect::<Vec<_>>())
            .unwrap_or_default();
        out.push(SubdomainFinding {
            host: name,
            source: "crtsh".into(),
            ips,
        });
    }

    Ok(out)
}

/* ------------------------------- WiFi maps ------------------------------- */

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapShape {
    pub id: String,
    pub kind: String,
    pub points: Vec<MapPointCoord>,
    pub label: Option<String>,
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapPointCoord {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapScan {
    pub ssid: Option<String>,
    pub bssid: Option<String>,
    pub rssi: i32,
    pub channel: Option<i32>,
    pub band: Option<String>,
    pub security: Option<String>,
    pub noise: Option<i32>,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapPoint {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub created_at: String,
    pub scans: Vec<MapScan>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WifiMapDoc {
    pub id: String,
    pub name: String,
    pub description: String,
    pub width: f64,
    pub height: f64,
    pub shapes: Vec<MapShape>,
    pub points: Vec<MapPoint>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub point_count: usize,
    pub updated_at: String,
}

fn maps_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "no application support directory".to_string())?
        .join("com.shift.tools")
        .join("maps");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn list_maps() -> Result<Vec<MapSummary>, String> {
    let dir = maps_dir()?;
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(doc) = serde_json::from_str::<WifiMapDoc>(&text) {
                    out.push(MapSummary {
                        id: doc.id,
                        name: doc.name,
                        description: doc.description,
                        point_count: doc.points.len(),
                        updated_at: doc.updated_at,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[tauri::command]
pub async fn load_map(id: String) -> Result<WifiMapDoc, String> {
    let path = maps_dir()?.join(format!("{id}.json"));
    let text = std::fs::read_to_string(&path).map_err(|e| format!("map not found: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("corrupt map file: {e}"))
}

#[tauri::command]
pub async fn save_map(doc: WifiMapDoc) -> Result<MapSummary, String> {
    let dir = maps_dir()?;
    let path = dir.join(format!("{}.json", doc.id));
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("could not write map: {e}"))?;
    Ok(MapSummary {
        id: doc.id,
        name: doc.name,
        description: doc.description,
        point_count: doc.points.len(),
        updated_at: doc.updated_at,
    })
}

#[tauri::command]
pub async fn delete_map(id: String) -> Result<(), String> {
    let path = maps_dir()?.join(format!("{id}.json"));
    std::fs::remove_file(&path).map_err(|e| format!("could not delete map: {e}"))
}

/// Convenience for the mapper: one fresh scan, normalised to scan entries.
#[tauri::command]
pub async fn capture_point_scans() -> Result<Vec<MapScan>, String> {
    let scan = wifi_scan().await?;
    let timestamp = now_iso();
    Ok(scan
        .aps
        .into_iter()
        .filter_map(|ap| {
            let rssi = ap.rssi?;
            Some(MapScan {
                ssid: ap.ssid,
                bssid: ap.bssid,
                rssi,
                channel: ap.channel,
                band: ap.band,
                security: ap.security,
                noise: ap.noise,
                timestamp: timestamp.clone(),
            })
        })
        .collect())
}
