import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { CookieFinding, FindingStatus, HeaderAnalysis, HeaderFinding } from "@/lib/types";

/** Canonical group order used by the backend, plus a fallback for new groups. */
export const GROUP_ORDER = [
  "Transport",
  "Injection",
  "Clickjacking",
  "Sniffing",
  "Privacy",
  "Isolation",
  "CORS",
  "Disclosure",
] as const;

export const GROUP_HINT: Record<string, string> = {
  Transport: "HSTS / downgrade defense",
  Injection: "CSP / script & object sources",
  Clickjacking: "Frame embedding",
  Sniffing: "MIME type sniffing",
  Privacy: "Referrer + permissions",
  Isolation: "Cross-origin isolation",
  CORS: "Cross-origin access",
  Disclosure: "Server banners",
};

export type StatusTone = "success" | "warning" | "error" | "primary";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  Icon: LucideIcon;
  text: string;
  dot: string;
  report: string;
}

export const STATUS_META: Record<FindingStatus, StatusMeta> = {
  pass: {
    label: "Pass",
    tone: "success",
    Icon: CheckCircle2,
    text: "text-secondary",
    dot: "bg-secondary",
    report: "PASS",
  },
  warn: {
    label: "Warning",
    tone: "warning",
    Icon: AlertTriangle,
    text: "text-warning",
    dot: "bg-warning",
    report: "WARN",
  },
  fail: {
    label: "Missing",
    tone: "error",
    Icon: XCircle,
    text: "text-error",
    dot: "bg-error",
    report: "FAIL",
  },
  info: {
    label: "Info",
    tone: "primary",
    Icon: Info,
    text: "text-primary-soft",
    dot: "bg-primary",
    report: "INFO",
  },
};

export function statusMeta(status: FindingStatus): StatusMeta {
  return STATUS_META[status];
}

export type GradeTone = "success" | "warning" | "error" | "neutral";

export function gradeTone(grade: string): GradeTone {
  const first = grade.trim().charAt(0).toUpperCase();
  if (first === "A" || first === "B") return "success";
  if (first === "C") return "warning";
  if (first === "D" || first === "E" || first === "F") return "error";
  return "neutral";
}

export function gradeDescriptor(score: number): string {
  if (score >= 90) return "High hardening";
  if (score >= 80) return "Solid posture";
  if (score >= 70) return "Moderate gaps";
  if (score >= 55) return "Weak posture";
  return "Critical exposure";
}

export interface FindingSummary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  info: number;
  weightAtRisk: number;
  weightTotal: number;
}

export function summarize(findings: HeaderFinding[]): FindingSummary {
  const summary: FindingSummary = {
    total: findings.length,
    pass: 0,
    warn: 0,
    fail: 0,
    info: 0,
    weightAtRisk: 0,
    weightTotal: 0,
  };
  for (const finding of findings) {
    summary[finding.status] += 1;
    summary.weightTotal += finding.weight;
    if (finding.status === "warn" || finding.status === "fail") summary.weightAtRisk += finding.weight;
  }
  return summary;
}

export interface FindingGroup {
  name: string;
  findings: HeaderFinding[];
  summary: FindingSummary;
}

/** Groups findings in the canonical order; unknown groups come last, sorted by name. */
export function groupFindings(findings: HeaderFinding[]): FindingGroup[] {
  const buckets = new Map<string, HeaderFinding[]>();
  for (const finding of findings) {
    const bucket = buckets.get(finding.group);
    if (bucket) bucket.push(finding);
    else buckets.set(finding.group, [finding]);
  }

  const ordered: string[] = GROUP_ORDER.filter((group) => buckets.has(group));
  const extras = [...buckets.keys()].filter((group) => !(GROUP_ORDER as readonly string[]).includes(group)).sort();
  return [...ordered, ...extras].map((name) => {
    const bucket = buckets.get(name) ?? [];
    return { name, findings: bucket, summary: summarize(bucket) };
  });
}

export function findingKey(finding: HeaderFinding): string {
  return `${finding.group}::${finding.name}`;
}

export function statusText(code: number): string {
  const reasons: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    303: "See Other",
    304: "Not Modified",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    418: "I'm a teapot",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return reasons[code] ?? "";
}

export function statusTone(code: number): "success" | "warning" | "error" {
  if (code >= 200 && code < 300) return "success";
  if (code >= 300 && code < 400) return "warning";
  return "error";
}

export function cookieTone(cookie: CookieFinding): "success" | "warning" | "error" {
  if (cookie.issues.length === 0) return "success";
  if (!cookie.secure || !cookie.httpOnly) return "error";
  return "warning";
}

export function cookieIssues(cookies: CookieFinding[]): number {
  return cookies.filter((cookie) => cookie.issues.length > 0).length;
}

export function headersToText(headers: [string, string][]): string {
  return headers.map(([name, value]) => `${name}: ${value}`).join("\n");
}

function cookieLine(cookie: CookieFinding): string {
  const flags = [
    `Secure=${cookie.secure ? "yes" : "no"}`,
    `HttpOnly=${cookie.httpOnly ? "yes" : "no"}`,
    `SameSite=${cookie.sameSite ?? "missing"}`,
  ].join(" ");
  const issues = cookie.issues.length > 0 ? cookie.issues.join(", ") : "no issues";
  return `${cookie.name.padEnd(28)} ${flags}  — ${issues}`;
}

/** Plain-text report used by every copy action in the view. */
export function buildReport(analysis: HeaderAnalysis): string {
  const summary = summarize(analysis.findings);
  const lines: string[] = [
    "shift-tools · Header Analyzer",
    `Target:   ${analysis.url}`,
    `Final:    ${analysis.finalUrl}`,
    `Status:   HTTP ${analysis.status}${statusText(analysis.status) ? ` ${statusText(analysis.status)}` : ""}`,
    `Grade:    ${analysis.grade} · ${analysis.score}/100 (${gradeDescriptor(analysis.score)})`,
    `Checks:   ${summary.pass} pass · ${summary.warn} warn · ${summary.fail} fail · ${summary.info} info`,
    `Fetched:  ${analysis.fetchedAt} · ${analysis.durationMs} ms`,
    "",
    "FINDINGS",
  ];

  for (const group of groupFindings(analysis.findings)) {
    lines.push("", `[${group.name}]`);
    for (const finding of group.findings) {
      lines.push(
        `${statusMeta(finding.status).report.padEnd(4)} ${finding.name} (weight ${finding.weight})`,
        `     value: ${finding.value ?? "missing"}`,
        `     fix:   ${finding.recommendation}`,
      );
    }
  }

  lines.push("", `COOKIES (${analysis.cookies.length})`);
  if (analysis.cookies.length === 0) lines.push("  none on this response");
  for (const cookie of analysis.cookies) lines.push(`  ${cookieLine(cookie)}`);

  lines.push("", `RAW HEADERS (${analysis.rawHeaders.length})`);
  for (const [name, value] of analysis.rawHeaders) lines.push(`  ${name}: ${value}`);

  return lines.join("\n");
}
