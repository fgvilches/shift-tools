import { lazy } from "react";
import type { LazyExoticComponent, ComponentType } from "react";
import {
  Binary,
  Braces,
  CalendarClock,
  Clock,
  Cpu,
  FileText,
  Fingerprint,
  FlaskConical,
  Gauge,
  GitCompare,
  Globe2,
  HardDrive,
  Hash,
  KeyRound,
  Lock,
  Map as MapIcon,
  MemoryStick,
  Network,
  Pipette,
  Plug,
  Radar,
  Radio,
  Regex,
  Route,
  ScrollText,
  Send,
  ShieldCheck,
  ShieldOff,
  Skull,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type CategoryId = "devops" | "networks" | "security" | "testing" | "utilities";

export interface Category {
  id: CategoryId;
  label: string;
  icon: LucideIcon;
}

export const CATEGORIES: Category[] = [
  { id: "devops", label: "DevOps & System", icon: Cpu },
  { id: "networks", label: "Networks", icon: Radio },
  { id: "security", label: "Security & Pentest", icon: ShieldCheck },
  { id: "testing", label: "Testing & APIs", icon: FlaskConical },
  { id: "utilities", label: "Utilities", icon: Wrench },
];

export interface ToolMeta {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  icon: LucideIcon;
  keywords: string[];
  component: LazyExoticComponent<ComponentType>;
}

const view = (loader: () => Promise<{ default: ComponentType }>) => lazy(loader);

export const TOOLS: ToolMeta[] = [
  /* ------------------------------ DevOps ------------------------------ */
  {
    id: "process-killer",
    title: "Process Killer",
    description:
      "Detect and terminate orphaned development runtimes, compilers, and zombie servers to reclaim host RAM instantly.",
    category: "devops",
    icon: Skull,
    keywords: ["kill", "process", "ram", "memory", "zombie", "pid", "sigterm"],
    component: view(() => import("@/tools/process-killer")),
  },
  {
    id: "quarantine-remover",
    title: "Quarantine Remover",
    description: "Strip com.apple.quarantine and extended attributes from apps, disk images, and installers.",
    category: "devops",
    icon: ShieldOff,
    keywords: ["xattr", "quarantine", "gatekeeper", "app", "dmg", "pkg"],
    component: view(() => import("@/tools/quarantine-remover")),
  },
  {
    id: "port-manager",
    title: "Port Manager",
    description: "See every listening and established socket, who owns it, and reclaim a port in one click.",
    category: "devops",
    icon: Plug,
    keywords: ["port", "socket", "lsof", "listen", "tcp", "udp", "eaddrinuse"],
    component: view(() => import("@/tools/port-manager")),
  },
  {
    id: "disk-cleaner",
    title: "Disk Cleaner",
    description: "Reclaim gigabytes from Xcode DerivedData, package manager caches, and container images.",
    category: "devops",
    icon: HardDrive,
    keywords: ["disk", "cache", "deriveddata", "npm", "pip", "cargo", "docker", "space"],
    component: view(() => import("@/tools/disk-cleaner")),
  },
  {
    id: "ram-monitor",
    title: "RAM Monitor",
    description: "Live pressure, wired and compressed memory, and the processes actually holding your RAM.",
    category: "devops",
    icon: MemoryStick,
    keywords: ["ram", "memory", "pressure", "swap", "wired", "compressed"],
    component: view(() => import("@/tools/ram-monitor")),
  },

  /* ----------------------------- Networks ----------------------------- */
  {
    id: "network-observer",
    title: "Network Observer",
    description: "Passive survey of nearby Wi-Fi access points and Bluetooth devices with vendor and channel analysis.",
    category: "networks",
    icon: Radar,
    keywords: ["wifi", "ble", "bluetooth", "ssid", "rssi", "channel", "scan", "vendor"],
    component: view(() => import("@/tools/network-observer")),
  },
  {
    id: "wifi-mapper",
    title: "WiFi Mapper",
    description: "Draw a floor plan, capture signal at each measurement point, and generate a coverage report.",
    category: "networks",
    icon: MapIcon,
    keywords: ["wifi", "heatmap", "floorplan", "canvas", "rssi", "coverage", "report"],
    component: view(() => import("@/tools/wifi-mapper")),
  },
  {
    id: "lan-scanner",
    title: "LAN Scanner",
    description: "Discover hosts on the local subnet with ARP, reverse DNS, vendor lookup, and TCP port probing.",
    category: "networks",
    icon: Network,
    keywords: ["lan", "scan", "arp", "subnet", "cidr", "host", "discovery"],
    component: view(() => import("@/tools/lan-scanner")),
  },
  {
    id: "dns-toolkit",
    title: "DNS Toolkit",
    description: "Query A, AAAA, MX, TXT, NS, and CNAME records and compare answers across resolvers.",
    category: "networks",
    icon: Globe2,
    keywords: ["dns", "resolver", "a", "aaaa", "mx", "txt", "propagation", "cname"],
    component: view(() => import("@/tools/dns-toolkit")),
  },
  {
    id: "speed-test",
    title: "Speed Test",
    description: "Measure download throughput and latency with a real transfer, sampled live as it runs.",
    category: "networks",
    icon: Gauge,
    keywords: ["speed", "throughput", "bandwidth", "mbps", "latency", "iperf"],
    component: view(() => import("@/tools/speed-test")),
  },
  {
    id: "ping-traceroute",
    title: "Ping / Traceroute",
    description: "Live latency samples and the actual path packets take to a host.",
    category: "networks",
    icon: Route,
    keywords: ["ping", "traceroute", "latency", "rtt", "hop", "route", "icmp"],
    component: view(() => import("@/tools/ping-traceroute")),
  },

  /* ----------------------------- Security ----------------------------- */
  {
    id: "header-analyzer",
    title: "Header Analyzer",
    description: "Grade HTTP security headers, CSP, CORS, and cookie flags with concrete recommendations.",
    category: "security",
    icon: ScrollText,
    keywords: ["headers", "http", "csp", "hsts", "cors", "cookies", "security", "grade"],
    component: view(() => import("@/tools/header-analyzer")),
  },
  {
    id: "ssl-inspector",
    title: "SSL Inspector",
    description: "Inspect a live TLS certificate: chain, validity, SANs, cipher suite, and expiry alerts.",
    category: "security",
    icon: Lock,
    keywords: ["ssl", "tls", "certificate", "x509", "expiry", "cipher", "chain"],
    component: view(() => import("@/tools/ssl-inspector")),
  },
  {
    id: "subdomain-finder",
    title: "Subdomain Finder",
    description: "Enumerate subdomains through crt.sh certificate transparency data and DNS resolution.",
    category: "security",
    icon: Waypoints,
    keywords: ["subdomain", "enumeration", "crtsh", "certificate transparency", "recon"],
    component: view(() => import("@/tools/subdomain-finder")),
  },
  {
    id: "hash-generator",
    title: "Hash Generator",
    description: "Compute and verify MD5, SHA-1, SHA-256, SHA-512, and BLAKE3 digests for text or files.",
    category: "security",
    icon: Fingerprint,
    keywords: ["hash", "md5", "sha256", "sha512", "digest", "checksum", "blake3"],
    component: view(() => import("@/tools/hash-generator")),
  },
  {
    id: "password-auditor",
    title: "Password Auditor",
    description: "Generate strong passwords, measure entropy and crack time, and check breach exposure privately.",
    category: "security",
    icon: KeyRound,
    keywords: ["password", "entropy", "strength", "pwned", "generator", "breach"],
    component: view(() => import("@/tools/password-auditor")),
  },

  /* ----------------------------- Testing ------------------------------ */
  {
    id: "api-tester",
    title: "API Tester",
    description: "Compose HTTP requests with headers, auth, and body, then inspect status, timing, and payload.",
    category: "testing",
    icon: Send,
    keywords: ["api", "http", "rest", "request", "postman", "bearer", "json", "response"],
    component: view(() => import("@/tools/api-tester")),
  },
  {
    id: "json-toolkit",
    title: "JSON Toolkit",
    description: "Format, minify, validate, convert, query, and diff JSON — all local, all instant.",
    category: "testing",
    icon: Braces,
    keywords: ["json", "format", "minify", "validate", "yaml", "csv", "diff", "jmespath"],
    component: view(() => import("@/tools/json-toolkit")),
  },
  {
    id: "base64-url-encoder",
    title: "Base64 / URL Encoder",
    description: "Encode and decode Base64, URL components, HTML entities, and JWT payloads.",
    category: "testing",
    icon: Binary,
    keywords: ["base64", "url", "encode", "decode", "jwt", "html entities", "percent"],
    component: view(() => import("@/tools/base64-url-encoder")),
  },
  {
    id: "regex-tester",
    title: "Regex Tester",
    description: "Test patterns against sample text with live match highlighting and captured group inspection.",
    category: "testing",
    icon: Regex,
    keywords: ["regex", "pattern", "match", "groups", "capture", "flags"],
    component: view(() => import("@/tools/regex-tester")),
  },

  /* ---------------------------- Utilities ----------------------------- */
  {
    id: "color-picker",
    title: "Color Picker",
    description: "Sample any pixel on screen and convert between HEX, RGB, HSL, and OKLCH.",
    category: "utilities",
    icon: Pipette,
    keywords: ["color", "picker", "hex", "rgb", "hsl", "oklch", "eyedropper"],
    component: view(() => import("@/tools/color-picker")),
  },
  {
    id: "text-diff",
    title: "Text Diff",
    description: "Compare two blocks of text line by line with word-level highlights.",
    category: "utilities",
    icon: GitCompare,
    keywords: ["diff", "compare", "text", "patch", "changes"],
    component: view(() => import("@/tools/text-diff")),
  },
  {
    id: "timestamp-converter",
    title: "Timestamp Converter",
    description: "Translate between Unix epoch, ISO 8601, and human-readable local time across zones.",
    category: "utilities",
    icon: Clock,
    keywords: ["timestamp", "unix", "epoch", "iso", "date", "timezone"],
    component: view(() => import("@/tools/timestamp-converter")),
  },
  {
    id: "markdown-preview",
    title: "Markdown Preview",
    description: "Write Markdown on the left, read rendered output on the right, export to HTML.",
    category: "utilities",
    icon: FileText,
    keywords: ["markdown", "preview", "render", "html", "gfm"],
    component: view(() => import("@/tools/markdown-preview")),
  },
  {
    id: "cron-validator",
    title: "Cron Validator",
    description: "Validate cron expressions, explain each field, and project the next scheduled runs.",
    category: "utilities",
    icon: CalendarClock,
    keywords: ["cron", "schedule", "crontab", "expression", "next run"],
    component: view(() => import("@/tools/cron-validator")),
  },
  {
    id: "uuid-generator",
    title: "UUID Generator",
    description: "Generate UUID v4, ULID, and NanoID identifiers in bulk with the right formatting.",
    category: "utilities",
    icon: Hash,
    keywords: ["uuid", "guid", "ulid", "nanoid", "id", "generator"],
    component: view(() => import("@/tools/uuid-generator")),
  },
];

export const TOOL_MAP = new Map<string, ToolMeta>(TOOLS.map((t) => [t.id, t] as [string, ToolMeta]));

export function toolsByCategory(category: CategoryId): ToolMeta[] {
  return TOOLS.filter((t) => t.category === category);
}

export function findTool(id: string): ToolMeta | undefined {
  return TOOL_MAP.get(id);
}

/** Fuzzy-ish search used by the command palette. */
export function searchTools(query: string): ToolMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOOLS;
  const scored = TOOLS.map((tool) => {
    const haystack = `${tool.title} ${tool.id} ${tool.keywords.join(" ")} ${tool.description}`.toLowerCase();
    const title = tool.title.toLowerCase();
    let score = 0;
    if (title.startsWith(q)) score += 100;
    if (title.includes(q)) score += 60;
    if (tool.keywords.some((k) => k.includes(q))) score += 30;
    if (haystack.includes(q)) score += 10;
    return { tool, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.tool);
}
