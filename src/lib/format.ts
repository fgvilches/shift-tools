/** Formatting helpers shared by every view. */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function bytes(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value <= 0) return "0 B";
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(unit === 0 ? 0 : digits)} ${BYTE_UNITS[unit]}`;
}

export function bytesParts(value: number | null | undefined): { value: string; unit: string } {
  const text = bytes(value);
  const [v, u] = text.split(" ");
  return { value: v ?? "—", unit: u ?? "" };
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function ms(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(digits)} ms`;
}

export function number(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString("en-CA")} ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Math.round((Date.now() - then) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function rssiQuality(rssi: number | null): { label: string; tone: "success" | "primary" | "warning" | "error" } {
  if (rssi === null) return { label: "unknown", tone: "primary" };
  if (rssi >= -55) return { label: "excellent", tone: "success" };
  if (rssi >= -67) return { label: "good", tone: "success" };
  if (rssi >= -75) return { label: "fair", tone: "warning" };
  return { label: "poor", tone: "error" };
}

export function truncateMiddle(text: string, max = 44): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
