/**
 * Domain types for shift-tools.
 * Every type here mirrors a `#[derive(Serialize)]` struct in src-tauri/src.
 * Single source of truth for the frontend: do not redeclare these in views.
 */

/* ------------------------------- System ------------------------------- */

export type ProcessCategory =
  | "python"
  | "node"
  | "rust"
  | "java"
  | "swift"
  | "go"
  | "ruby"
  | "build"
  | "server"
  | "mobile"
  | "container"
  | "other";

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  exe: string | null;
  category: ProcessCategory;
  memoryBytes: number;
  cpuPercent: number;
  runTimeSecs: number;
  user: string;
  /** Process belongs to a visible GUI app (kill needs explicit confirmation). */
  isGuiApp: boolean;
  /** Matched the development-tooling heuristics. */
  isDev: boolean;
  /** Protected system process — never killable from the app. */
  protected: boolean;
  startTime: number | null;
}

export interface KillResult {
  pid: number;
  name: string;
  ok: boolean;
  signal: string;
  error: string | null;
}

export interface SystemStats {
  hostName: string;
  osVersion: string;
  arch: string;
  cpuBrand: string;
  cpuCores: number;
  cpuUsagePercent: number;
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  availableMemoryBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  /** Host-wide GPU utilisation (IOAccelerator). Per-process GPU is not public API. */
  gpuPercent: number | null;
  gpuRendererPercent: number | null;
  gpuMemoryBytes: number | null;
  uptimeSecs: number;
  loadAvg: [number, number, number];
  devProcessCount: number;
  devMemoryBytes: number;
}

export interface PortInfo {
  port: number;
  protocol: "tcp" | "udp";
  state: string;
  localAddr: string;
  remoteAddr: string;
  pid: number | null;
  process: string;
  user: string;
  family: "ipv4" | "ipv6";
}

export interface DiskTarget {
  id: string;
  label: string;
  path: string;
  kind: string;
  sizeBytes: number;
  exists: boolean;
  /** Human hint, e.g. "DerivedData for Xcode 16.2". */
  detail: string;
}

export interface CacheEntry {
  path: string;
  label: string;
  kind: string;
  sizeBytes: number;
  fileCount: number;
  writable: boolean;
  root: string;
  /** The walk hit its time budget; the size is a lower bound. */
  partial?: boolean;
}

export interface DiskScanProgress {
  phase: "caches" | "files";
  scanned: number;
  total: number;
  current: string;
  found: number;
  done: boolean;
}

export interface LargeFileScan {
  files: LargeFile[];
  /** The walk hit its time budget: the list is the top-N so far. */
  timedOut: boolean;
  scannedEntries: number;
}

export interface LargeFile {
  path: string;
  name: string;
  sizeBytes: number;
  modified: string;
  kind: string;
}

export interface CleanReport {
  id: string;
  label: string;
  freedBytes: number;
  ok: boolean;
  error: string | null;
}

export interface RamProcess {
  pid: number;
  name: string;
  memoryBytes: number;
  cpuPercent: number;
  category: ProcessCategory;
}

export interface RamSnapshot {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  wiredBytes: number;
  compressedBytes: number;
  cachedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  pressure: "normal" | "warning" | "critical";
  processes: RamProcess[];
  takenAt: string;
}

export interface BundleInspection {
  path: string;
  exists: boolean;
  kind: string;
  isApp: boolean;
  hasQuarantine: boolean;
  attributes: string[];
  sizeBytes: number;
}

export interface QuarantineResult {
  path: string;
  status: "cleaned" | "already_clean" | "error";
  message: string;
  attributesBefore: string[];
  attributesAfter: string[];
  commands: string[];
}

/* ------------------------------- Network ------------------------------ */

export interface WifiAp {
  ssid: string | null;
  bssid: string | null;
  rssi: number | null;
  noise: number | null;
  snr: number | null;
  channel: number | null;
  band: string | null;
  widthMhz: number | null;
  phyMode: string | null;
  security: string | null;
  vendor: string | null;
  hidden: boolean;
}

export interface WifiScanResult {
  aps: WifiAp[];
  scannedAt: string;
  interface: string;
  /** macOS redacts SSIDs without Location permission. */
  redacted: boolean;
  source: string;
}

export interface BluetoothDevice {
  name: string | null;
  address: string | null;
  rssi: number | null;
  connected: boolean;
  kind: string | null;
  vendor: string | null;
}

export interface LanPort {
  port: number;
  service: string;
}

