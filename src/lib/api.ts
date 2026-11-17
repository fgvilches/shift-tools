import { cmd, onEvent } from "./ipc";
import type {
  ApiRequestSpec,
  ApiResponseData,
  BluetoothDevice,
  BundleInspection,
  CacheEntry,
  CleanReport,
  DiskTarget,
  DiskScanProgress,
  DnsAnswer,
  HashResult,
  HeaderAnalysis,
  KillResult,
  LanScanProgress,
  LargeFile,
  MapSummary,
  PasswordStrength,
  PingSample,
  PortInfo,
  ProcessInfo,
  PwnedResult,
  QuarantineResult,
  RamSnapshot,
  SpeedSample,
  SpeedTestResult,
  SubdomainFinding,
  SystemStats,
  TlsInfo,
  TracerouteHop,
  WifiMapDoc,
  WifiScanResult,
} from "./types";

/* --------------------------------- System -------------------------------- */

export const system = {
  processes: () => cmd<ProcessInfo[]>("list_processes"),
  kill: (pids: number[], force = false) => cmd<KillResult[]>("kill_processes", { pids, force }),
  stats: () => cmd<SystemStats>("system_stats"),
  ram: () => cmd<RamSnapshot>("ram_snapshot"),
  ports: () => cmd<PortInfo[]>("list_ports"),
  killPort: (port: number, protocol: string, force = false) =>
    cmd<KillResult[]>("kill_port", { port, protocol, force }),
  diskTargets: () => cmd<DiskTarget[]>("disk_targets"),
  cleanDisk: (ids: string[]) => cmd<CleanReport[]>("clean_disk", { ids }),
  scanCaches: (roots: string[]) => cmd<CacheEntry[]>("scan_caches", { roots }),
  onDiskScan: (handler: (p: DiskScanProgress) => void) => onEvent<DiskScanProgress>("disk-scan-progress", handler),
  cleanCachePaths: (paths: string[]) => cmd<CleanReport[]>("clean_cache_paths", { paths }),
  scanLargeFiles: (root: string, minBytes: number, limit: number) =>
    cmd<LargeFile[]>("scan_large_files", { root, minBytes, limit }),
  trashPaths: (paths: string[]) => cmd<CleanReport[]>("trash_paths", { paths }),
  inspectBundle: (path: string) => cmd<BundleInspection>("inspect_bundle", { path }),
  clearQuarantine: (path: string, recursive = true) =>
    cmd<QuarantineResult>("clear_quarantine", { path, recursive }),
};

/* -------------------------------- Network -------------------------------- */

export const network = {
  wifiScan: () => cmd<WifiScanResult>("wifi_scan"),
  bluetooth: () => cmd<BluetoothDevice[]>("bluetooth_devices"),
  lanScan: (cidr: string, ports: number[]) => cmd<string>("start_lan_scan", { cidr, ports }),
  onLanProgress: (handler: (p: LanScanProgress) => void) => onEvent<LanScanProgress>("lan-scan-progress", handler),
  dns: (domain: string, recordType: string, resolver: string | null) =>
    cmd<DnsAnswer>("dns_query", { domain, recordType, resolver }),
  ping: (host: string, count: number) => cmd<string>("start_ping", { host, count }),
  onPing: (handler: (s: PingSample) => void) => onEvent<PingSample>("ping-sample", handler),
  traceroute: (host: string, maxHops: number) => cmd<TracerouteHop[]>("traceroute", { host, maxHops }),
  speedTest: () => cmd<SpeedTestResult>("start_speed_test"),
  onSpeed: (handler: (s: SpeedSample) => void) => onEvent<SpeedSample>("speed-sample", handler),
  subdomains: (domain: string) => cmd<SubdomainFinding[]>("find_subdomains", { domain }),
  maps: () => cmd<MapSummary[]>("list_maps"),
  loadMap: (id: string) => cmd<WifiMapDoc>("load_map", { id }),
  saveMap: (doc: WifiMapDoc) => cmd<MapSummary>("save_map", { doc }),
  deleteMap: (id: string) => cmd<void>("delete_map", { id }),
};

/* -------------------------------- Security ------------------------------- */

export const security = {
  headers: (url: string, followRedirects = true) =>
    cmd<HeaderAnalysis>("analyze_headers", { url, followRedirects }),
  tls: (domain: string, port = 443) => cmd<TlsInfo>("inspect_tls", { domain, port }),
  hashText: (text: string, algorithms: string[]) => cmd<HashResult[]>("hash_text", { text, algorithms }),
  hashFile: (path: string, algorithms: string[]) => cmd<HashResult[]>("hash_file", { path, algorithms }),
  password: (password: string) => cmd<PasswordStrength>("password_strength", { password }),
  generatePassword: (length: number, symbols: boolean, numbers: boolean, uppercase: boolean) =>
    cmd<string>("generate_password", { length, symbols, numbers, uppercase }),
  pwned: (password: string) => cmd<PwnedResult>("check_pwned", { password }),
};

/* --------------------------------- Testing ------------------------------- */

export const testing = {
  send: (spec: ApiRequestSpec) => cmd<ApiResponseData>("send_http_request", { spec }),
};

/* -------------------------------- Utilities ------------------------------ */

export const util = {
  samplePixel: (x: number, y: number) => cmd<{ hex: string; r: number; g: number; b: number }>("sample_screen_pixel", { x, y }),
  reveal: (path: string) => cmd<void>("reveal_in_finder", { path }),
  appDataDir: () => cmd<string>("app_data_dir"),
  requestLocationPermission: () => cmd<string>("request_location_permission"),
  openPrivacySettings: (pane: "location" | "screen-recording" | "bluetooth" | "microphone" | "privacy" = "privacy") =>
    cmd<void>("open_privacy_settings", { pane }),
};
