import type { Tone } from "@/components/ui/Badge";
import type { LanHost } from "@/lib/types";

export type PortSet = "common" | "web" | "custom";

export interface PortPreset {
  value: PortSet;
  label: string;
  ports: number[];
}

/** Backend probe budget: 8 ports per address keeps a /24 under a few seconds. */
export const PORT_PRESETS: PortPreset[] = [
  { value: "common", label: "Common 8", ports: [22, 80, 443, 445, 3389, 5000, 8000, 8080] },
  { value: "web", label: "Web", ports: [80, 443, 3000, 5173, 8000, 8080, 8443] },
];

export const DEFAULT_PORTS = PORT_PRESETS[0].ports;

/** Ports whose open socket means a cleartext / weak remote-control surface. */
export const INSECURE_PORTS = new Set([21, 23, 3389, 5900]);

const INSECURE_LABELS: Record<number, string> = {
  21: "ftp",
  23: "telnet",
  3389: "rdp",
  5900: "vnc",
};

export function parseCustomPorts(raw: string): { ports: number[]; rejected: string[] } {
  const tokens = raw
    .split(/[^0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const ports: number[] = [];
  const rejected: string[] = [];
  for (const token of tokens) {
    const value = Number(token);
    if (Number.isInteger(value) && value > 0 && value <= 65535) {
      if (!ports.includes(value)) ports.push(value);
    } else {
      rejected.push(token);
    }
  }
  return { ports: ports.sort((a, b) => a - b), rejected };
}

export function presetPorts(set: PortSet): number[] {
  return PORT_PRESETS.find((preset) => preset.value === set)?.ports ?? DEFAULT_PORTS;
}

/** Numeric IPv4 value so .10 sorts after .9 instead of before it. */
export function ipValue(ip: string): number {
  const octets = ip.split(".");
  if (octets.length !== 4) return Number.MAX_SAFE_INTEGER;
  let value = 0;
  for (const part of octets) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return Number.MAX_SAFE_INTEGER;
    value = value * 256 + octet;
  }
  return value;
}

export function portTone(port: number): Tone {
  if (INSECURE_PORTS.has(port)) return "error";
  if (port === 22) return "success";
  if ([80, 443, 3000, 5000, 5001, 5173, 8000, 8080, 8443].includes(port)) return "primary";
  if ([139, 445, 1433, 3306, 3389, 5432, 6379, 11211, 27017].includes(port)) return "tertiary";
  return "neutral";
}

/** e.g. "telnet :23" when the host exposes a cleartext service. */
export function insecureLabel(host: LanHost): string | null {
  const hit = host.openPorts.find((entry) => INSECURE_PORTS.has(entry.port));
  if (!hit) return null;
  return `${hit.service || INSECURE_LABELS[hit.port] || "service"} :${hit.port}`;
}
