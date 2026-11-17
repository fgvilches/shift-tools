import type { LanHost } from "@/lib/types";

export interface ExportMeta {
  cidr: string;
  ports: number[];
  exportedAt: string;
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function hostsToCsv(hosts: LanHost[]): string {
  const header = ["ip", "hostname", "mac", "vendor", "open_ports", "port_count", "latency_ms"];
  const rows = hosts.map((host) =>
    [
      host.ip,
      host.hostname,
      host.mac,
      host.vendor,
      host.openPorts.map((entry) => `${entry.port}/${entry.service}`).join(" "),
      host.openPorts.length,
      host.latencyMs === null ? null : Number(host.latencyMs.toFixed(2)),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export function hostsToJson(hosts: LanHost[], meta: ExportMeta): string {
  return JSON.stringify({ ...meta, hostCount: hosts.length, hosts }, null, 2);
}

export function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function downloadFile(filename: string, mime: string, contents: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
