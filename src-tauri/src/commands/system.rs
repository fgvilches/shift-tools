use crate::util::{dir_size, expand_home, now_iso, run, run_lossy};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use sysinfo::{Pid, System, Users};

static SYS: Lazy<Mutex<System>> = Lazy::new(|| Mutex::new(System::new_all()));

const PROTECTED: &[&str] = &[
    "launchd",
    "kernel_task",
    "windowserver",
    "loginwindow",
    "opendirectoryd",
    "coreaudiod",
    "cfprefsd",
    "notifyd",
    "powerd",
    "runningboardd",
    "tccd",
    "shift-tools",
    "finder",
    "dock",
    "systemuiserver",
    "controlcenter",
];

const DEV_TARGETS: &[&str] = &[
    "python", "python3", "python3.11", "python3.12", "python3.13", "node", "deno", "bun", "ruby",
    "cargo", "rustc", "swiftc", "javac", "kotlinc", "go", "clang", "clangd", "gcc", "make",
    "tauri", "electron", "electron-builder", "webpack", "vite", "rollup", "esbuild", "gradle",
    "maven", "mvn", "metro", "jest", "vitest", "playwright", "cypress", "tsc", "nodemon",
    "uvicorn", "gunicorn", "flask", "django", "next", "nuxt", "turbo", "nx", "pytest",
    "nginx", "apache2", "postgres", "postgresql", "redis-server", "mysqld", "mongod", "docker",
    "containerd", "colima", "adb", "fastboot", "xcodebuild", "simctl", "kotlin", "dart", "flutter",
    "storybook", "air", "watchman", "babel-node", "ts-node", "nodemon",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub command: String,
    pub exe: Option<String>,
    pub category: String,
    pub memory_bytes: u64,
    pub cpu_percent: f32,
    pub run_time_secs: u64,
    pub user: String,
    pub is_gui_app: bool,
    pub protected: bool,
    pub is_dev: bool,
    pub start_time: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillResult {
    pub pid: u32,
    pub name: String,
    pub ok: bool,
    pub signal: String,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub host_name: String,
    pub os_version: String,
    pub arch: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub cpu_usage_percent: f32,
    pub total_memory_bytes: u64,
    pub used_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub gpu_percent: Option<f32>,
    pub gpu_renderer_percent: Option<f32>,
    pub gpu_memory_bytes: Option<u64>,
    pub uptime_secs: u64,
    pub load_avg: [f64; 3],
    pub dev_process_count: usize,
    pub dev_memory_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub state: String,
    pub local_addr: String,
    pub remote_addr: String,
    pub pid: Option<u32>,
    pub process: String,
    pub user: String,
    pub family: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskTarget {
    pub id: String,
    pub label: String,
    pub path: String,
    pub kind: String,
    pub size_bytes: u64,
    pub exists: bool,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub id: String,
    pub label: String,
    pub freed_bytes: u64,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamProcess {
    pub pid: u32,
    pub name: String,
    pub memory_bytes: u64,
    pub cpu_percent: f32,
    pub category: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamSnapshot {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub wired_bytes: u64,
    pub compressed_bytes: u64,
    pub cached_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub pressure: String,
    pub processes: Vec<RamProcess>,
    pub taken_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInspection {
    pub path: String,
    pub exists: bool,
    pub kind: String,
    pub is_app: bool,
    pub has_quarantine: bool,
    pub attributes: Vec<String>,
    pub size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineResult {
    pub path: String,
    pub status: String,
    pub message: String,
    pub attributes_before: Vec<String>,
    pub attributes_after: Vec<String>,
    pub commands: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSample {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

fn categorize(name: &str, command: &str, exe: &str) -> String {
    let hay = format!("{} {} {}", name, command, exe).to_lowercase();
    let name_l = name.to_lowercase();

    if hay.contains("node") || name_l == "node" || name_l == "npm" || name_l == "pnpm" || name_l == "yarn" {
        if hay.contains("electron") {
            return "build".into();
        }
        return "node".into();
    }
    if hay.contains("python") || hay.contains("pytest") || hay.contains("uvicorn") || hay.contains("gunicorn") {
        return "python".into();
    }
    if hay.contains("cargo") || hay.contains("rustc") || hay.contains("/target/debug") || hay.contains("tauri") {
        return "rust".into();
    }
    if hay.contains("java") || hay.contains("kotlin") || hay.contains("gradle") || hay.contains("maven") {
        return "java".into();
    }
    if hay.contains("swift") || hay.contains("xcodebuild") || hay.contains("simctl") || hay.contains("simulator") {
        return "swift".into();
    }
    if hay.contains("go1") || name_l == "go" || name_l == "gopls" || hay.contains("/go/bin") {
        return "go".into();
    }
    if hay.contains("ruby") || hay.contains("gem") || hay.contains("rails") {
        return "ruby".into();
    }
    if hay.contains("docker") || hay.contains("containerd") || hay.contains("colima") || hay.contains("qemu") {
        return "container".into();
    }
    if hay.contains("android") || hay.contains("adb") || hay.contains("emulator") || hay.contains("fastboot") || hay.contains("dart") || hay.contains("flutter") {
        return "mobile".into();
    }
    if hay.contains("postgres") || hay.contains("redis") || hay.contains("mysql") || hay.contains("mongo") || hay.contains("nginx") || hay.contains("apache") {
        return "server".into();
    }
    if hay.contains("webpack") || hay.contains("vite") || hay.contains("rollup") || hay.contains("esbuild") || hay.contains("turbo") {
        return "build".into();
    }
    "other".into()
}

fn is_dev_process(name: &str, command: &str, exe: &str) -> bool {
    let name_l = name.to_lowercase();
    let exe_base = exe
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_lowercase();
    let hay = format!("{} {}", command.to_lowercase(), exe.to_lowercase());

    // Tooling often ships a versioned binary name (python3.12, node20, go1.22).
    let matches_binary = |candidate: &str| -> bool {
        if candidate.is_empty() {
            return false;
        }
        let trimmed = candidate.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.' || c == '-' || c == '_');
        DEV_TARGETS.iter().any(|t| candidate == *t || trimmed == *t)
    };

    if matches_binary(&exe_base) || matches_binary(&name_l) {
        return true;
    }

    // Path-based signals for interpreters and tooling that rename their binary
    [
        "/node_modules/.bin/",
        "/node_modules/",
        "/.venv/",
        "/venv/bin/",
        "/site-packages/",
        "/target/debug/",
        "/target/release/",
        "/.cargo/bin/",
        "deriveddata/",
        "/library/android/sdk/",
        "/.gradle/",
        "/.m2/",
        "/.npm/_cacache/",
    ]
    .iter()
    .any(|needle| hay.contains(needle))
}

fn user_name(users: &Users, pid: &Pid, process: &sysinfo::Process) -> String {
    let _ = pid;
    process
        .user_id()
        .and_then(|uid| users.get_user_by_id(uid))
        .map(|u| u.name().to_string())
        .unwrap_or_default()
}

/// Every process on the host, flagged as development tooling or not.
/// The view decides how to separate them; filtering here would lose the
/// "show everything in the background" behaviour.
#[tauri::command]
pub async fn list_processes() -> Result<Vec<ProcessInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut sys = SYS.lock().map_err(|e| e.to_string())?;
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        sys.refresh_cpu_usage();

        let users = Users::new_with_refreshed_list();
        let mut out = Vec::new();

        for (pid, p) in sys.processes() {
            let name = p.name().to_string_lossy().to_string();
            if name.is_empty() {
                continue;
            }
            let command = p
                .cmd()
                .iter()
                .map(|c| c.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(" ");
            let exe = p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let name_l = name.to_lowercase();
            let protected = pid.as_u32() < 100 || PROTECTED.contains(&name_l.as_str());
            let is_dev = !protected && is_dev_process(&name, &command, &exe);

            out.push(ProcessInfo {
                pid: pid.as_u32(),
                category: categorize(&name, &command, &exe),
                name,
                command: if command.is_empty() { exe.clone() } else { command },
                is_gui_app: exe.contains(".app/Contents/MacOS/"),
                protected,
                is_dev,
                memory_bytes: p.memory(),
                cpu_percent: (p.cpu_usage() * 100.0).round() / 100.0,
                run_time_secs: p.run_time(),
                user: user_name(&users, pid, p),
                exe: if exe.is_empty() { None } else { Some(exe) },
                start_time: Some(p.start_time()),
            });
        }

        out.sort_by_key(|a| std::cmp::Reverse(a.memory_bytes));
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn is_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

#[tauri::command]
pub async fn kill_processes(pids: Vec<u32>, force: bool) -> Result<Vec<KillResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let self_pid = std::process::id();
        let mut results = Vec::new();

        for pid in pids {
            let name = {
                let sys = SYS.lock().map_err(|e| e.to_string())?;
                sys.process(Pid::from_u32(pid))
                    .map(|p| p.name().to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("pid {pid}"))
            };

            if pid == self_pid || pid < 100 {
                results.push(KillResult {
                    pid,
                    name,
                    ok: false,
                    signal: "none".into(),
                    error: Some("refused: protected process".into()),
                });
                continue;
            }

            let signal_name = if force { "SIGKILL" } else { "SIGTERM" };
            let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
            let sent = unsafe { libc::kill(pid as i32, signal) } == 0;

            if !sent {
                results.push(KillResult {
                    pid,
                    name,
                    ok: false,
                    signal: signal_name.into(),
                    error: Some(std::io::Error::last_os_error().to_string()),
                });
                continue;
            }

            let mut terminated = false;
            for _ in 0..30 {
                if !is_alive(pid as i32) {
                    terminated = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            if terminated {
                results.push(KillResult {
                    pid,
                    name,
                    ok: true,
                    signal: signal_name.into(),
                    error: None,
                });
                continue;
            }

            // Escalate: SIGKILL after the grace window
            let killed = unsafe { libc::kill(pid as i32, libc::SIGKILL) } == 0;
            results.push(KillResult {
                pid,
                name,
                ok: killed,
                signal: "SIGKILL".into(),
                error: if killed {
                    None
                } else {
                    Some("process survived SIGTERM and SIGKILL".into())
                },
            });
        }

        Ok::<_, String>(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GPU utilisation is only exposed system-wide on macOS: `IOAccelerator`
/// performance statistics. There is no per-process GPU accounting in the
/// public APIs (rusage has energy, not GPU time), so the UI shows this as a
/// host metric and never attributes it to a process.
static GPU_UTIL: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r#""Device Utilization %"=(\d+)"#).unwrap());
static GPU_RENDER: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r#""Renderer Utilization %"=(\d+)"#).unwrap());
static GPU_MEM: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r#""Alloc system memory"=(\d+)"#).unwrap());

fn max_capture(re: &regex::Regex, text: &str) -> Option<u64> {
    re.captures_iter(text)
        .filter_map(|c| c.get(1).and_then(|m| m.as_str().parse::<u64>().ok()))
        .max()
}

fn gpu_usage() -> (Option<f32>, Option<f32>, Option<u64>) {
    let raw = run_lossy("/usr/sbin/ioreg", &["-r", "-c", "IOAccelerator", "-d", "1"]);
    if raw.trim().is_empty() {
        return (None, None, None);
    }
    (
        max_capture(&GPU_UTIL, &raw).map(|v| v as f32),
        max_capture(&GPU_RENDER, &raw).map(|v| v as f32),
        max_capture(&GPU_MEM, &raw),
    )
}

#[tauri::command]
pub async fn system_stats() -> Result<SystemStats, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut sys = SYS.lock().map_err(|e| e.to_string())?;
        sys.refresh_memory();
        sys.refresh_cpu_usage();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        let (dev_count, dev_mem) = sys
            .processes()
            .values()
            .filter(|p| {
                let name = p.name().to_string_lossy().to_string();
                let command = p.cmd().iter().map(|c| c.to_string_lossy().to_string()).collect::<Vec<_>>().join(" ");
                let exe = p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
                is_dev_process(&name, &command, &exe)
            })
            .fold((0usize, 0u64), |(count, mem), p| (count + 1, mem + p.memory()));

        let gpu = gpu_usage();
        let load = System::load_average();
        let os_version = run("sw_vers", &["-productVersion"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        Ok::<_, String>(SystemStats {
            host_name: System::host_name().unwrap_or_else(|| "mac".into()),
            os_version,
            arch: std::env::consts::ARCH.to_string(),
            cpu_brand: sys
                .cpus()
                .first()
                .map(|c| c.brand().trim().to_string())
                .unwrap_or_else(|| "Apple Silicon".into()),
            cpu_cores: sys.cpus().len(),
            cpu_usage_percent: (sys.global_cpu_usage() * 10.0).round() / 10.0,
            total_memory_bytes: sys.total_memory(),
            used_memory_bytes: sys.used_memory(),
            available_memory_bytes: sys.available_memory(),
            swap_total_bytes: sys.total_swap(),
            swap_used_bytes: sys.used_swap(),
            gpu_percent: gpu.0,
            gpu_renderer_percent: gpu.1,
            gpu_memory_bytes: gpu.2,
            uptime_secs: System::uptime(),
            load_avg: [load.one, load.five, load.fifteen],
            dev_process_count: dev_count,
            dev_memory_bytes: dev_mem,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn vm_stat_value(output: &str, key: &str) -> Option<u64> {
    for line in output.lines() {
        if line.starts_with(key) {
            let digits: String = line
                .chars()
                .skip(key.len())
                .filter(|c| c.is_ascii_digit())
                .collect();
            return digits.parse().ok();
        }
    }
    None
}

#[tauri::command]
pub async fn ram_snapshot() -> Result<RamSnapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut sys = SYS.lock().map_err(|e| e.to_string())?;
        sys.refresh_memory();
        sys.refresh_cpu_usage();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        let vm = run_lossy("vm_stat", &[]);
        let page_size = vm
            .lines()
            .next()
            .and_then(|l| l.split("page size of ").nth(1))
            .and_then(|l| l.split(' ').next())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(16384);

        let wired = vm_stat_value(&vm, "Pages wired down:").unwrap_or(0) * page_size;
        let compressed = vm_stat_value(&vm, "Pages occupied by compressor:").unwrap_or(0) * page_size;
        let purgeable = vm_stat_value(&vm, "Pages purgeable:").unwrap_or(0) * page_size;

        let total = sys.total_memory();
        let available = sys.available_memory();
        let ratio = if total > 0 { available as f64 / total as f64 } else { 1.0 };
        let pressure = if ratio > 0.25 {
            "normal"
        } else if ratio > 0.10 {
            "warning"
        } else {
            "critical"
        };

        let mut processes: Vec<RamProcess> = sys
            .processes()
            .iter()
            .map(|(pid, p)| RamProcess {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().to_string(),
                memory_bytes: p.memory(),
                cpu_percent: (p.cpu_usage() * 10.0).round() / 10.0,
                category: categorize(
                    &p.name().to_string_lossy(),
                    &p.cmd().iter().map(|c| c.to_string_lossy().to_string()).collect::<Vec<_>>().join(" "),
                    &p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default(),
                ),
            })
            .collect();
        processes.sort_by_key(|a| std::cmp::Reverse(a.memory_bytes));
        processes.truncate(14);

        Ok::<_, String>(RamSnapshot {
            total_bytes: total,
            used_bytes: sys.used_memory(),
            available_bytes: available,
            wired_bytes: wired,
            compressed_bytes: compressed,
            cached_bytes: purgeable,
            swap_total_bytes: sys.total_swap(),
            swap_used_bytes: sys.used_swap(),
            pressure: pressure.to_string(),
            processes,
            taken_at: now_iso(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/* --------------------------------- Ports --------------------------------- */

fn parse_port_name(name: &str) -> (String, u16, String, u16) {
    // NAME looks like: "*:8080", "127.0.0.1:5173", "[::1]:8080",
    // "127.0.0.1:5173->127.0.0.1:52000 (ESTABLISHED)"
    let cleaned = name.split(' ').next().unwrap_or(name);
    let mut local = cleaned;
    let mut remote = "";
    if let Some((l, r)) = cleaned.split_once("->") {
        local = l;
        remote = r.split('(').next().unwrap_or(r);
    }

    let split_host_port = |s: &str| -> (String, u16) {
        match s.rfind(':') {
            Some(idx) => {
                let host = s[..idx].trim_matches(|c| c == '[' || c == ']').to_string();
                let port = s[idx + 1..].trim().parse::<u16>().unwrap_or(0);
                (host, port)
            }
            None => (s.to_string(), 0),
        }
    };

    let (lhost, lport) = split_host_port(local);
    let (rhost, rport) = split_host_port(remote);

    let format_host_port = |host: String, port: u16| -> String {
        if host.contains(':') {
            format!("[{host}]:{port}")
        } else {
            format!("{host}:{port}")
        }
    };

    let local_addr = if lhost.is_empty() {
        format!("*:{lport}")
    } else {
        format_host_port(lhost, lport)
    };
    let remote_addr = if remote.is_empty() {
        String::new()
    } else {
        format_host_port(rhost, rport)
    };
    (local_addr, lport, remote_addr, rport)
}

#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = run("/usr/sbin/lsof", &["-nP", "-iTCP", "-iUDP"]).unwrap_or_default();
        let mut ports: Vec<PortInfo> = Vec::new();

        for line in output.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 9 {
                continue;
            }
            let process = cols[0].to_string();
            let pid = cols[1].parse::<u32>().ok();
            let user = cols[2].to_string();
            let family_idx = cols.iter().position(|c| *c == "IPv4" || *c == "IPv6");
            let Some(fidx) = family_idx else { continue };
            let family = if cols[fidx] == "IPv4" { "ipv4" } else { "ipv6" };
            // lsof layout: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME (STATE)
            let node = cols.get(fidx + 3).copied().unwrap_or("");
            if node != "TCP" && node != "UDP" {
                continue;
            }
            let name = cols.get(fidx + 4).copied().unwrap_or("");
            let tail = cols.get(fidx + 5).copied().unwrap_or("");
            let (local_addr, port, remote_addr, _remote_port) = parse_port_name(name);

            let state = if tail.starts_with('(') {
                tail.trim_matches(|c| c == '(' || c == ')').to_string()
            } else if let Some(start) = name.find('(') {
                name[start + 1..].trim_end_matches(')').to_string()
            } else if node == "UDP" {
                "UNCONN".to_string()
            } else {
                "UNKNOWN".to_string()
            };

            if port == 0 {
                continue;
            }

            ports.push(PortInfo {
                port,
                protocol: if node == "TCP" { "tcp".into() } else { "udp".into() },
                state,
                local_addr,
                remote_addr,
                pid,
                process,
                user,
                family: family.to_string(),
            });
        }

        ports.sort_by_key(|p| (p.port, p.protocol.clone()));
        ports.dedup_by(|a, b| a.port == b.port && a.protocol == b.protocol && a.pid == b.pid && a.local_addr == b.local_addr);
        Ok::<_, String>(ports)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn kill_port(port: u16, protocol: String, force: bool) -> Result<Vec<KillResult>, String> {
    let ports = list_ports().await?;
    let mut pids: Vec<u32> = ports
        .iter()
        .filter(|p| p.port == port && p.protocol == protocol)
        .filter_map(|p| p.pid)
        .collect();
    pids.sort_unstable();
    pids.dedup();
    if pids.is_empty() {
        return Err(format!("no process is bound to {protocol}/{port}"));
    }
    kill_processes(pids, force).await
}

/* --------------------------------- Disk ---------------------------------- */

fn disk_targets_definition() -> Vec<(&'static str, &'static str, String, &'static str, &'static str)> {
    let h = crate::util::home().to_string_lossy().to_string();
    vec![
        ("xcode-derived", "Xcode DerivedData", format!("{h}/Library/Developer/Xcode/DerivedData"), "xcode", "Build artifacts for every open Xcode project"),
        ("xcode-archives", "Xcode Archives", format!("{h}/Library/Developer/Xcode/Archives"), "xcode", "Signed .xcarchive bundles"),
        ("ios-devicesupport", "iOS DeviceSupport", format!("{h}/Library/Developer/Xcode/iOS DeviceSupport"), "xcode", "Debug symbols per iOS version"),
        ("coresim", "CoreSimulator Caches", format!("{h}/Library/Developer/CoreSimulator/Caches"), "xcode", "Simulator runtime caches"),
        ("npm", "npm cache", format!("{h}/.npm/_cacache"), "node", "Local package tarballs"),
        ("yarn", "Yarn cache", format!("{h}/Library/Caches/Yarn"), "node", "Yarn global cache"),
        ("pnpm", "pnpm store", format!("{h}/Library/pnpm/store"), "node", "Content-addressed pnpm store"),
        ("pip", "pip cache", format!("{h}/Library/Caches/pip"), "python", "Downloaded wheels"),
        ("cargo-registry", "Cargo registry cache", format!("{h}/.cargo/registry/cache"), "rust", "Crate archives"),
        ("cargo-git", "Cargo git checkouts", format!("{h}/.cargo/git/checkouts"), "rust", "Git dependencies"),
        ("gradle", "Gradle caches", format!("{h}/.gradle/caches"), "java", "Gradle dependency cache"),
        ("maven", "Maven repository", format!("{h}/.m2/repository"), "java", "Maven artifacts"),
        ("docker", "Docker data", format!("{h}/Library/Containers/com.docker.docker/Data"), "container", "Images, volumes and build cache"),
        ("homebrew", "Homebrew cache", format!("{h}/Library/Caches/Homebrew"), "system", "Downloaded bottles"),
        ("go-build", "Go build cache", format!("{h}/Library/Caches/go-build"), "go", "Compiled package cache"),
    ]
}

#[tauri::command]
pub async fn disk_targets() -> Result<Vec<DiskTarget>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut out = Vec::new();
        for (id, label, path, kind, detail) in disk_targets_definition() {
            let p = Path::new(&path);
            let exists = p.exists();
            let size = if exists { dir_size(p) } else { 0 };
            out.push(DiskTarget {
                id: id.to_string(),
                label: label.to_string(),
                path,
                kind: kind.to_string(),
                size_bytes: size,
                exists,
                detail: detail.to_string(),
            });
        }
        out.sort_by_key(|a| std::cmp::Reverse(a.size_bytes));
        Ok::<_, String>(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clean_disk(ids: Vec<String>) -> Result<Vec<CleanReport>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let defs = disk_targets_definition();
        let mut reports = Vec::new();

        for id in ids {
            let Some((tid, label, path, _kind, _detail)) = defs.iter().find(|d| d.0 == id) else {
                reports.push(CleanReport {
                    id,
                    label: "unknown target".into(),
                    freed_bytes: 0,
                    ok: false,
                    error: Some("target is not registered".into()),
                });
                continue;
            };

            let root = std::path::PathBuf::from(path);
            if !root.exists() {
                reports.push(CleanReport {
                    id: tid.to_string(),
                    label: label.to_string(),
                    freed_bytes: 0,
                    ok: true,
                    error: Some("already empty".into()),
                });
                continue;
            }

            let before = dir_size(&root);
            let mut error: Option<String> = None;

            match std::fs::read_dir(&root) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        let child = entry.path();
                        let result = if child.is_dir() {
                            std::fs::remove_dir_all(&child)
                        } else {
                            std::fs::remove_file(&child)
                        };
                        if let Err(e) = result {
                            error = Some(format!("{}: {e}", child.display()));
                        }
                    }
                }
                Err(e) => error = Some(e.to_string()),
            }

            let after = dir_size(&root);
            reports.push(CleanReport {
                id: tid.to_string(),
                label: label.to_string(),
                freed_bytes: before.saturating_sub(after),
                ok: error.is_none(),
                error,
            });
        }

        Ok::<_, String>(reports)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ------------------------------ Quarantine ------------------------------- */

fn xattr_lines(path: &str) -> Vec<String> {
    let out = run_lossy("xattr", &["-l", path]);
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .collect()
}

fn path_kind(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.ends_with(".app") {
        "app".into()
    } else if name.ends_with(".dmg") {
        "dmg".into()
    } else if name.ends_with(".pkg") {
        "pkg".into()
    } else if path.is_dir() {
        "directory".into()
    } else if path.is_file() {
        "file".into()
    } else {
        "missing".into()
    }
}

#[tauri::command]
pub async fn inspect_bundle(path: String) -> Result<BundleInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = expand_home(&path);
        let exists = p.exists();
        let attributes = if exists {
            xattr_lines(&p.to_string_lossy())
        } else {
            vec![]
        };
        let has_quarantine = attributes.iter().any(|a| a.contains("com.apple.quarantine"));
        let kind = path_kind(&p);
        let is_app = kind == "app" || p.join("Contents/Info.plist").exists();
        let size_bytes = if exists {
            if p.is_dir() {
                dir_size(&p)
            } else {
                std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0)
            }
        } else {
            0
        };

        Ok::<_, String>(BundleInspection {
            path: p.to_string_lossy().to_string(),
            exists,
            kind,
            is_app,
            has_quarantine,
            attributes,
            size_bytes,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_quarantine(path: String, recursive: bool) -> Result<QuarantineResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = expand_home(&path);
        let path_str = p.to_string_lossy().to_string();
        if !p.exists() {
            return Ok(QuarantineResult {
                path: path_str,
                status: "error".into(),
                message: "path does not exist".into(),
                attributes_before: vec![],
                attributes_after: vec![],
                commands: vec![],
            });
        }

        let before = xattr_lines(&path_str);
        let had_quarantine = before.iter().any(|a| a.contains("com.apple.quarantine"));
        let mut commands = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        // 1. Targeted removal (fails when the attribute is absent — that is fine).
        let del = std::process::Command::new("xattr")
            .args(["-d", "com.apple.quarantine", &path_str])
            .output();
        commands.push(format!("xattr -d com.apple.quarantine {}", path_str));
        match del {
            Ok(out) if out.status.success() => {}
            Ok(out) => {
                let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if !msg.contains("No such xattr") && !msg.contains("No such file") {
                    errors.push(msg);
                }
            }
            Err(e) => errors.push(e.to_string()),
        }

        // 2. Recursive attribute clear.
        commands.push(format!("xattr -cr {}", path_str));
        let clear_args = if recursive {
            vec!["-cr", &path_str]
        } else {
            vec!["-c", &path_str]
        };
        match std::process::Command::new("xattr").args(&clear_args).output() {
            Ok(out) if out.status.success() => {}
            Ok(out) => errors.push(String::from_utf8_lossy(&out.stderr).trim().to_string()),
            Err(e) => errors.push(e.to_string()),
        }

        let after = xattr_lines(&path_str);
        let still_quarantined = after.iter().any(|a| a.contains("com.apple.quarantine"));

        Ok::<_, String>(QuarantineResult {
            path: path_str,
            status: if still_quarantined {
                "error".into()
            } else if had_quarantine {
                "cleaned".into()
            } else {
                "already_clean".into()
            },
            message: if still_quarantined {
                errors.first().cloned().unwrap_or_else(|| "quarantine attribute still present".into())
            } else if had_quarantine {
                "quarantine flag removed".into()
            } else {
                "no quarantine attribute was present".into()
            },
            attributes_before: before,
            attributes_after: after,
            commands,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ------------------------------- Utility --------------------------------- */

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run("open", &["-R", &path]).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn app_data_dir() -> Result<String, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "no application support directory".to_string())?
        .join("com.shift.tools");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn sample_screen_pixel(x: i32, y: i32) -> Result<ColorSample, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::env::temp_dir().join("shift-tools-pixel.png");
        let region = format!("{x},{y},1,1");
        run("/usr/sbin/screencapture", &["-x", "-R", &region, "-t", "png", &dir.to_string_lossy()])?;
        let img = image::open(&dir).map_err(|e| format!("could not read capture: {e}"))?;
        let px = img.to_rgb8().get_pixel(0, 0).0;
        let _ = std::fs::remove_file(&dir);
        Ok::<_, String>(ColorSample {
            hex: format!("#{:02x}{:02x}{:02x}", px[0], px[1], px[2]),
            r: px[0],
            g: px[1],
            b: px[2],
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/* --------------------------- System settings ----------------------------- */

/// Deep-link into the exact Privacy & Security pane macOS uses for these
/// permissions. Ventura+ uses the new extension URL; older builds use the
/// legacy preference anchor, and the last resort is just opening Settings.
#[tauri::command]
pub async fn open_privacy_settings(pane: Option<String>) -> Result<(), String> {
    let key = pane.unwrap_or_else(|| "privacy".into());
    let anchor = match key.as_str() {
        "location" => "Privacy_LocationServices",
        "screen-recording" => "Privacy_ScreenCapture",
        "bluetooth" => "Privacy_Bluetooth",
        "microphone" => "Privacy_Microphone",
        _ => "",
    };

    let mut urls: Vec<String> = Vec::new();
    if anchor.is_empty() {
        urls.push("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension".into());
        urls.push("x-apple.systempreferences:com.apple.preference.security".into());
    } else {
        urls.push(format!(
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?{anchor}"
        ));
        urls.push(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"));
    }

    for url in urls {
        if std::process::Command::new("open").arg(&url).status().map(|s| s.success()).unwrap_or(false) {
            return Ok(());
        }
    }

    // Last resort: open the Settings app itself.
    std::process::Command::new("open")
        .args(["-b", "com.apple.systempreferences"])
        .status()
        .map_err(|e| format!("could not open System Settings: {e}"))?;
    Ok(())
}

/// Ask macOS for Location Services permission via CoreLocation.
///
/// Wi-Fi scan results (SSID/BSSID) are only returned to apps that hold this
/// permission. macOS adds the app to Privacy → Location Services the first time
/// it asks, which is exactly what the UI needs before the user can toggle it.
///
/// CoreLocation presents UI, so the call must happen on the main thread.
#[tauri::command]
pub async fn request_location_permission(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        let _ = tx.send(location_request_on_main_thread());
    })
    .map_err(|e| e.to_string())?;

    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("CoreLocation did not answer: {e}"))?
}

/// Must run on the main thread: creates CLLocationManager and asks for
/// when-in-use authorization. Returns the status observed *before* the request.
fn location_request_on_main_thread() -> Result<String, String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    unsafe {
        let path = std::ffi::CString::new(
            "/System/Library/Frameworks/CoreLocation.framework/CoreLocation",
        )
        .map_err(|e| e.to_string())?;
        let handle = libc::dlopen(path.as_ptr(), libc::RTLD_LAZY);
        if handle.is_null() {
            return Err("could not load CoreLocation".to_string());
        }

        let cls = AnyClass::get("CLLocationManager")
            .ok_or_else(|| "CoreLocation is not available on this system".to_string())?;

        let manager: *mut AnyObject = msg_send![cls, alloc];
        let manager: *mut AnyObject = msg_send![manager, init];
        if manager.is_null() {
            return Err("could not create a CLLocationManager".to_string());
        }

        let authorized: i32 = msg_send![manager, authorizationStatus];
        let _: () = msg_send![manager, requestWhenInUseAuthorization];
        // The +1 reference from `alloc` is intentionally never released: the
        // manager must outlive the request, and one leak per click is bounded.

        Ok(match authorized {
            0 => "notDetermined — macOS should now be prompting".to_string(),
            1 => "restricted".to_string(),
            2 => "denied".to_string(),
            3 => "authorizedWhenInUse".to_string(),
            4 => "authorizedAlways".to_string(),
            other => format!("unknown status {other}"),
        })
    }
}

#[cfg(test)]
mod location_tests {
    use super::*;

    #[tokio::test]
    async fn corelocation_request_returns_a_status() {
        let status = location_request_on_main_thread().expect("CoreLocation call should not fail");
        println!("location status: {status}");
        assert!(
            ["notDetermined", "denied", "restricted", "authorized"]
                .iter()
                .any(|s| status.contains(s)),
            "unexpected status: {status}"
        );
    }
}

#[cfg(test)]
mod process_tests {
    use super::*;

    #[tokio::test]
    async fn lists_every_process_and_flags_dev_ones() {
        let all = list_processes().await.expect("process list should load");
        let dev = all.iter().filter(|p| p.is_dev).count();
        let total_mem: u64 = all.iter().map(|p| p.memory_bytes).sum();
        println!(
            "processes: total={} dev={} other={} mem={} MB",
            all.len(),
            dev,
            all.len() - dev,
            total_mem / 1_048_576
        );
        println!(
            "top 3 by ram: {:?}",
            all.iter()
                .take(3)
                .map(|p| (p.name.clone(), p.memory_bytes / 1_048_576, p.is_dev))
                .collect::<Vec<_>>()
        );
        assert!(all.len() > 50, "should list the whole host");
        assert!(dev > 0, "dev tooling should be detected");
        assert!(all.iter().any(|p| p.is_dev) && all.iter().any(|p| !p.is_dev));
    }

    #[test]
    fn reports_host_gpu_utilisation() {
        let (util, render, mem) = gpu_usage();
        println!("gpu: util={util:?} renderer={render:?} alloc_mem={mem:?}");
        if let Some(value) = util {
            assert!(value <= 100.0, "utilisation is a percentage");
        }
    }
}

/* --------------------------- Universal disk scan -------------------------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    pub path: String,
    pub label: String,
    pub kind: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub writable: bool,
    pub root: String,
    /// True when the walk hit its time budget: the size is a lower bound.
    pub partial: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskScanProgress {
    pub phase: String,
    pub scanned: u64,
    pub total: u64,
    pub current: String,
    pub found: usize,
    pub done: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileScan {
    pub files: Vec<LargeFile>,
    /// True when the walk hit its time budget: the list is the top-N so far.
    pub timed_out: bool,
    pub scanned_entries: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LargeFile {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub modified: String,
    pub kind: String,
}

/// Measures a directory with a time budget so a single
/// pathological directory (a container with millions of entries, a stale
/// network mount) cannot stall the whole sweep. The third value says the walk
/// was cut short, so the UI can mark the size as a lower bound.
fn size_and_count_bounded(path: &std::path::Path, budget: std::time::Duration) -> (u64, u64, bool) {
    let deadline = std::time::Instant::now() + budget;
    let mut size = 0u64;
    let mut files = 0u64;
    let mut seen = 0u64;
    let mut partial = false;
    for entry in walkdir::WalkDir::new(path).follow_links(false).into_iter().flatten() {
        seen += 1;
        if seen % 256 == 0 && std::time::Instant::now() > deadline {
            partial = true;
            break;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                size += meta.len();
                files += 1;
            }
        }
    }
    (size, files, partial)
}

fn writable(path: &std::path::Path) -> bool {
    std::fs::metadata(path)
        .map(|m| !m.permissions().readonly())
        .unwrap_or(false)
}

/// Candidate cache directories for a set of scan roots. Only paths that exist
/// and look like a cache are returned; the cleaner re-validates before deleting.
fn collect_cache_dirs(roots: &[String]) -> Vec<(String, String, String)> {
    let home = crate::util::home();
    let mut out: Vec<(String, String, String)> = Vec::new();
    let mut push = |path: std::path::PathBuf, kind: &str, root: &str| {
        if path.is_dir() {
            out.push((path.to_string_lossy().to_string(), kind.to_string(), root.to_string()));
        }
    };

    let wants = |key: &str| roots.is_empty() || roots.iter().any(|r| r == key);

    if wants("user") {
        for base in [home.join("Library/Caches"), home.join(".cache")] {
            if let Ok(entries) = std::fs::read_dir(&base) {
                for entry in entries.flatten() {
                    push(entry.path(), "user-cache", "user");
                }
            }
        }
    }

    if wants("apps") {
        let containers = home.join("Library/Containers");
        if let Ok(entries) = std::fs::read_dir(&containers) {
            for entry in entries.flatten() {
                let cache = entry.path().join("Data/Library/Caches");
                push(cache, "app-container", "apps");
            }
        }
    }

    if wants("dev") {
        for path in [
            home.join(".npm/_cacache"),
            home.join(".gradle/caches"),
            home.join(".m2/repository"),
            home.join("Library/pnpm/store"),
            home.join(".cargo/registry/cache"),
            home.join(".cache/pip"),
            home.join("Library/Caches/Homebrew"),
            home.join("Library/Caches/go-build"),
        ] {
            push(path, "dev-cache", "dev");
        }
        if let Ok(entries) = std::fs::read_dir(home.join("Library/Developer/Xcode/DerivedData")) {
            for entry in entries.flatten() {
                push(entry.path(), "xcode", "dev");
            }
        }
    }

    if wants("system") {
        if let Ok(entries) = std::fs::read_dir("/Library/Caches") {
            for entry in entries.flatten() {
                push(entry.path(), "system-cache", "system");
            }
        }
    }

    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.dedup_by(|a, b| a.0 == b.0);
    out
}

#[tauri::command]
pub async fn scan_caches(app: tauri::AppHandle, roots: Vec<String>) -> Result<Vec<CacheEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::mpsc::{channel, RecvTimeoutError};
        use std::sync::{Arc, Mutex};
        use tauri::Emitter;

        let candidates = collect_cache_dirs(&roots);
        let total = candidates.len() as u64;
        if candidates.is_empty() {
            return Ok(Vec::new());
        }

        // Measuring cache directories is IO-bound, so a small thread pool cuts
        // the sweep by an order of magnitude. The threads are *detached* and
        // report over a channel: a single syscall that blocks (a TCC-protected
        // container, a stale network mount) used to hang the whole command,
        // because joining workers waits forever. Now the command returns what
        // arrived before the deadline and leaves the stuck worker behind.
        let workers = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(2, 12)
            .min(candidates.len());
        let queue = Arc::new(Mutex::new(candidates.into_iter()));
        let done = Arc::new(AtomicU64::new(0));
        let (tx, rx) = channel::<(CacheEntry, u64)>();

        for _ in 0..workers {
            let queue = Arc::clone(&queue);
            let done = Arc::clone(&done);
            let tx = tx.clone();
            std::thread::spawn(move || loop {
                let next = { queue.lock().ok().and_then(|mut q| q.next()) };
                let Some((path, kind, root)) = next else { break };
                let p = std::path::PathBuf::from(&path);
                let label = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.clone());
                let (size_bytes, file_count, partial) =
                    size_and_count_bounded(&p, std::time::Duration::from_millis(1200));
                let writable_flag = writable(&p);
                let scanned = done.fetch_add(1, Ordering::Relaxed) + 1;
                let entry = CacheEntry {
                    path,
                    label,
                    kind,
                    size_bytes,
                    file_count,
                    writable: writable_flag,
                    root,
                    partial,
                };
                if tx.send((entry, scanned)).is_err() {
                    break;
                }
            });
        }
        drop(tx);

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(45);
        let mut entries: Vec<CacheEntry> = Vec::with_capacity(total as usize);
        let mut last_emit = std::time::Instant::now();
        // If every worker but a wedged one has drained the queue, waiting for
        // the deadline just makes the user stare at a finished scan.
        let mut idle_since = std::time::Instant::now();
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(remaining.min(std::time::Duration::from_millis(250))) {
                Ok((entry, scanned)) => {
                    if last_emit.elapsed() > std::time::Duration::from_millis(150) || scanned == total {
                        let _ = app.emit(
                            "disk-scan-progress",
                            DiskScanProgress {
                                phase: "caches".into(),
                                scanned,
                                total,
                                current: entry.label.clone(),
                                found: entries.len(),
                                done: false,
                            },
                        );
                        last_emit = std::time::Instant::now();
                    }
                    entries.push(entry);
                    idle_since = std::time::Instant::now();
                }
                Err(RecvTimeoutError::Timeout) => {
                    if idle_since.elapsed() > std::time::Duration::from_secs(3) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }

        entries.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
        let _ = app.emit(
            "disk-scan-progress",
            DiskScanProgress {
                phase: "caches".into(),
                scanned: entries.len() as u64,
                total,
                current: String::new(),
                found: entries.len(),
                done: true,
            },
        );
        Ok::<_, String>(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A directory is a cache when its own name, or its parent's name, says so.
/// This is the second line of defence: even a path handed in by mistake (or by
/// a future caller) cannot point at Documents, Desktop or a project folder.
fn looks_like_cache(path: &std::path::Path) -> bool {
    const CACHE_NAMES: &[&str] = &[
        "caches",
        "cache",
        ".cache",
        "_cacache",
        "deriveddata",
        "cache2",
        "gpucache",
        "code cache",
        "cacheddata",
        "shadercache",
    ];
    let name_matches = |candidate: Option<&std::ffi::OsStr>| -> bool {
        candidate
            .map(|n| n.to_string_lossy().to_lowercase())
            .map(|n| CACHE_NAMES.contains(&n.as_str()) || n.ends_with("cache") || n.ends_with("caches"))
            .unwrap_or(false)
    };
    name_matches(path.file_name()) || name_matches(path.parent().and_then(|p| p.file_name()))
}

/// Deletion guard: only cache directories inside the user's home or
/// /Library/Caches, deep enough to be a real target, and never a container
/// path that is not a cache.
fn cleanable(path: &std::path::Path) -> Result<(), String> {
    let home = crate::util::home();
    let text = path.to_string_lossy().to_string();
    let inside_home = path.starts_with(&home);
    let inside_system_caches = text.starts_with("/Library/Caches/");
    if !inside_home && !inside_system_caches {
        return Err("outside the allowed roots".into());
    }
    if path == home.as_path() || path.components().count() < 4 {
        return Err("path is too close to a root directory".into());
    }
    if text.contains("/Library/Containers/") && !text.contains("/Data/Library/Caches") {
        return Err("container path is not a cache directory".into());
    }
    if !looks_like_cache(path) {
        return Err("directory name does not look like a cache".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn clean_cache_paths(paths: Vec<String>) -> Result<Vec<CleanReport>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut reports = Vec::new();
        for raw in paths {
            let p = std::path::PathBuf::from(&raw);
            let label = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| raw.clone());

            if !p.exists() {
                reports.push(CleanReport {
                    id: raw,
                    label,
                    freed_bytes: 0,
                    ok: true,
                    error: Some("already gone".into()),
                });
                continue;
            }
            if let Err(reason) = cleanable(&p) {
                reports.push(CleanReport {
                    id: raw,
                    label,
                    freed_bytes: 0,
                    ok: false,
                    error: Some(format!("refused: {reason}")),
                });
                continue;
            }

            let before = dir_size(&p);
            let mut error: Option<String> = None;
            match std::fs::read_dir(&p) {
                Ok(entries) => {
                    let mut denied = 0usize;
                    for entry in entries.flatten() {
                        let child = entry.path();
                        let result = if child.is_dir() {
                            std::fs::remove_dir_all(&child)
                        } else {
                            std::fs::remove_file(&child)
                        };
                        if let Err(e) = result {
                            denied += 1;
                            error = Some(format!("{}: {e}", child.display()));
                        }
                    }
                    if denied > 0 && error.is_none() {
                        error = Some(format!("{denied} items could not be removed"));
                    }
                }
                Err(e) => error = Some(e.to_string()),
            }

            let after = dir_size(&p);
            reports.push(CleanReport {
                id: raw,
                label,
                freed_bytes: before.saturating_sub(after),
                ok: error.is_none(),
                error,
            });
        }
        Ok::<_, String>(reports)
    })
    .await
    .map_err(|e| e.to_string())?
}

type FileHeap = std::collections::BinaryHeap<std::cmp::Reverse<(u64, std::path::PathBuf)>>;

/// Sorted view of what the heap holds right now, so callers can publish
/// partial results while the walk is still running.
fn snapshot_of(heap: &FileHeap) -> Vec<LargeFile> {
    let mut files: Vec<LargeFile> = heap
        .iter()
        .map(|std::cmp::Reverse((size, path))| describe_file(*size, path))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.size_bytes));
    files
}

fn describe_file(size: u64, path: &std::path::Path) -> LargeFile {
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default()
        })
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let kind = match extension.as_str() {
        "mp4" | "mov" | "mkv" | "avi" => "video",
        "zip" | "dmg" | "pkg" | "tar" | "gz" | "7z" | "rar" => "archive",
        "iso" | "img" => "disk image",
        "app" => "application",
        "dylib" | "so" | "a" => "binary",
        "log" => "log",
        "pdf" => "document",
        "jpg" | "png" | "heic" | "psd" | "tiff" => "image",
        "sqlite" | "db" => "database",
        _ => "file",
    }
    .to_string();
    LargeFile {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        size_bytes: size,
        modified,
        kind,
    }
}

/// Walk a root and keep the `limit` largest files, sorted descending.
/// `on_progress(scanned, current_path, kept)` is called periodically so the UI
/// can show liveness; the walk stops after `budget` and returns partial results.
fn walk_large_files(
    start_root: &std::path::Path,
    min_bytes: u64,
    limit: usize,
    budget: std::time::Duration,
    mut on_progress: impl FnMut(u64, &std::path::Path, usize, &[LargeFile]),
) -> Vec<LargeFile> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;

    let limit = limit.clamp(10, 500);
    let deadline = std::time::Instant::now() + budget;
    let mut heap: FileHeap = BinaryHeap::new();
    let mut seen = 0u64;

    // These trees either block on a TCC check (Containers, Group Containers),
    // hang while a cloud provider is offline (CloudStorage, Mobile Documents)
    // or belong to mounted volumes. Walking them is what made `~` scans stop
    // dead, so they are skipped by default and the UI says so.
    let home = crate::util::home();
    let skip: Vec<std::path::PathBuf> = vec![
        home.join("Library/CloudStorage"),
        home.join("Library/Mobile Documents"),
        home.join("Library/Containers"),
        home.join("Library/Group Containers"),
        std::path::PathBuf::from("/Volumes"),
        std::path::PathBuf::from("/System/Volumes"),
    ];
    // Rebuildable dependency trees: they hold hundreds of thousands of files,
    // they are never what someone means by "my biggest files", and walking
    // them is what makes a home scan crawl.
    const SKIP_DIRS: &[&str] = &[
        "node_modules",
        ".git",
        "target",
        "Pods",
        ".venv",
        "venv",
        "__pycache__",
        ".next",
        ".nuxt",
        ".turbo",
        ".parcel-cache",
        ".gradle",
        ".cargo",
        ".rustup",
        "DerivedData",
        // Logic/MainStage tag databases: thousands of tiny files that stall
        // directory reads for minutes on this machine. Not user documents.
        "Audio Music Apps",
    ];
    let walker = walkdir::WalkDir::new(start_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(move |e| {
            if !e.file_type().is_dir() {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if SKIP_DIRS.contains(&name.as_ref()) {
                return false;
            }
            !skip.iter().any(|s| e.path().starts_with(s))
        });

    for entry in walker.flatten() {
        seen += 1;
        if seen % 250 == 0 {
            let snapshot = snapshot_of(&heap);
            on_progress(seen, entry.path(), heap.len(), &snapshot);
            if std::time::Instant::now() > deadline {
                break;
            }
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let size = meta.len();
        if size < min_bytes {
            continue;
        }
        if heap.len() < limit {
            heap.push(Reverse((size, entry.path().to_path_buf())));
        } else if let Some(Reverse((smallest, _))) = heap.peek() {
            if size > *smallest {
                heap.pop();
                heap.push(Reverse((size, entry.path().to_path_buf())));
            }
        }
    }

    snapshot_of(&heap)
}

#[tauri::command]
pub async fn scan_large_files(
    app: tauri::AppHandle,
    root: String,
    min_bytes: u64,
    limit: usize,
) -> Result<LargeFileScan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{Arc, Mutex};
        use tauri::Emitter;

        let start_root = if root.trim().is_empty() {
            crate::util::home()
        } else {
            crate::util::expand_home(root.trim())
        };
        if !start_root.is_dir() {
            return Err(format!("{} is not a directory", start_root.display()));
        }

        // Each top-level folder is walked by its own thread. Some trees block
        // for minutes on a directory read (cloud providers, app databases,
        // TCC-protected containers) and a single blocked read used to kill the
        // whole scan. Now a wedged folder costs only that folder.
        let mut children: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&start_root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    children.push(entry.path());
                }
            }
        }

        let merged: Arc<Mutex<Vec<LargeFile>>> = Arc::new(Mutex::new(Vec::new()));
        let pending = Arc::new(AtomicUsize::new(children.len()));

        for child in children {
            let merged = Arc::clone(&merged);
            let pending = Arc::clone(&pending);
            let app = app.clone();
            std::thread::spawn(move || {
                let files = walk_large_files(
                    &child,
                    min_bytes,
                    limit,
                    std::time::Duration::from_secs(20),
                    |scanned, current, kept, _| {
                        let _ = app.emit(
                            "disk-scan-progress",
                            DiskScanProgress {
                                phase: "files".into(),
                                scanned,
                                total: 0,
                                current: current.to_string_lossy().to_string(),
                                found: kept,
                                done: false,
                            },
                        );
                    },
                );
                if let Ok(mut all) = merged.lock() {
                    all.extend(files);
                    all.sort_by_key(|f| std::cmp::Reverse(f.size_bytes));
                    all.truncate(limit.max(10));
                }
                pending.fetch_sub(1, Ordering::SeqCst);
            });
        }

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(40);
        while pending.load(Ordering::SeqCst) > 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        let timed_out = pending.load(Ordering::SeqCst) > 0;

        let mut files = merged.lock().map(|all| all.clone()).unwrap_or_default();
        files.sort_by_key(|f| std::cmp::Reverse(f.size_bytes));
        files.truncate(limit.max(10));

        let _ = app.emit(
            "disk-scan-progress",
            DiskScanProgress {
                phase: "files".into(),
                scanned: 0,
                total: 0,
                current: String::new(),
                found: files.len(),
                done: true,
            },
        );

        if files.is_empty() {
            return Err(if timed_out {
                "No file above the minimum size was found before the cutoff. Every folder under this path blocked; try a narrower one."
                    .to_string()
            } else {
                "Nothing above that size exists under this path.".to_string()
            });
        }

        Ok(LargeFileScan {
            files,
            timed_out,
            scanned_entries: 0,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Move files to the Trash instead of deleting them — recoverable by design.
#[tauri::command]
pub async fn trash_paths(paths: Vec<String>) -> Result<Vec<CleanReport>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let trash = crate::util::home().join(".Trash");
        let mut reports = Vec::new();
        for raw in paths {
            let p = std::path::PathBuf::from(&raw);
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| raw.clone());
            if !p.exists() {
                reports.push(CleanReport {
                    id: raw,
                    label: name,
                    freed_bytes: 0,
                    ok: false,
                    error: Some("file no longer exists".into()),
                });
                continue;
            }
            let size = p.metadata().map(|m| m.len()).unwrap_or(0);
            let mut target = trash.join(&name);
            let mut counter = 1;
            while target.exists() {
                target = trash.join(format!("{name}.{counter}"));
                counter += 1;
            }
            let result = std::fs::rename(&p, &target).or_else(|_| {
                std::fs::copy(&p, &target)
                    .and_then(|_| std::fs::remove_file(&p))
                    .map(|_| ())
            });
            reports.push(CleanReport {
                id: raw,
                label: name,
                freed_bytes: if result.is_ok() { size } else { 0 },
                ok: result.is_ok(),
                error: result.err().map(|e| e.to_string()),
            });
        }
        Ok::<_, String>(reports)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod disk_tests {
    use super::*;

    #[test]
    fn finds_user_caches_and_measures_them() {
        let dirs = collect_cache_dirs(&["user".into()]);
        println!("user cache dirs: {}", dirs.len());
        assert!(!dirs.is_empty(), "macOS always has ~/Library/Caches subdirectories");
        assert!(dirs.iter().all(|(p, _, _)| std::path::Path::new(p).is_dir()));

        // Measure a bounded, harmless sample: walking every container on a real
        // machine can block on a TCC-protected path for minutes, which is a
        // property of the filesystem, not of this code.
        let sample = dirs.iter().take(3);
        for (path, kind, root) in sample {
            assert_eq!(kind, "user-cache");
            assert_eq!(root, "user");
            let (size, files, partial) = size_and_count_bounded(
                std::path::Path::new(path),
                std::time::Duration::from_millis(120),
            );
            println!("  {path} -> {size} B in {files} files (partial={partial})");
        }
    }

    #[test]
    fn bounded_walk_counts_a_known_tree() {
        let dir = std::env::temp_dir().join(format!("shift-tools-bounded-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.bin"), vec![0u8; 1024]).unwrap();
        std::fs::write(dir.join("b.bin"), vec![0u8; 2048]).unwrap();
        let (size, files, partial) = size_and_count_bounded(&dir, std::time::Duration::from_secs(5));
        assert_eq!(size, 3072);
        assert_eq!(files, 2);
        assert!(!partial);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_dangerous_delete_targets() {
        let home = crate::util::home();
        assert!(cleanable(&home).is_err(), "home root must be refused");
        assert!(cleanable(std::path::Path::new("/etc")).is_err(), "outside roots must be refused");
        assert!(
            cleanable(&home.join("Documents")).is_err(),
            "a normal document folder is not a cache"
        );
        let caches = home.join("Library/Caches/com.apple.Safari");
        println!("safari cache allowed: {}", cleanable(&caches).is_ok());
    }

    #[test]
    fn collects_dev_cache_roots() {
        let dirs = collect_cache_dirs(&["dev".into()]);
        println!("dev cache dirs: {:?}", dirs.iter().map(|d| d.1.clone()).collect::<Vec<_>>());
        assert!(dirs.iter().all(|(_, kind, _)| kind == "dev-cache" || kind == "xcode"));
    }
}
#[cfg(test)]
mod large_file_tests {
    use super::*;

    #[test]
    fn walks_a_temporary_tree_and_ranks_it() {
        let root = std::env::temp_dir().join(format!("shift-tools-scan-{}", std::process::id()));
        std::fs::create_dir_all(root.join("nested")).unwrap();
        std::fs::write(root.join("small.txt"), vec![0u8; 1024]).unwrap();
        std::fs::write(root.join("nested/big.bin"), vec![0u8; 5 * 1024 * 1024]).unwrap();
        std::fs::write(root.join("nested/mid.zip"), vec![0u8; 2 * 1024 * 1024]).unwrap();

        let files = walk_large_files(
            &root,
            1024 * 1024,
            10,
            std::time::Duration::from_secs(5),
            |_, _, _, _| {},
        );
        println!(
            "temp scan: {:?}",
            files.iter().map(|f| (f.name.clone(), f.size_bytes, f.kind.clone())).collect::<Vec<_>>()
        );
        assert_eq!(files.len(), 2, "only files above 1 MB are reported");
        assert_eq!(files[0].name, "big.bin");
        assert_eq!(files[0].size_bytes, 5 * 1024 * 1024);
        assert_eq!(files[0].kind, "file");
        assert_eq!(files[1].kind, "archive");
        std::fs::remove_dir_all(&root).ok();
    }

    /// Diagnostic, not part of CI: `cargo test --lib -- --ignored --nocapture bench_home_fanout`
    /// prints where a home scan spends its time and which folders block.
    #[test]
    #[ignore]
    fn bench_home_fanout() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{Arc, Mutex};

        let home = crate::util::home();
        let children: Vec<_> = std::fs::read_dir(&home)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        println!("children: {}", children.len());
        let merged: Arc<Mutex<Vec<LargeFile>>> = Arc::new(Mutex::new(Vec::new()));
        let pending = Arc::new(AtomicUsize::new(children.len()));
        let started = std::time::Instant::now();

        for child in children {
            let merged = Arc::clone(&merged);
            let pending = Arc::clone(&pending);
            let name = child.file_name().unwrap().to_string_lossy().to_string();
            std::thread::spawn(move || {
                let t = std::time::Instant::now();
                let files = walk_large_files(
                    &child,
                    100 * 1024 * 1024,
                    20,
                    std::time::Duration::from_secs(20),
                    |_, _, _, _| {},
                );
                println!("  {name:>28} -> {} files in {:?}", files.len(), t.elapsed());
                if let Ok(mut all) = merged.lock() {
                    all.extend(files);
                    all.sort_by_key(|f| std::cmp::Reverse(f.size_bytes));
                    all.truncate(20);
                }
                pending.fetch_sub(1, Ordering::SeqCst);
            });
        }

        while pending.load(Ordering::SeqCst) > 0 && started.elapsed() < std::time::Duration::from_secs(40) {
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        println!("blocked after {:?}: {}", started.elapsed(), pending.load(Ordering::SeqCst));
        for f in merged.lock().unwrap().iter().take(6) {
            println!("  TOP {} = {} MB", f.name, f.size_bytes / 1_048_576);
        }
    }
}
