import type { MapPoint, MapScan, WifiMapDoc } from "@/lib/types";
import { clamp, rssiQuality } from "@/lib/format";

export interface Vec {
  x: number;
  y: number;
}

export type Band = "2.4 GHz" | "5 GHz" | "6 GHz" | "unknown";

export type PointQuality = ReturnType<typeof rssiQuality>;

/* ------------------------------- primitives ------------------------------ */

export function newId(prefix: string): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Measurement point label: P-01, P-02… continuing past the highest existing number. */
export function nextPointLabel(points: MapPoint[]): string {
  let highest = 0;
  for (const point of points) {
    const match = /^P-(\d+)$/.exec(point.label.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const next = Math.max(highest + 1, points.length + 1);
  return `P-${String(next).padStart(2, "0")}`;
}

/** Newest capture batch of a point. Coverage math always uses the last sample. */
export function latestScans(point: MapPoint): MapScan[] {
  if (point.scans.length === 0) return [];
  let latest = "";
  for (const scan of point.scans) {
    if (scan.timestamp > latest) latest = scan.timestamp;
  }
  return point.scans.filter((scan) => scan.timestamp === latest);
}

export function sampleCount(point: MapPoint): number {
  return new Set(point.scans.map((scan) => scan.timestamp)).size;
}

export function normalizeBand(scan: MapScan): Band {
  const raw = (scan.band ?? "").toLowerCase();
  if (raw.includes("6")) return "6 GHz";
  if (raw.includes("5")) return "5 GHz";
  if (raw.includes("2")) return "2.4 GHz";
  const channel = scan.channel;
  if (channel !== null) {
    if (channel <= 14) return "2.4 GHz";
    if (channel <= 177) return "5 GHz";
    return "6 GHz";
  }
  return "unknown";
}

export function networkName(scan: MapScan): string {
  return scan.ssid && scan.ssid.trim().length > 0 ? scan.ssid : "(hidden SSID)";
}

/** Heatmap colour for a strongest-signal reading. Bands follow rssiQuality. */
export function rssiColor(rssi: number | null): string {
  if (rssi === null) return "#8b91a0";
  if (rssi >= -55) return "#30d158";
  if (rssi >= -67) return "#3e90ff";
  if (rssi >= -75) return "#ffd60a";
  return "#ff453a";
}

export const RSSI_LEGEND = [
  { label: "Excellent", color: "#30d158", range: "≥ -55" },
  { label: "Good", color: "#3e90ff", range: "-56…-67" },
  { label: "Fair", color: "#ffd60a", range: "-68…-75" },
  { label: "Poor", color: "#ff453a", range: "< -75" },
] as const;

/* ------------------------------ point summary ----------------------------- */

export interface PointSummary {
  strongest: MapScan | null;
  strongestName: string | null;
  averageRssi: number | null;
  channels: number[];
  band: Band | null;
  noise: number | null;
  snr: number | null;
  samples: number;
  beacons: number;
  quality: PointQuality;
  scannedAt: string | null;
}

export function summarizePoint(point: MapPoint): PointSummary {
  const latest = latestScans(point);
  let strongest: MapScan | null = null;
  for (const scan of latest) {
    if (strongest === null || scan.rssi > strongest.rssi) strongest = scan;
  }

  const perSampleMax = new Map<string, number>();
  for (const scan of point.scans) {
    const previous = perSampleMax.get(scan.timestamp);
    if (previous === undefined || scan.rssi > previous) perSampleMax.set(scan.timestamp, scan.rssi);
  }
  const sampleMaxima = [...perSampleMax.values()];
  const averageRssi =
    sampleMaxima.length > 0 ? sampleMaxima.reduce((sum, value) => sum + value, 0) / sampleMaxima.length : null;

  const noises = latest.map((scan) => scan.noise).filter((value): value is number => value !== null);
  const noise = noises.length > 0 ? noises.reduce((sum, value) => sum + value, 0) / noises.length : null;

  const channels = [...new Set(latest.map((scan) => scan.channel).filter((c): c is number => c !== null))].sort(
    (a, b) => a - b,
  );

  const timestamps = [...perSampleMax.keys()].sort();
  const scannedAt = timestamps.length > 0 ? timestamps[timestamps.length - 1] ?? null : null;

  return {
    strongest,
    strongestName: strongest ? networkName(strongest) : null,
    averageRssi,
    channels,
    band: strongest ? normalizeBand(strongest) : null,
    noise,
    snr: strongest && noise !== null ? round(strongest.rssi - noise, 0) : null,
    samples: perSampleMax.size,
    beacons: latest.length,
    quality: rssiQuality(strongest?.rssi ?? null),
    scannedAt,
  };
}

/** Site-wide average of each point's average RSSI. */
export function siteAverageRssi(points: MapPoint[]): number | null {
  const values = points
    .map((point) => summarizePoint(point).averageRssi)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/* ------------------------------ network stats ----------------------------- */

export interface NetworkStat {
  key: string;
  ssid: string;
  bssid: string | null;
  band: Band;
  channel: number | null;
  points: number;
  bestRssi: number;
  worstRssi: number;
  averageRssi: number;
  lastSeen: string;
}

interface NetworkAcc {
  ssid: string;
  bssid: string | null;
  band: Band;
  channel: number | null;
  pointIds: Set<string>;
  best: number;
  worst: number;
  sum: number;
  count: number;
  lastSeen: string;
}

/** Per-BSSID best/worst/average across the latest sample of every point. */
export function networkStats(points: MapPoint[]): NetworkStat[] {
  const accumulators = new Map<string, NetworkAcc>();

  for (const point of points) {
    for (const scan of latestScans(point)) {
      const key = scan.bssid ?? `${scan.ssid ?? "hidden"}:${scan.channel ?? "?"}`;
      const existing = accumulators.get(key);
      if (existing) {
        existing.pointIds.add(point.id);
        existing.best = Math.max(existing.best, scan.rssi);
        existing.worst = Math.min(existing.worst, scan.rssi);
        existing.sum += scan.rssi;
        existing.count += 1;
        if (scan.timestamp > existing.lastSeen) existing.lastSeen = scan.timestamp;
        if (existing.channel === null) existing.channel = scan.channel;
      } else {
        accumulators.set(key, {
          ssid: networkName(scan),
          bssid: scan.bssid,
          band: normalizeBand(scan),
          channel: scan.channel,
          pointIds: new Set([point.id]),
          best: scan.rssi,
          worst: scan.rssi,
          sum: scan.rssi,
          count: 1,
          lastSeen: scan.timestamp,
        });
      }
    }
  }

  return [...accumulators.entries()]
    .map(([key, acc]) => ({
      key,
      ssid: acc.ssid,
      bssid: acc.bssid,
      band: acc.band,
      channel: acc.channel,
      points: acc.pointIds.size,
      bestRssi: acc.best,
      worstRssi: acc.worst,
      averageRssi: acc.sum / acc.count,
      lastSeen: acc.lastSeen,
    }))
    .sort((a, b) => b.bestRssi - a.bestRssi);
}

/* ---------------------------- channel analysis ---------------------------- */

const CANDIDATE_CHANNELS: Record<Exclude<Band, "unknown">, number[]> = {
  "2.4 GHz": [1, 6, 11],
  "5 GHz": [
    36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161,
    165,
  ],
  "6 GHz": [5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213],
};

export const CHANNEL_HEURISTIC =
  "Candidates are limited to non-overlapping 20 MHz channels (1/6/11 on 2.4 GHz, the 5 GHz UNII grid, 6 GHz PSC). Each observed BSSID is weighted by signal: w = clamp((RSSI + 90) / 55, 0, 1), so a strong neighbour costs more than a distant one. The recommendation is the candidate with the lowest total weight.";

export type ChannelVerdict = "recommended" | "congested" | "in use" | "clear";

export interface ChannelCandidate {
  band: Exclude<Band, "unknown">;
  channel: number;
  bssids: number;
  networks: string[];
  averageRssi: number | null;
  score: number;
  verdict: ChannelVerdict;
}

export interface ChannelAnalysis {
  band: Exclude<Band, "unknown"> | null;
  recommended: ChannelCandidate | null;
  rows: ChannelCandidate[];
  observedBssids: number;
  observedChannels: number;
  reason: string;
}

function weightFor(rssi: number): number {
  return clamp((rssi + 90) / 55, 0, 1);
}

export function analyzeChannels(points: MapPoint[]): ChannelAnalysis {
  interface Occupant {
    ssid: string;
    rssi: number;
    band: Exclude<Band, "unknown">;
    channel: number;
  }
  const occupants = new Map<string, Occupant>();
  const bandBssids = new Map<Exclude<Band, "unknown">, Set<string>>();

  for (const point of points) {
    for (const scan of latestScans(point)) {
      const band = normalizeBand(scan);
      if (band === "unknown" || scan.channel === null) continue;
      const key = scan.bssid ?? `${scan.ssid ?? "hidden"}:${scan.channel}`;
      const existing = occupants.get(key);
      if (!existing || scan.rssi > existing.rssi) {
        occupants.set(key, { ssid: networkName(scan), rssi: scan.rssi, band, channel: scan.channel });
      }
      const set = bandBssids.get(band) ?? new Set<string>();
      set.add(key);
      bandBssids.set(band, set);
    }
  }

  const perChannel = new Map<string, { band: Exclude<Band, "unknown">; channel: number; entries: Occupant[] }>();
  for (const occupant of occupants.values()) {
    const key = `${occupant.band}|${occupant.channel}`;
    const group = perChannel.get(key) ?? { band: occupant.band, channel: occupant.channel, entries: [] };
    group.entries.push(occupant);
    perChannel.set(key, group);
  }

  const observed: ChannelCandidate[] = [...perChannel.values()].map((group) => {
    const score = group.entries.reduce((sum, entry) => sum + weightFor(entry.rssi), 0);
    return {
      band: group.band,
      channel: group.channel,
      bssids: group.entries.length,
      networks: [...new Set(group.entries.map((entry) => entry.ssid))].sort((a, b) => a.localeCompare(b)),
      averageRssi: group.entries.reduce((sum, entry) => sum + entry.rssi, 0) / group.entries.length,
      score,
      verdict: score >= 1 ? "congested" : "in use",
    };
  });

  let dominantBand: Exclude<Band, "unknown"> | null = null;
  let dominantCount = -1;
  for (const [band, set] of bandBssids.entries()) {
    const count = set.size;
    const tieBreak = band === "5 GHz" ? 3 : band === "6 GHz" ? 2 : 1;
    const currentTie = dominantBand === "5 GHz" ? 3 : dominantBand === "6 GHz" ? 2 : 1;
    if (count > dominantCount || (count === dominantCount && tieBreak > currentTie)) {
      dominantBand = band;
      dominantCount = count;
    }
  }

  let recommended: ChannelCandidate | null = null;
  const rows: ChannelCandidate[] = [...observed];

  if (dominantBand) {
    const scoreByChannel = new Map<number, number>();
    for (const candidate of observed) {
      if (candidate.band === dominantBand) scoreByChannel.set(candidate.channel, candidate.score);
    }
    const candidates = CANDIDATE_CHANNELS[dominantBand].map((channel) => ({
      channel,
      score: scoreByChannel.get(channel) ?? 0,
    }));
    candidates.sort((a, b) => a.score - b.score || a.channel - b.channel);

    const winner = candidates[0];
    if (winner) {
      const observedWinner = observed.find(
        (candidate) => candidate.band === dominantBand && candidate.channel === winner.channel,
      );
      recommended = observedWinner
        ? { ...observedWinner, verdict: "recommended" }
        : {
            band: dominantBand,
            channel: winner.channel,
            bssids: 0,
            networks: [],
            averageRssi: null,
            score: 0,
            verdict: "recommended",
          };
    }

    // Keep the observed channels plus up to two clear alternates so the table stays readable.
    if (recommended) {
      const index = rows.findIndex((row) => row.band === recommended?.band && row.channel === recommended?.channel);
      if (index >= 0) {
        const existing = rows[index];
        if (existing) rows[index] = { ...existing, verdict: "recommended", score: recommended.score };
      } else {
        rows.push(recommended);
      }
    }
    let alternates = 0;
    for (const candidate of candidates) {
      if (alternates >= 2) break;
      if (candidate.score !== 0) continue;
      if (rows.some((row) => row.band === dominantBand && row.channel === candidate.channel)) continue;
      rows.push({
        band: dominantBand,
        channel: candidate.channel,
        bssids: 0,
        networks: [],
        averageRssi: null,
        score: 0,
        verdict: "clear",
      });
      alternates += 1;
    }
  }

  rows.sort((a, b) => {
    const verdictRank: Record<ChannelVerdict, number> = { recommended: 0, clear: 1, "in use": 2, congested: 3 };
    return verdictRank[a.verdict] - verdictRank[b.verdict] || a.band.localeCompare(b.band) || a.channel - b.channel;
  });

  const channelKeys = new Set([...occupants.values()].map((occupant) => `${occupant.band}|${occupant.channel}`));

  return {
    band: dominantBand,
    recommended,
    rows,
    observedBssids: occupants.size,
    observedChannels: channelKeys.size,
    reason:
      dominantBand && recommended
        ? `${dominantBand} carries the most beacons at this site (${dominantCount} BSSID${
            dominantCount === 1 ? "" : "s"
          }). Channel ${recommended.channel} scores ${recommended.score.toFixed(2)} — the lowest weighted occupancy among ${
            CANDIDATE_CHANNELS[dominantBand].length
          } non-overlapping candidates.`
        : "No beacon carries a channel, so there is nothing to rank yet.",
  };
}

/* --------------------------------- exports -------------------------------- */

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function coverageCsv(doc: WifiMapDoc): string {
  const header = [
    "point",
    "label",
    "x",
    "y",
    "samples",
    "beacons",
    "strongest_ssid",
    "strongest_bssid",
    "strongest_rssi",
    "average_rssi",
    "channels",
    "band",
    "quality",
  ];
  const lines = [header.join(",")];
  doc.points.forEach((point, index) => {
    const summary = summarizePoint(point);
    lines.push(
      [
        index + 1,
        point.label,
        round(point.x, 1),
        round(point.y, 1),
        summary.samples,
        summary.beacons,
        summary.strongestName ?? "",
        summary.strongest?.bssid ?? "",
        summary.strongest?.rssi ?? "",
        summary.averageRssi === null ? "" : round(summary.averageRssi, 1),
        summary.channels.join(" "),
        summary.band ?? "",
        summary.quality.label,
      ]
        .map(csvCell)
        .join(","),
    );
  });
  return `${lines.join("\n")}\n`;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "survey"
  );
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