export interface LanHost {
  ip: string;
  hostname: string | null;
  mac: string | null;
  vendor: string | null;
  openPorts: LanPort[];
  latencyMs: number | null;
  alive: boolean;
}

export interface LanScanProgress {
  scanned: number;
  total: number;
  hosts: LanHost[];
  done: boolean;
  error: string | null;
}

export interface DnsRecord {
  recordType: string;
  value: string;
  ttl: number | null;
}

export interface DnsAnswer {
  resolver: string;
  domain: string;
  recordType: string;
  records: DnsRecord[];
  durationMs: number;
  error: string | null;
}

export interface PingSample {
  seq: number;
  rttMs: number | null;
  ttl: number | null;
  error: string | null;
}

export interface TracerouteHop {
  hop: number;
  host: string | null;
  ip: string | null;
  rttMs: number[];
}

export interface SpeedSample {
  mbps: number;
  bytes: number;
  elapsedMs: number;
}

export interface SpeedTestResult {
  downloadMbps: number;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  server: string;
  bytesTransferred: number;
  durationMs: number;
}

export interface SubdomainFinding {
  host: string;
  source: "dns" | "crtsh";
  ips: string[];
}

export interface WifiMapDoc {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  shapes: MapShape[];
  points: MapPoint[];
  createdAt: string;
  updatedAt: string;
}

export interface MapShape {
  id: string;
  kind: "line" | "rect" | "circle" | "text";
  points: { x: number; y: number }[];
  label: string | null;
  color: string | null;
}

export interface MapPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  createdAt: string;
  scans: MapScan[];
}

export interface MapScan {
  ssid: string | null;
  bssid: string | null;
  rssi: number;
  channel: number | null;
  band: string | null;
  security: string | null;
  noise: number | null;
  timestamp: string;
}

export interface MapSummary {
  id: string;
  name: string;
  description: string;
  pointCount: number;
  updatedAt: string;
}

/* ------------------------------- Testing ------------------------------ */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type BodyKind = "none" | "json" | "text" | "form" | "urlencoded";

export type AuthKind = "none" | "basic" | "bearer" | "apiKey";

export interface HttpAuth {
  kind: AuthKind;
  username: string | null;
  password: string | null;
  token: string | null;
  headerName: string | null;
  inQuery: boolean;
}

export interface ApiRequestSpec {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  body: string | null;
  bodyKind: BodyKind;
  auth: HttpAuth;
  timeoutMs: number;
  followRedirects: boolean;
  insecure: boolean;
}

export interface ApiResponseData {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  bodyBytes: number;
  durationMs: number;
  redirected: boolean;
  finalUrl: string;
  contentType: string | null;
  truncated: boolean;
}

export interface ApiHistoryEntry {
  id: string;
  name: string;
  spec: ApiRequestSpec;
  createdAt: string;
  lastStatus: number | null;
}

/* ------------------------------ Security ------------------------------ */

export type FindingStatus = "pass" | "warn" | "fail" | "info";

export interface HeaderFinding {
  name: string;
  value: string | null;
  status: FindingStatus;
  weight: number;
  recommendation: string;
  group: string;
}

export interface CookieFinding {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  issues: string[];
}

export interface HeaderAnalysis {
  url: string;
  finalUrl: string;
  status: number;
  grade: string;
  score: number;
  findings: HeaderFinding[];
  rawHeaders: [string, string][];
  cookies: CookieFinding[];
  fetchedAt: string;
  durationMs: number;
}

export interface CertNode {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  selfSigned: boolean;
}

export interface TlsInfo {
  domain: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  sans: string[];
  serial: string;
  fingerprintSha256: string;
  tlsVersion: string;
  cipherSuite: string;
  keyBits: number | null;
  signatureAlgorithm: string | null;
  chain: CertNode[];
  alerts: string[];
  grade: string;
}

export interface HashResult {
  algorithm: string;
  value: string;
}

export interface PasswordStrength {
  score: number;
  entropyBits: number;
  label: string;
  crackTime: string;
  issues: string[];
  suggestions: string[];
}

export interface PwnedResult {
  count: number;
  breached: boolean;
  error: string | null;
}

export interface ColorSample {
  hex: string;
  r: number;
  g: number;
  b: number;
}

export interface AppVersion {
  version: string;
  platform: string;
  arch: string;
}

export interface UpdateCheck {
  available: boolean;
  version?: string;
  currentVersion?: string;
  notes?: string | null;
  date?: string | null;
  error?: string;
}

export interface UpdateInstallResult {
  installed: boolean;
  version?: string;
  reason?: string;
}

export interface UpdateProgress {
  chunk: number;
  total: number | null;
}
